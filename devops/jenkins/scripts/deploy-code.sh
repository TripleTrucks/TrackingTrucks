#!/usr/bin/env bash
set -euo pipefail
: "${DEPLOY_NAMESPACE:?}"
: "${DEPLOY_IMAGE:?}"
: "${RELEASE_ID:?}"
: "${IMAGE_REPOSITORY:?}"
[[ "$DEPLOY_NAMESPACE" == production ]] || { echo 'Only production is supported' >&2; exit 1; }
[[ "$DEPLOY_IMAGE" == "$IMAGE_REPOSITORY"@sha256:* && "${DEPLOY_IMAGE##*@}" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo 'Deployment requires a digest in the configured image repository' >&2; exit 1;
}
[[ "$RELEASE_ID" =~ ^[A-Za-z0-9_.-]+$ ]] || exit 1
case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo 'Unsupported architecture' >&2; exit 1 ;;
esac
version=v1.36.4
bin_dir="$(mktemp -d)"
trap 'rm -rf -- "$bin_dir"' EXIT
curl -fsSL --retry 3 "https://dl.k8s.io/release/$version/bin/linux/$arch/kubectl" -o "$bin_dir/kubectl"
curl -fsSL --retry 3 "https://dl.k8s.io/release/$version/bin/linux/$arch/kubectl.sha256" -o "$bin_dir/kubectl.sha256"
printf '%s  %s\n' "$(cat "$bin_dir/kubectl.sha256")" "$bin_dir/kubectl" | sha256sum --check
chmod +x "$bin_dir/kubectl"
export PATH="$bin_dir:$PATH"

service_account=/var/run/secrets/kubernetes.io/serviceaccount
[[ -r "$service_account/token" && -r "$service_account/ca.crt" ]] || {
  echo 'Run this script in the Jenkins build pod with serviceAccountName: deploy-code.' >&2
  exit 1
}
export KUBECONFIG="$bin_dir/kubeconfig"
cat > "$KUBECONFIG" <<'YAML'
apiVersion: v1
kind: Config
clusters:
  - name: cluster
    cluster:
      server: https://kubernetes.default.svc
      certificate-authority: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
users:
  - name: deploy-code
    user:
      tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
contexts:
  - name: deploy-code
    context:
      cluster: cluster
      user: deploy-code
current-context: deploy-code
YAML

kube() {
  kubectl --namespace="$DEPLOY_NAMESPACE" --request-timeout=15s "$@"
}

# Save the entire previous spec, including the old PVC layout during the first migration.
kube get deployment trackingtrucks --ignore-not-found -o json > "$bin_dir/previous.json"
node - "$bin_dir/previous.json" <<'JS'
const fs = require('node:fs');
const path = process.argv[2];
const text = fs.readFileSync(path, 'utf8');
if (text.trim()) {
  const old = JSON.parse(text);
  for (const key of ['resourceVersion', 'uid', 'creationTimestamp', 'generation', 'managedFields']) delete old.metadata[key];
  if (old.metadata.annotations) delete old.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
  delete old.status;
  fs.writeFileSync(path, JSON.stringify(old));
}
JS
changed=false
verified=false
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [[ "$changed" == true && "$verified" != true ]]; then
    echo 'Release failed; restoring the previous Deployment.' >&2
    if [[ -s "$bin_dir/previous.json" ]]; then
      if ! kube apply -f "$bin_dir/previous.json" || ! kube rollout status deployment/trackingtrucks --timeout=5m; then
        echo 'AUTOMATIC ROLLBACK FAILED: inspect production/trackingtrucks immediately.' >&2
      fi
    else
      kube scale deployment trackingtrucks --replicas=0 || true
    fi
  fi
  rm -rf -- "$bin_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

node > "$bin_dir/deployment.json" <<'JS'
const labels = {app: 'trackingtrucks'};
const deployment = {
  apiVersion: 'apps/v1', kind: 'Deployment',
  metadata: {name: 'trackingtrucks', namespace: process.env.DEPLOY_NAMESPACE},
  spec: {
    replicas: 1,
    revisionHistoryLimit: 10,
    minReadySeconds: 10,
    progressDeadlineSeconds: 300,
    selector: {matchLabels: labels},
    strategy: {type: 'RollingUpdate', rollingUpdate: {maxUnavailable: 0, maxSurge: 1}},
    template: {
      metadata: {
        labels,
        annotations: {
          'trackingtrucks/release': process.env.RELEASE_ID,
          'trackingtrucks/commit': process.env.DEPLOY_COMMIT,
          'trackingtrucks/branch': process.env.BRANCH
        }
      },
      spec: {
        automountServiceAccountToken: false,
        imagePullSecrets: [{name: 'registry-reader'}],
        securityContext: {runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000},
        containers: [{
          name: 'app',
          image: process.env.DEPLOY_IMAGE,
          imagePullPolicy: 'IfNotPresent',
          securityContext: {runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: {drop: ['ALL']}},
          ports: [{name: 'http', containerPort: 5173}],
          readinessProbe: {httpGet: {path: '/index.html', port: 'http'}, periodSeconds: 5},
          livenessProbe: {httpGet: {path: '/healthz', port: 'http'}, periodSeconds: 10},
          resources: {requests: {cpu: '100m', memory: '64Mi'}, limits: {cpu: '1', memory: '256Mi'}},
          volumeMounts: [{name: 'tmp', mountPath: '/tmp'}]
        }],
        volumes: [{name: 'tmp', emptyDir: {}}]
      }
    }
  }
};
const service = {
  apiVersion: 'v1', kind: 'Service',
  metadata: {name: 'trackingtrucks', namespace: process.env.DEPLOY_NAMESPACE},
  spec: {type: 'ClusterIP', selector: labels, ports: [{name: 'http', port: 80, targetPort: 'http'}]}
};
process.stdout.write(JSON.stringify({apiVersion: 'v1', kind: 'List', items: [deployment, service]}));
JS
changed=true
kube apply -f "$bin_dir/deployment.json"
kube rollout status deployment/trackingtrucks --timeout=6m
# Verify traffic through the Service reaches this exact build, not just another healthy pod.
node <<'JS'
const fs = require('node:fs');
(async () => {
  const base = `http://trackingtrucks.${process.env.DEPLOY_NAMESPACE}.svc.cluster.local`;
  let lastError;
  for (let i = 0; i < 12; i++) {
    try {
      const response = await fetch(base + '/release.json', {signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const baked = await response.json();
      if (!/^[0-9a-f]{40,64}$/.test(baked.commit) ||
          (process.env.DEPLOY_COMMIT && (baked.commit !== process.env.DEPLOY_COMMIT || baked.release !== process.env.RELEASE_ID))) {
        throw new Error('Service still serves another build');
      }
      const index = await fetch(base + '/index.html', {signal: AbortSignal.timeout(5000)});
      if (!index.ok || !(await index.text()).includes('<html')) throw new Error('Invalid application index');
      const release = {image: process.env.DEPLOY_IMAGE, commit: baked.commit, branch: baked.branch, sourceRelease: baked.release};
      Object.assign(release, {deployment: process.env.RELEASE_ID, buildUrl: process.env.BUILD_URL,
        deployedAt: new Date().toISOString(), status: 'verified'});
      fs.writeFileSync('release.json', JSON.stringify(release, null, 2) + '\n');
      return;
    } catch (err) { lastError = err; await new Promise(resolve => setTimeout(resolve, 5000)); }
  }
  throw lastError;
})().catch(err => { console.error(err); process.exitCode = 1; });
JS
verified=true
echo "Ready: $DEPLOY_IMAGE at https://$APP_HOST"
