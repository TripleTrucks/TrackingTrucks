#!/usr/bin/env bash
# Run explicitly on each node. Only the public CA certificate is needed here.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
endpoint="${1:-$(cat "$ROOT/.local/endpoint")}"
ca_file="${2:-$ROOT/.local/ca.crt}"
[[ "$endpoint" =~ ^[A-Za-z0-9.-]+:30500$ ]] || { echo 'Expected host:30500' >&2; exit 1; }
openssl x509 -in "$ca_file" -noout -checkend 0 >/dev/null
sudo install -m 644 "$ca_file" /etc/rancher/k3s/trackingtrucks-artifacts-ca.crt
sudo python3 - "$endpoint" <<'PY'
import datetime
from pathlib import Path
import shutil
import sys
import yaml
path = Path('/etc/rancher/k3s/registries.yaml')
config = (yaml.safe_load(path.read_text()) or {}) if path.exists() else {}
tls = config.setdefault('configs', {}).setdefault(sys.argv[1], {}).setdefault('tls', {})
tls['ca_file'] = '/etc/rancher/k3s/trackingtrucks-artifacts-ca.crt'
tls.pop('insecure_skip_verify', None)
if path.exists():
    shutil.copy2(path, str(path) + '.backup-' + datetime.datetime.now().strftime('%Y%m%d%H%M%S'))
path.write_text(yaml.safe_dump(config))
path.chmod(0o600)
PY
sudo systemctl restart "${K3S_SERVICE:-k3s}"
echo 'Registry trust configured. Check node readiness before deploying application code.'
