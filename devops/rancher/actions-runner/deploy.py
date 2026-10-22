#!/usr/bin/env python3
"""Install ARC and the deployment-only runner; secret values never enter Helm values."""
import argparse
import base64
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlsplit

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def load_settings():
    config = yaml.safe_load((HERE / 'values.yaml').read_text())
    environments = yaml.safe_load((ROOT / 'devops/jenkins/environments.yaml').read_text())
    ci = environments['ci']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', ci['repository']):
        raise ValueError('ci.repository must be OWNER/REPO')
    for name in ('git_credentials_id', 'jenkins_user'):
        if not re.fullmatch(r'[A-Za-z0-9_.@-]+', ci[name]):
            raise ValueError(f'Invalid ci.{name}')
    url = urlsplit(ci['jenkins_url'])
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('ci.jenkins_url must be an HTTP(S) URL without credentials/query/fragment')
    for part in ('controller', 'runners'):
        for key in ('namespace', 'release'):
            if not re.fullmatch(r'[a-z][a-z0-9-]{0,52}', config[part][key]):
                raise ValueError(f'Invalid {part}.{key}')
    if config['controller']['namespace'] == config['runners']['namespace']:
        raise ValueError('Keep controller and runner namespaces separate')
    if config['authentication']['mode'] not in ('pat', 'app'):
        raise ValueError('authentication.mode must be pat or app')
    return config, ci


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Read .env, create Secrets, and install/upgrade ARC')
    args = parser.parse_args()
    config, ci = load_settings()
    if not args.apply:
        print('Configuration valid. No cluster changes made and .env was not read.')
        print('To install: python3 devops/rancher/actions-runner/deploy.py --apply')
        return

    for executable in ('kubectl', 'helm'):
        if not shutil.which(executable):
            raise RuntimeError(f'Missing {executable}')
    from dotenv import dotenv_values
    secrets = dotenv_values(ROOT / '.env', interpolate=False)

    def required(name):
        if not secrets.get(name):
            raise ValueError(f'Add {name} to the root .env')
        return secrets[name]

    token = required('JENKINS_API_TOKEN')
    if config['authentication']['mode'] == 'pat':
        github = {'github_token': required('ARC_GITHUB_TOKEN')}
    else:
        auth = config['authentication']
        for key in ('app_id', 'installation_id'):
            if not str(auth[key]).isdigit():
                raise ValueError(f'Set authentication.{key} in values.yaml')
        keyfile = Path(required('ARC_GITHUB_APP_PRIVATE_KEY_FILE')).expanduser()
        if not keyfile.is_absolute():
            keyfile = ROOT / keyfile
        key = keyfile.read_text()
        if 'PRIVATE KEY-----' not in key:
            raise ValueError('The GitHub App key file must contain a PEM private key')
        github = {'github_app_id': str(auth['app_id']), 'github_app_installation_id': str(auth['installation_id']),
                  'github_app_private_key': key}

    if not os.environ.get('KUBECONFIG'):
        kubeconfig = Path.home() / '.kube/trackingtrucks-k3s.yaml'
        if kubeconfig.exists():
            os.environ['KUBECONFIG'] = str(kubeconfig)
    orchestrator = yaml.safe_load((ROOT / 'devops/orchestrator.yaml').read_text())
    context = os.environ.get('KUBE_CONTEXT') or orchestrator['cluster']['context'] or subprocess.check_output(
        ['kubectl', 'config', 'current-context'], text=True).strip()
    kube = ['kubectl', '--context', context]

    def apply(resource):
        result = subprocess.run(kube + ['apply', '--server-side', '--field-manager=trackingtrucks-runner', '-f', '-'],
                                input=json.dumps(resource), text=True, capture_output=True)
        if result.returncode:
            # Avoid echoing resource payloads or kubectl diagnostics containing secret data.
            raise RuntimeError(f"Could not apply {resource['kind']} {resource['metadata']['name']}; inspect cluster permissions/conflicts")

    for part in ('controller', 'runners'):
        apply({'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {'name': config[part]['namespace']}})
    namespace = config['runners']['namespace']
    for name, data in ((config['runners']['values']['githubConfigSecret'], github), ('jenkins-trigger-auth', {'token': token})):
        apply({'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': name, 'namespace': namespace},
               'type': 'Opaque', 'data': {key: base64.b64encode(value.encode()).decode() for key, value in data.items()}})
    apply({'apiVersion': 'v1', 'kind': 'ConfigMap',
           'metadata': {'name': 'jenkins-trigger-settings', 'namespace': namespace},
           'data': {'JENKINS_URL': ci['jenkins_url'], 'JENKINS_USER': ci['jenkins_user'],
                    'REPO_URL': f"git@github.com:{ci['repository']}.git", 'GIT_CREDENTIALS_ID': ci['git_credentials_id']}})

    with tempfile.TemporaryDirectory(prefix='trackingtrucks-arc-') as directory:
        for part, chart in (('controller', 'gha-runner-scale-set-controller'), ('runners', 'gha-runner-scale-set')):
            settings = config[part]
            values = copy.deepcopy(settings['values'])
            if part == 'runners':
                values['githubConfigUrl'] = values.get('githubConfigUrl') or f"https://github.com/{ci['repository']}"
                values['controllerServiceAccount'] = {
                    'namespace': config['controller']['namespace'],
                    'name': config['controller']['values']['serviceAccount']['name'],
                }
            path = Path(directory) / f'{part}.yaml'
            path.write_text(yaml.safe_dump(values))
            subprocess.run(['helm', 'upgrade', '--install', settings['release'],
                            f'oci://ghcr.io/actions/actions-runner-controller-charts/{chart}',
                            '--version', config['chart_version'], '--kube-context', context,
                            '--namespace', settings['namespace'], '--values', str(path),
                            '--wait', '--timeout', '10m', '--history-max', '5'], check=True)
    print('ARC installed. Verify the listener and GitHub runner scale set; idle runner count may be zero.')
    print('Future runner pods will use the current secrets. Existing jobs keep their original environment.')


if __name__ == '__main__':
    main()
