#!/usr/bin/env bash
# Install the registry, or add its Tailscale Serve route with --serve.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STATE="$ROOT/.local"
mode="${1:-deploy}"
case "$mode" in deploy|--serve) ;; *) echo 'Usage: deploy.sh [--serve]' >&2; exit 2 ;; esac
for tool in kubectl helm; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
[[ -s "$STATE/endpoint" ]] || { echo 'First run: python3 artifacts/prepare.py' >&2; exit 1; }
if [[ -z "${KUBECONFIG:-}" && -r "$HOME/.kube/trackingtrucks-k3s.yaml" ]]; then
  export KUBECONFIG="$HOME/.kube/trackingtrucks-k3s.yaml"
fi
context="${KUBE_CONTEXT:-$(kubectl config current-context)}"
kube=(kubectl --context "$context")
if [[ "$mode" == --serve ]]; then
  # Run on a K3s node with Tailscale. Discover the NodePort instead of hardcoding a node IP.
  command -v tailscale >/dev/null || { echo 'Missing tailscale' >&2; exit 1; }
  service="${TAILSCALE_SERVICE:-registry}"
  [[ "$service" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || { echo 'Invalid Tailscale service name' >&2; exit 1; }
  port="$("${kube[@]}" -n artifacts get service artifacts-zot -o 'jsonpath={.spec.ports[?(@.port==5000)].nodePort}')"
  [[ "$port" =~ ^[0-9]+$ ]] || { echo 'Registry NodePort not found; deploy Zot first.' >&2; exit 1; }
  # Browser TLS is managed by Tailscale. Only the loopback backend skips verification
  # because Zot uses our private CA and its certificate does not name 127.0.0.1.
  sudo tailscale serve --bg --service="svc:$service" --https=443 "https+insecure://127.0.0.1:$port"
  echo "Tailscale route configured for svc:$service on HTTPS 443."
  echo 'Approve this service host in Tailscale if required by your tailnet policy.'
  exit 0
fi

for namespace in artifacts production; do
  "${kube[@]}" create namespace "$namespace" --dry-run=client -o yaml | "${kube[@]}" apply -f -
done
"${kube[@]}" -n artifacts create secret tls artifacts-tls --cert="$STATE/tls.crt" --key="$STATE/tls.key" \
  --dry-run=client -o yaml | "${kube[@]}" apply -f -
"${kube[@]}" -n artifacts create secret generic artifacts-users --from-file="htpasswd=$STATE/htpasswd" \
  --dry-run=client -o yaml | "${kube[@]}" apply -f -
# Application pulls use a read-only identity; only Jenkins can create image tags.
for user in jenkins reader; do
  "${kube[@]}" -n production create secret generic "registry-$user" --type=kubernetes.io/dockerconfigjson \
    --from-file=".dockerconfigjson=$STATE/$user.dockerconfig.json" --dry-run=client -o yaml | "${kube[@]}" apply -f -
done
"${kube[@]}" -n production create configmap registry-ca --from-file="ca.crt=$STATE/ca.crt" \
  --dry-run=client -o yaml | "${kube[@]}" apply -f -
"${kube[@]}" -n production create configmap registry-buildkit --from-file="buildkitd.toml=$STATE/buildkitd.toml" \
  --dry-run=client -o yaml | "${kube[@]}" apply -f -
"${kube[@]}" -n production create configmap registry-settings --from-literal="IMAGE_REPOSITORY=$(cat "$STATE/endpoint")/trackingtrucks" \
  --dry-run=client -o yaml | "${kube[@]}" apply -f -
helm upgrade --install artifacts oci://ghcr.io/project-zot/helm-charts/zot \
  --version 0.1.128 --namespace artifacts --kube-context "$context" \
  --values "$ROOT/values.yaml" --values "$STATE/helm-private.json" \
  --wait --timeout 5m --history-max 5
printf 'Registry installed: https://%s\nNext: configure K3s trust, then refresh Jenkins (see devops/README.md).\n' "$(cat "$STATE/endpoint")"

echo 'Cluster DNS: artifacts-zot.artifacts.svc.cluster.local:5000'
echo 'To expose it through Tailscale, run on a K3s node: bash artifacts/deploy.sh --serve'
