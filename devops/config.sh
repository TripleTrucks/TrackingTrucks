#!/usr/bin/env bash
# Shared YAML configuration loader. Source from deployment scripts.
# Explicit environment overrides take precedence over the YAML.
_load_orchestrator_config() {
  local config_file assignments
  config_file="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/orchestrator.yaml"
  assignments="$(python3 - "$config_file" <<'PY'
import os
from pathlib import Path
import shlex
import sys
import yaml

config = yaml.safe_load(Path(sys.argv[1]).read_text())
fields = {
    'KUBE_CONTEXT': ('cluster', 'context'),
    'DEPLOY_TIMEOUT': ('cluster', 'timeout'),
    'RANCHER_HOSTNAME': ('rancher', 'hostname'),
    'RANCHER_INSTANCE_NAME': ('rancher', 'instance_name'),
    'RANCHER_CHART_VERSION': ('rancher', 'chart_version'),
    'KUBE_VERSION': ('rancher', 'kubernetes_version'),
    'JENKINS_CHART_VERSION': ('jenkins', 'chart_version'),
}
for variable, (section, key) in fields.items():
    value = os.environ.get(variable) or config[section][key]
    if not isinstance(value, str) or ('\n' in value or '\r' in value):
        raise ValueError(f'{section}.{key} must be a single-line string')
    if not value and variable != 'KUBE_CONTEXT':
        raise ValueError(f'{section}.{key} must not be empty')
    print(f'export {variable}={shlex.quote(value)}')
PY
)" || return 1
  # Names are fixed above; every value is shell-quoted by shlex, never raw YAML.
  eval "$assignments"
}
if _load_orchestrator_config; then
  unset -f _load_orchestrator_config
else
  unset -f _load_orchestrator_config
  return 1
fi
