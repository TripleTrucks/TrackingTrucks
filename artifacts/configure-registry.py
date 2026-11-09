#!/usr/bin/env python3
"""Use the stable Tailscale HTTPS registry name for Jenkins and image pulls."""
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import base64
import urllib.error
import urllib.request

root = Path(__file__).resolve().parent
host = (root / 'registry-hostname').read_text().strip()
if not re.fullmatch(r'[a-z0-9-]+\.[a-z0-9-]+\.ts\.net', host):
    raise SystemExit('registry-hostname must contain a Tailscale service DNS name, without a scheme or port.')
env = os.environ.copy()
config = Path.home() / '.kube/trackingtrucks-k3s.yaml'
if not env.get('KUBECONFIG') and config.exists():
    env['KUBECONFIG'] = str(config)
kube = ['kubectl']
if env.get('KUBE_CONTEXT'):
    kube += ['--context', env['KUBE_CONTEXT']]

def run(*args, data=None):
    return subprocess.check_output(kube + list(args), env=env, text=True,
                                   input=json.dumps(data) if data is not None else None)

def get(namespace, kind, name):
    return json.loads(run('-n', namespace, 'get', kind, name, '-o', 'json'))

def patch(namespace, kind, name, data):
    run('-n', namespace, 'patch', kind, name, '--type=merge', '--patch-file=/dev/stdin', data=data)

# Require valid public TLS before changing any cluster settings. A protected
# registry normally answers 401 here, since this request has no credentials.
try:
    with urllib.request.urlopen(f'https://{host}/v2/', timeout=15) as response:
        if response.status != 200:
            raise SystemExit('Unexpected registry response')
except urllib.error.HTTPError as error:
    if error.code != 401:
        raise

settings = get('production', 'configmap', 'registry-settings')
old_repository = settings['data']['IMAGE_REPOSITORY']
old_host, repository = old_repository.split('/', 1)
credentials = {}
for user in ['jenkins', 'reader']:
    secret = get('production', 'secret', 'registry-' + user)
    auth = json.loads(base64.b64decode(secret['data']['.dockerconfigjson']))
    auth['auths'][host] = auth['auths'][old_host]
    credentials[user] = base64.b64encode(json.dumps(auth).encode()).decode()

# Keep private CA trust for existing references; add public roots because the
# stable endpoint terminates TLS at Tailscale. No verification is disabled.
ca = get('production', 'configmap', 'registry-ca')['data']['ca.crt']
public_ca = Path(ssl.get_default_verify_paths().cafile).read_text()
if public_ca.strip() not in ca:
    ca += '\n' + public_ca

# K3s imports *.server from this supported custom ConfigMap. Quad100 is
# Tailscale's fixed local DNS service address, not a registry/node address.
domain = host.split('.', 1)[1]
custom = json.loads(run('-n', 'kube-system', 'get', 'configmap', 'coredns-custom',
                       '--ignore-not-found', '-o', 'json') or '{}')
key = 'trackingtrucks-tailnet.server'
forward = f'{domain}:53 {{\n    errors\n    cache 30\n    forward . 100.100.100.100\n}}\n'
dns_changed = custom.get('data', {}).get(key) != forward
if not custom:
    run('create', '-f', '-', data={'apiVersion': 'v1', 'kind': 'ConfigMap',
        'metadata': {'name': 'coredns-custom', 'namespace': 'kube-system'}, 'data': {key: forward}})
elif custom.get('data', {}).get(key) != forward:
    patch('kube-system', 'configmap', 'coredns-custom', {'data': {key: forward}})
if dns_changed:
    run('-n', 'kube-system', 'rollout', 'restart', 'deployment/coredns')
    run('-n', 'kube-system', 'rollout', 'status', 'deployment/coredns', '--timeout=120s')

for user, encoded in credentials.items():
    patch('production', 'secret', 'registry-' + user, {'data': {'.dockerconfigjson': encoded}})
patch('production', 'configmap', 'registry-ca', {'data': {'ca.crt': ca}})
patch('production', 'configmap', 'registry-buildkit', {'data': {
    'buildkitd.toml': f'[registry."{host}"]\n  http = false\n  insecure = false\n'}})
patch('production', 'configmap', 'registry-settings', {'data': {'IMAGE_REPOSITORY': f'{host}/{repository}'}})
print(f'Registry configured: {host}/{repository}')
print('New Jenkins builds use this hostname. Existing credentials and images are preserved.')
