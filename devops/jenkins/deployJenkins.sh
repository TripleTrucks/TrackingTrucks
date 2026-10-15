#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE=jenkins
RELEASE=jenkins
VERSION="${JENKINS_CHART_VERSION:-5.9.64}"
TIMEOUT="${DEPLOY_TIMEOUT:-20m}"
VALUES="$ROOT/jenkinsConfig.yaml"

for tool in kubectl helm python3; do
  command -v "$tool" >/dev/null || {
    echo "Missing required tool: $tool" >&2
    exit 1
  }
done

[[ -f "$VALUES" ]] || {
  echo "Missing configuration: $VALUES" >&2
  exit 1
}

# Support direct execution after the initial kubeconfig setup.
if [[ -z "${KUBECONFIG:-}" ]]; then
  if [[ -r "$HOME/.kube/trackingtrucks-k3s.yaml" ]]; then
    export KUBECONFIG="$HOME/.kube/trackingtrucks-k3s.yaml"
  elif [[ -r "$HOME/.kube/config" ]]; then
    export KUBECONFIG="$HOME/.kube/config"
  else
    echo "First run: source \"$ROOT/../setup.sh\"" >&2
    exit 1
  fi
fi

CONTEXT="${KUBE_CONTEXT:-$(kubectl config current-context)}"
kube=(kubectl --context "$CONTEXT")

"${kube[@]}" get namespace default >/dev/null
"${kube[@]}" get storageclass local-path >/dev/null

printf 'Deploying Jenkins %s into namespace %s on context %s\n' \
  "$VERSION" "$NAMESPACE" "$CONTEXT"

# Install artifacts/ first. Fail before changing Jenkins if registry clients are absent.
"${kube[@]}" -n production get configmap registry-settings registry-ca registry-buildkit >/dev/null
"${kube[@]}" -n production get secret registry-jenkins registry-reader -o name >/dev/null

# Seed DEPLOY_CODE and publish its scripts alongside the Jenkins installation.
JOB_CONFIG="$(mktemp)"
trap 'rm -f -- "$JOB_CONFIG"' EXIT
bash "$ROOT/scripts/seed-jobs.sh" "$CONTEXT" "$JOB_CONFIG"

helm repo add jenkins https://charts.jenkins.io --force-update
helm repo update jenkins

helm upgrade --install "$RELEASE" jenkins/jenkins \
  --kube-context "$CONTEXT" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --version "$VERSION" \
  --set-file "controller.JCasC.configScripts.deploy-code=$JOB_CONFIG" \
  --set-string "controller.podAnnotations.deploy-code-revision=$(date -u +%Y%m%dT%H%M%SZ)" \
  --values "$VALUES" \
  --wait \
  --timeout "$TIMEOUT" \
  --history-max 10

"${kube[@]}" -n "$NAMESPACE" rollout status \
  statefulset/jenkins --timeout="$TIMEOUT"

"${kube[@]}" -n "$NAMESPACE" get pods,svc,pvc

echo 'Jenkins is ready in namespace jenkins.'
echo 'Access: kubectl -n jenkins port-forward svc/jenkins 8080:8080'
echo 'Login username: admin'
echo "Password: kubectl -n jenkins get secret jenkins -o jsonpath='{.data.jenkins-admin-password}' | base64 -d; echo"