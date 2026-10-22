#!/usr/bin/env bash
# Called by deployJenkins.sh before Helm. Writes the JCasC Job DSL config.
set -euo pipefail
CONTEXT="${1:?Kubernetes context required}"
OUTPUT="${2:?Output path required}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
kube=(kubectl --context "$CONTEXT")

python3 - "$ROOT/jobs/deployCode.Jenkinsfile" "$OUTPUT" <<'PY'
import json
import pathlib
import sys
import runpy

# Share validation with the runner deployer; this does not read .env.
helper = pathlib.Path(sys.argv[1]).resolve().parents[2] / 'rancher/actions-runner/deploy.py'
_, ci = runpy.run_path(str(helper))['load_settings']()
repo_url = f"git@github.com:{ci['repository']}.git"
def configured(text):
    return text.replace('__REPO_URL__', repo_url).replace('__GIT_CREDENTIALS_ID__', ci['git_credentials_id'])
pipeline = configured(pathlib.Path(sys.argv[1]).read_text())
# Preserve the Jenkinsfile literally inside a Groovy single-quoted string.
quoted = "'" + pipeline.replace("\\", "\\\\").replace("'", "\\'").replace("\r", "\\r").replace("\n", "\\n") + "'"
dsl = """pipelineJob('DEPLOY_CODE') {
  description('Build a branch into an image, or deploy a saved successful image release.')
  parameters {
    stringParam('COMMIT', '', 'Optional exact commit from BRANCH; ignored for saved images')
    stringParam('IMAGE', '', 'Saved repository@sha256:digest; blank builds BRANCH')
    stringParam('REPO_URL', '__REPO_URL__', 'Git repository SSH URL')
    stringParam('BRANCH', 'main', 'Branch to check out and release')
    stringParam('GIT_CREDENTIALS_ID', '__GIT_CREDENTIALS_ID__', 'Jenkins SSH Username with private key credential ID')
  }
  definition {
    cps {
      script(""" + quoted + """)
      sandbox()
    }
  }
}
"""
testing = configured(pathlib.Path(sys.argv[1]).with_name('deployTesting.Jenkinsfile').read_text())
quoted_testing = "'" + testing.replace("\\", "\\\\").replace("'", "\\'").replace("\r", "\\r").replace("\n", "\\n") + "'"
dsl += """pipelineJob('DEPLOY_TESTING') {
  description('Deploy the checked development commit without publishing images. Triggered by GitHub Actions.')
  parameters {
    stringParam('COMMIT', '', 'Checked development SHA; blank uses latest development')
    stringParam('REPO_URL', '__REPO_URL__', 'Git repository SSH URL')
    stringParam('GIT_CREDENTIALS_ID', '__GIT_CREDENTIALS_ID__', 'Jenkins SSH credential ID')
  }
  definition { cps { script(""" + quoted_testing + """); sandbox() } }
}
"""
pathlib.Path(sys.argv[2]).write_text(json.dumps({'jobs': [{'script': configured(dsl)}]}))
PY

# Validate both environments before applying resources.
SETTINGS="$(python3 - "$ROOT/environments.yaml" <<'CONFIG'
import re, sys, yaml
config = yaml.safe_load(open(sys.argv[1]))['environments']
for name in ('production', 'testing'):
    env = config[name]
    host = env.get('hostname', '')
    assert env['namespace'] == name, f'{name} namespace must be {name}'
    assert isinstance(host, str) and len(host) <= 253 and re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+', host), f'Invalid {name} hostname'
    print(name, host)
CONFIG
)"
while read -r namespace app_host; do
  python3 - "$ROOT/scripts/deploy-code-rbac.yaml" "$namespace" <<'RBAC' | "${kube[@]}" apply -f -
import sys, yaml
namespace = sys.argv[2]
for resource in yaml.safe_load_all(open(sys.argv[1])):
    if namespace == 'testing' and resource['kind'] == 'PersistentVolumeClaim':
        continue
    if resource['kind'] == 'Namespace':
        resource['metadata']['name'] = namespace
    else:
        resource['metadata']['namespace'] = namespace
    for subject in resource.get('subjects', []):
        if subject.get('namespace') == 'production': subject['namespace'] = namespace
    print('---')
    print(yaml.safe_dump(resource))
RBAC
  "${kube[@]}" -n "$namespace" create configmap deploy-code-settings \
    --from-literal="APP_HOST=$app_host" --from-literal="DEPLOY_NAMESPACE=$namespace" \
    --dry-run=client -o yaml | "${kube[@]}" apply -f -
  "${kube[@]}" -n "$namespace" create configmap deploy-code-scripts \
    --from-file="compile-application.sh=$ROOT/scripts/compile-application.sh" \
    --from-file="deploy-code.sh=$ROOT/scripts/deploy-code.sh" \
    --from-file="Dockerfile=$ROOT/scripts/Dockerfile" \
    --from-file="nginx.conf=$ROOT/scripts/nginx.conf" \
    --dry-run=client -o yaml | "${kube[@]}" apply -f -
done <<< "$SETTINGS"
echo 'DEPLOY_CODE and DEPLOY_TESTING job definitions prepared.'
