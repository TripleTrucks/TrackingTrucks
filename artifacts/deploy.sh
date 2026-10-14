#!/usr/bin/env bash
# Installs only the registry and its client credentials; never deploys application code.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STATE="$ROOT/.local"
for tool in kubectl helm; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
[[ -s "$STATE/endpoint" ]] || { echo 'First run: python3 artifacts/prepare.py' >&2; exit 1; }
if [[ -z "${KUBECONFIG:-}" && -r "$HOME/.kube/trackingtrucks-k3s.yaml" ]]; then
  export KUBECONFIG="$HOME/.kube/trackingtrucks-k3s.yaml"
fi
context="${KUBE_CONTEXT:-$(kubectl config current-context)}"
kube=(kubectl --context "$context")
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
printf 'Registry installed: https://%s\nNext: configure K3s trust, then refresh Jenkins (see artifacts/README.md).\n' "$(cat "$STATE/endpoint")"
