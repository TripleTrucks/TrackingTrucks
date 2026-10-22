#!/usr/bin/env bash
# Run: source devops/setup.sh
# Then: bash devops/rancher/deployRancher.sh
# Existing K3s, Traefik and cert-manager are required. Does not reinstall them.
set -Eeuo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-deploy}"
case "$MODE" in
  -h|--help)
    echo 'Usage: bash devops/rancher/deployRancher.sh [deploy|render]'
    echo 'Defaults: Rancher 2.15.1, one replica, Traefik, HTTPS 443, Rancher-generated TLS.'
    echo 'Settings: devops/orchestrator.yaml and devops/rancher/rancherConfig.yaml.'
    echo 'Overrides: RANCHER_HOSTNAME, RANCHER_CHART_VERSION, KUBE_CONTEXT, DEPLOY_TIMEOUT.'
    exit 0 ;;
  deploy|render) ;;
  *) echo "Unknown mode: $MODE" >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo 'Too many arguments.' >&2; exit 2; }
source "$ROOT/../config.sh"
CHART_VERSION="$RANCHER_CHART_VERSION"
TIMEOUT="$DEPLOY_TIMEOUT"
[[ "$RANCHER_INSTANCE_NAME" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo 'RANCHER_INSTANCE_NAME must contain lowercase letters, digits or hyphens.' >&2; exit 2;
}
hostname="$RANCHER_HOSTNAME"
[[ "$hostname" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || {
  echo 'The hostname must be a DNS name, without a scheme, path or port.' >&2; exit 2;
}
command -v helm >/dev/null || { echo 'Install Helm 3 first.' >&2; exit 1; }
[[ "$(helm version --short)" == v3.* ]] || { echo 'Helm 3 is required.' >&2; exit 1; }
values=(-f "$ROOT/rancherConfig.yaml" --set-string "hostname=$hostname")
trap 'echo "Rancher failed at line $LINENO. Inspect: kubectl --context \"${KUBE_CONTEXT:-default}\" -n cattle-system get pods,events" >&2' ERR
if [[ "$MODE" == deploy ]]; then
  command -v kubectl >/dev/null || { echo 'Install kubectl first.' >&2; exit 1; }
  if [[ -z "${KUBECONFIG:-}" ]]; then
    if [[ -r "$HOME/.kube/trackingtrucks-k3s.yaml" ]]; then
      export KUBECONFIG="$HOME/.kube/trackingtrucks-k3s.yaml"
    elif [[ -r "$HOME/.kube/config" ]]; then
      export KUBECONFIG="$HOME/.kube/config"
    else
      echo "First run: source \"$ROOT/../setup.sh\"" >&2; exit 1
    fi
  fi
  KUBE_CONTEXT="${KUBE_CONTEXT:-$(kubectl config current-context)}"
  kube=(kubectl --context "$KUBE_CONTEXT")
  "${kube[@]}" get namespace default >/dev/null
  "${kube[@]}" get ingressclass traefik >/dev/null
  "${kube[@]}" get crd certificates.cert-manager.io >/dev/null || {
    echo 'Install cert-manager before deploying Rancher with generated TLS.' >&2; exit 1;
  }
  "${kube[@]}" -n cert-manager rollout status deployment/cert-manager --timeout="$TIMEOUT"
  "${kube[@]}" -n cert-manager rollout status deployment/cert-manager-webhook --timeout="$TIMEOUT"
  if ! getent ahostsv4 "$hostname" >/dev/null; then
    echo "DNS is not ready for $hostname. Add a DNS/hosts entry on the server and your browsing devices, then rerun this script." >&2
    exit 2
  fi
  printf 'Deploying %s: Rancher %s, context %s, URL https://%s\n' "$RANCHER_INSTANCE_NAME" "$CHART_VERSION" "$KUBE_CONTEXT" "$hostname"
fi
helm repo add rancher-stable https://releases.rancher.com/server-charts/stable --force-update >&2
helm repo update rancher-stable >&2
if [[ "$MODE" == render ]]; then
  helm template rancher rancher-stable/rancher --version "$CHART_VERSION" --kube-version "${KUBE_VERSION}" \
    --namespace cattle-system "${values[@]}"
  exit 0
fi
# Preserve existing release settings, including initial authentication settings.
# Explicit values in the repository override only the options we manage.
helm upgrade --install rancher rancher-stable/rancher \
  --kube-context "$KUBE_CONTEXT" --namespace cattle-system --create-namespace \
  --version "$CHART_VERSION" --reuse-values "${values[@]}" \
  --wait --timeout "$TIMEOUT" --history-max 10
"${kube[@]}" -n cattle-system rollout status deployment/rancher --timeout="$TIMEOUT"
"${kube[@]}" -n cattle-system wait --for=condition=Ready certificate/tls-rancher-ingress --timeout="$TIMEOUT"
"${kube[@]}" patch clusters.management.cattle.io local --type merge \
  -p "{\"spec\":{\"displayName\":\"$RANCHER_INSTANCE_NAME\"}}"
printf 'Rancher is ready at https://%s (HTTPS port 443).\n' "$hostname"
echo 'The certificate uses the Rancher private CA. Trust that CA on your browsing device.'
echo 'Complete initial admin setup in the browser; no password is stored in this repository.'
echo "Initial password command: kubectl --context '$KUBE_CONTEXT' -n cattle-system get secret bootstrap-secret -o go-template='{{.data.bootstrapPassword|base64decode}}'"
