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

pipeline = pathlib.Path(sys.argv[1]).read_text()
# Preserve the Jenkinsfile literally inside a Groovy single-quoted string.
quoted = "'" + pipeline.replace("\\", "\\\\").replace("'", "\\'").replace("\r", "\\r").replace("\n", "\\n") + "'"
dsl = """pipelineJob('DEPLOY_CODE') {
  description('Build a branch into an image, or deploy a saved successful image release.')
  parameters {
    stringParam('IMAGE', '', 'Saved repository@sha256:digest; blank builds BRANCH')
    stringParam('REPO_URL', 'git@github.com:ZenMastering/TrackingTrucks.git', 'Git repository SSH URL')
    stringParam('BRANCH', 'main', 'Branch to check out and release')
    stringParam('GIT_CREDENTIALS_ID', 'github-ssh', 'Jenkins SSH Username with private key credential ID')
  }
  definition {
    cps {
      script(""" + quoted + """)
      sandbox()
    }
  }
}
"""
pathlib.Path(sys.argv[2]).write_text(json.dumps({'jobs': [{'script': dsl}]}))
PY

# Validate operator-owned production settings before making changes. Rollback needs no Git checkout.
APP_HOST="$(python3 - "$ROOT/environments.yaml" <<'CONFIG'
import re, sys, yaml
config = yaml.safe_load(open(sys.argv[1]))['environments']['production']
host = config.get('hostname', '')
assert config['namespace'] == 'production', 'Only production is supported'
assert isinstance(host, str) and len(host) <= 253 and re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+', host), 'Invalid production hostname'
print(host)
CONFIG
)"
"${kube[@]}" apply -f "$ROOT/scripts/deploy-code-rbac.yaml"
"${kube[@]}" -n production create configmap deploy-code-settings \
  --from-literal="APP_HOST=$APP_HOST" --from-literal=DEPLOY_NAMESPACE=production \
  --dry-run=client -o yaml | "${kube[@]}" apply -f -
"${kube[@]}" -n production create configmap deploy-code-scripts \
  --from-file="compile-application.sh=$ROOT/scripts/compile-application.sh" \
  --from-file="deploy-code.sh=$ROOT/scripts/deploy-code.sh" \
  --from-file="Dockerfile=$ROOT/scripts/Dockerfile" \
  --from-file="nginx.conf=$ROOT/scripts/nginx.conf" \
  --dry-run=client -o yaml | "${kube[@]}" apply -f -
echo 'DEPLOY_CODE job definition prepared.'
