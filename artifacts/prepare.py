#!/usr/bin/env python3
"""Discover the registry address and prepare local installation inputs."""
import base64
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

import bcrypt

os.umask(0o077)
root = Path(__file__).resolve().parent
state = root / '.local'
if len(sys.argv) > 2:
    sys.exit('Usage: python3 artifacts/prepare.py [NODE_IP_OR_DNS_NAME]')
if len(sys.argv) == 2:
    host = sys.argv[1]
else:
    # Match deploy.sh's cluster selection; this is a read-only lookup.
    kube_env = os.environ.copy()
    kubeconfig = Path.home() / '.kube/trackingtrucks-k3s.yaml'
    if not kube_env.get('KUBECONFIG') and kubeconfig.is_file():
        kube_env['KUBECONFIG'] = str(kubeconfig)
    command = ['kubectl']
    if kube_env.get('KUBE_CONTEXT'):
        command += ['--context', kube_env['KUBE_CONTEXT']]
    command += ['get', 'nodes', '-o', 'json', '--request-timeout=15s']
    try:
        nodes = json.loads(subprocess.check_output(command, env=kube_env, text=True, timeout=30))['items']
    except (OSError, subprocess.SubprocessError, ValueError, KeyError) as error:
        sys.exit(f'Cannot discover the cluster node: {error}. Check kubectl access or supply a hostname/IP explicitly.')
    if len(nodes) != 1:
        sys.exit('Automatic discovery requires a single-node cluster. Supply a stable node IP or DNS name explicitly.')
    addresses = []
    for address in nodes[0].get('status', {}).get('addresses', []):
        if address.get('type') == 'InternalIP':
            try:
                addresses.append(str(ipaddress.IPv4Address(address['address'])))
            except (ValueError, KeyError):
                pass
    if len(addresses) != 1:
        sys.exit('Node must have one internal IPv4 address. Supply a stable IPv4 address or DNS name explicitly.')
    host = addresses[0]
    print(f'Discovered {host} from node {nodes[0]["metadata"]["name"]}.')
if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}', host):
    sys.exit('Expected a node IPv4 address or DNS name (no scheme or port).')
try:
    ipaddress.IPv4Address(host)
    san = f'IP:{host}'
except ValueError:
    san = f'DNS:{host}'
endpoint = host + ':30500'
state.mkdir(mode=0o700, exist_ok=True)
if (state / 'endpoint').exists() and (state / 'endpoint').read_text() != endpoint:
    sys.exit('Existing endpoint differs. Migrate the registry address explicitly; do not replace its credentials.')
(state / 'endpoint').write_text(endpoint)

def openssl(*args):
    subprocess.run(['openssl', *args], cwd=state, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

if not (state / 'ca.crt').exists():
    openssl('req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-days', '3650', '-subj', '/CN=TrackingTrucks artifacts CA',
            '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
            '-keyout', 'ca.key', '-out', 'ca.crt')
if not (state / 'tls.crt').exists():
    openssl('req', '-newkey', 'rsa:3072', '-nodes', '-subj', f'/CN={host}', '-keyout', 'tls.key', '-out', 'tls.csr')
    (state / 'tls.ext').write_text(f'subjectAltName={san}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
    openssl('x509', '-req', '-in', 'tls.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial',
            '-out', 'tls.crt', '-days', '365', '-extfile', 'tls.ext')

for user in ['jenkins', 'reader']:
    password_file = state / f'{user}.password'
    if not password_file.exists():
        password_file.write_text(secrets.token_urlsafe(36))
    password = password_file.read_text().strip()
    hash_file = state / f'{user}.htpasswd'
    if not hash_file.exists():
        hash_file.write_text(user + ':' + bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode() + '\n')
    auth = base64.b64encode(f'{user}:{password}'.encode()).decode()
    (state / f'{user}.dockerconfig.json').write_text(json.dumps({'auths': {endpoint: {'auth': auth}}}))
(state / 'htpasswd').write_text(''.join((state / f'{u}.htpasswd').read_text() for u in ['jenkins', 'reader']))
# Kubernetes health probes need authenticated access when anonymous access is disabled.
reader = json.loads((state / 'reader.dockerconfig.json').read_text())['auths'][endpoint]['auth']
(state / 'helm-private.json').write_text(json.dumps({'authHeader': reader}))
(state / 'buildkitd.toml').write_text(f'[registry."{endpoint}"]\n  http = false\n  insecure = false\n  ca = ["/registry-ca/ca.crt"]\n')
print(f'Prepared {endpoint}. Private files are in artifacts/.local/ (gitignored).')
print('Next: bash artifacts/deploy.sh, then configure node trust as documented in devops/README.md.')
