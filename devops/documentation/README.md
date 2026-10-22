# TrackingTrucks: Ubuntu/Debian deployment guide

This guide takes a new administrator from a Linux server to a running TrackingTrucks production frontend. Run commands on the server in Bash unless a step explicitly says otherwise. The repository's deployment scripts manage an existing Kubernetes cluster; they do not install the operating system or K3s for you.

The supported layout in this repository is a **single K3s node**, with Rancher, Jenkins and Zot running in separate namespaces. Rancher provides the management UI; Jenkins runs on Kubernetes, not inside the Rancher container. Tailscale Services provide private HTTPS browser access.

**Installation order:** Linux tools → K3s → Helm/shell configuration → Tailscale → cert-manager/Rancher → Zot → Jenkins → application.

If this stack is already installed, skip installation steps and use [routine deployment](#9-routine-deployment-and-rollback). Do not overwrite an existing K3s configuration or reinstall the cluster to update the app.

For PR build/lint checks and automatic testing deployments after `development` updates, follow the [in-cluster GitHub Actions runner setup](../rancher/actions-runner/README.md) after installing Jenkins. Its configuration lives under `devops/rancher/actions-runner`; credentials are loaded from the ignored root `.env` into Kubernetes Secrets. GitHub-hosted runners check PRs, and a cluster runner triggers Jenkins through internal DNS without WARP/Tailscale credentials.

## 1. Requirements

### Server

- A maintained Ubuntu Server or Debian release with systemd, Bash, sudo access and a working package manager. Development of this deployment used Ubuntu; Debian uses the same tools, but is not independently certified by this repository.
- An amd64 server is the reference platform. Some scripts handle arm64, but verify all container images and dependencies before using another architecture.
- A practical starting allocation for the **whole stack** is 4 CPU cores, 8 GiB RAM and 100–150 GiB SSD storage; 16 GiB RAM gives more build headroom. These are project planning estimates, not minimum vendor requirements or a capacity guarantee.
- A stable LAN IP, preferably reserved in DHCP, and correct system time. Registry certificates and credentials bind to the prepared registry address.
- Internet access for Git, npm, Helm charts, container images and the checksum-verified kubectl download used by deployment jobs.
- Linux namespaces/cgroups and a Kubernetes security policy that permits rootless BuildKit with unconfined seccomp/AppArmor in its build container.

K3s includes containerd, so host Docker is **not required**. Host Node.js, Java and .NET are also not needed for this deployment path: Jenkins/build tools run in containers. The current job packages the React/Vite frontend; it does **not** install the `Backend/` .NET service, a database or an Electron desktop application.

For node networking, firewall and architecture prerequisites, see the [K3s requirements](https://docs.k3s.io/installation/requirements). Do not open Kubernetes API or overlay networking ports to the public Internet as a shortcut.

### Accounts and access

- Git repository access for the administrator cloning the project.
- A Git SSH key for Jenkins, stored as a Jenkins credential, with permission to read the application repository.
- A Tailscale tailnet with MagicDNS, HTTPS certificates and permission to create Services/approve service hosts.
- A tailnet-connected workstation for browsing the management endpoints.

### Version reference

These are the repository defaults or versions observed on the existing server when this guide was written. They are **not a vendor compatibility certification**. Before building a different stack, check Rancher's support matrix and the cert-manager/K3s requirements; keep related pins consistent.

| Component | Version/reference | Defined in |
| --- | --- | --- |
| K3s | Reference cluster `v1.36.4+k3s1` | Host installation; deploy script downloads kubectl `v1.36.4` |
| Helm | **3.x required** by the Rancher script | Host tool |
| cert-manager | Existing installation `v1.21.2` | Installed separately below |
| Rancher chart | `2.15.1` | `devops/setup.sh`, Rancher script defaults |
| Jenkins chart | `5.9.64` | `devops/jenkins/deployJenkins.sh` |
| Jenkins plugins | Explicit version pins | `devops/jenkins/jenkinsConfig.yaml` |
| Zot chart / image | `0.1.128` / `v2.1.22` | `artifacts/deploy.sh`, `artifacts/values.yaml` |
| Node build container | `node:24-bookworm` | Jenkinsfile |
| BuildKit | `moby/buildkit:v0.23.2-rootless` | Jenkinsfile |
| Application web server | `nginx:1.28-alpine` | Deployment Dockerfile |

### Install basic tools and clone

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssh-client openssl python3 python3-bcrypt python3-yaml

git clone git@github.com:ZenMastering/TrackingTrucks.git
cd TrackingTrucks
```

Use your fork's URL if applicable. The examples below assume this working directory; return to it before running commands containing `devops/` or `artifacts/`.

Some existing shell scripts have Windows CRLF line endings. If needed, normalize the two scripts used by the shell/Rancher setup before running them:

```bash
sed -i 's/\r$//' devops/setup.sh devops/rancher/deployRancher.sh
```

An error mentioning `$'\r'` or `in\r` indicates a line-ending problem, not a Kubernetes failure.

## 2. Create the K3s cluster

**Fresh servers only.** If `sudo k3s kubectl get nodes` already works, inspect the current setup instead of replacing it.

K3s reads host configuration from `/etc/rancher/k3s/config.yaml`. This is separate from the repository's Helm values files. A minimal single-server configuration with embedded etcd is:

```bash
sudo install -d -m 755 /etc/rancher/k3s
sudo tee /etc/rancher/k3s/config.yaml >/dev/null <<'YAML'
cluster-init: true
write-kubeconfig-mode: "0600"
YAML
```

Keep the default Traefik, ServiceLB, CoreDNS and local-path storage components enabled: the repository expects them. On a machine with multiple network interfaces, configure K3s's `node-ip` explicitly if autodetection selects the wrong address. Use the stable LAN address, not an address copied from this guide.

Download and review the official installer, then install the reference version:

```bash
curl -fsSL https://get.k3s.io -o /tmp/install-trackingtrucks-k3s.sh
less /tmp/install-trackingtrucks-k3s.sh
sudo env INSTALL_K3S_VERSION='v1.36.4+k3s1' sh /tmp/install-trackingtrucks-k3s.sh
sudo systemctl status k3s --no-pager
sudo k3s kubectl get nodes -o wide
sudo k3s kubectl -n kube-system get pods
```

Wait for the node to become `Ready`. The installer normally provides the `kubectl` command as well. Confirm with `command -v kubectl`.

The configuration enables a single embedded-etcd server, not high availability. Additional server/agent nodes need a separate networking, storage and availability plan. See the upstream [quick start](https://docs.k3s.io/quick-start) and [configuration documentation](https://docs.k3s.io/installation/configuration).

## 3. Install Helm and prepare your shell

Install **Helm 3**, because the Rancher script rejects Helm 4. Use the official Helm 3 installation instructions; one method is:

```bash
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 -o /tmp/install-trackingtrucks-helm.sh
less /tmp/install-trackingtrucks-helm.sh
bash /tmp/install-trackingtrucks-helm.sh
helm version --short
```

The version output must start with `v3.`. See [Helm 3 installation](https://docs.helm.sh/docs/v3/intro/install/).

From the repository root, configure your own Rancher hostname before sourcing setup:

```bash
export RANCHER_HOSTNAME=cluster1.tail7af369.ts.net
source devops/setup.sh
kubectl config current-context
kubectl get nodes -o wide
kubectl get storageclass local-path
kubectl get ingressclass traefik
```

Replace `tail7af369.ts.net` throughout this guide with your own tailnet suffix when installing elsewhere.

`setup.sh`:

- Checks that Bash, Helm and kubectl exist.
- Selects a kubeconfig and current context, honoring `KUBECONFIG` and `KUBE_CONTEXT` overrides.
- When necessary, uses sudo to copy K3s credentials into `~/.kube/trackingtrucks-k3s.yaml`, readable only by your user.
- Exports deployment settings and adds convenience shell functions/paths.
- Does **not** install or deploy any cluster component.

Source it again in each new shell. The kubeconfig grants cluster administrator access: do not commit it or make it world-readable. If another kubeconfig is selected unintentionally, explicitly set `KUBECONFIG`/`KUBE_CONTEXT` before sourcing.

### What the repository YAML files mean

| File | Purpose |
| --- | --- |
| [`rancher/rancherConfig.yaml`](../rancher/rancherConfig.yaml) | Rancher Helm values: hostname, one replica, Traefik ingress, private-CA TLS. The `deployment` section describes the intended installation; the shell script does not execute its Tailscale settings. |
| [`jenkins/jenkinsConfig.yaml`](../jenkins/jenkinsConfig.yaml) | Jenkins controller resources, storage, plugin pins and Configuration as Code settings. |
| [`jenkins/environments.yaml`](../jenkins/environments.yaml) | Production namespace/hostname read when the job is seeded. Testing/staging entries do not create corresponding deployment jobs. |
| [`jenkins/scripts/deploy-code-rbac.yaml`](../jenkins/scripts/deploy-code-rbac.yaml) | Production namespace, deployment service account/RBAC, Jenkins agent permissions, and legacy release PVC. |
| [`artifacts/values.yaml`](../../artifacts/values.yaml) | Zot resources, PVC, NodePort, TLS/authentication and read/push policies. |
| [`jenkins/jobs/deployCode.Jenkinsfile`](../jenkins/jobs/deployCode.Jenkinsfile) | Job parameters, temporary agent Pod YAML and deployment stages. |

Helm values files are inputs to Helm charts; do not `kubectl apply -f` them. The deployment scripts supply the proper chart, release and namespace. The application Deployment and Service are generated by `deploy-code.sh`, rather than a separate application manifest file.

## 4. Set up Tailscale and service names

Install Tailscale using the [Ubuntu/Debian instructions](https://tailscale.com/docs/install/linux), then authenticate the server:

```bash
curl -fsSL https://tailscale.com/install.sh -o /tmp/install-trackingtrucks-tailscale.sh
less /tmp/install-trackingtrucks-tailscale.sh
sh /tmp/install-trackingtrucks-tailscale.sh
sudo tailscale up
```

In the Tailscale console, enable MagicDNS/HTTPS and create the following Services with TCP port 443. Authorize this server as a tagged service host according to your tailnet policy; the existing setup uses `tag:server`. Defining a Service, authorizing clients, and approving its host are Tailscale control-plane tasks, not actions performed by the project's Helm charts. See [Tailscale Services setup](https://tailscale.com/docs/features/tailscale-services).

| Tailscale Service | Browser address in the current tailnet | Backend |
| --- | --- | --- |
| `svc:cluster1` | `https://cluster1.tail7af369.ts.net` | Node Traefik port 443, TLS passthrough to Rancher |
| `svc:jenkins` | `https://jenkins.tail7af369.ts.net` | Jenkins ClusterIP port 8080, TLS terminated by Tailscale |
| `svc:registry` | `https://registry.tail7af369.ts.net` | Local registry NodePort, HTTPS reverse proxy |
| `svc:production` | `https://production.tail7af369.ts.net` | Application ClusterIP port 80, TLS terminated by Tailscale |

These addresses are private to permitted tailnet clients. A Cloudflare tunnel is not required by this setup and is not configured by these scripts.

## 5. Install cert-manager and Rancher

The Rancher script requires cert-manager to exist already. On a new cluster:

```bash
helm upgrade --install cert-manager oci://quay.io/jetstack/charts/cert-manager \
  --namespace cert-manager --create-namespace --version v1.21.2 \
  --set crds.enabled=true --wait --timeout 5m
kubectl -n cert-manager get pods
kubectl get crd certificates.cert-manager.io
```

The version above matches the existing server; use a compatible pinned version when changing Kubernetes. See the [cert-manager Helm installation guide](https://cert-manager.io/docs/installation/helm/).

Edit `devops/rancher/rancherConfig.yaml` and/or set `RANCHER_HOSTNAME` to your own hostname. Set `RANCHER_INSTANCE_NAME` if you want a cluster display name other than `cluster1`. The script's defaults and exported environment variables control chart version/context/timeouts; editing descriptive keys under `deployment:` alone does not change every command.

Create the Tailscale route to this node's Traefik HTTPS listener. For this single-node setup:

```bash
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
sudo tailscale serve --bg --service=svc:cluster1 --tcp=443 "tcp://$NODE_IP:443"
getent ahostsv4 "$RANCHER_HOSTNAME"
```

Approve the service host if required. DNS must resolve before the Rancher deployment script proceeds. Optionally preview chart rendering without applying cluster resources:

```bash
bash devops/rancher/deployRancher.sh render > /tmp/trackingtrucks-rancher.yaml
```

Deploy Rancher:

```bash
bash devops/rancher/deployRancher.sh
kubectl -n cattle-system get pods,ingress,certificates
```

This installs/upgrades Rancher in `cattle-system`, waits for the deployment/certificate and sets the local cluster display name. Open the configured Rancher URL and complete initial admin setup. Retrieve the generated bootstrap password on the server:

```bash
kubectl -n cattle-system get secret bootstrap-secret \
  -o go-template='{{.data.bootstrapPassword|base64decode}}'
echo
```

Rancher's route uses TLS passthrough and its own private CA, unlike the Tailscale-terminated Jenkins endpoint. Obtain the public CA certificate and trust it on your administrator workstation:

```bash
kubectl -n cattle-system get secret tls-ca -o jsonpath='{.data.cacerts\.pem}' \
  | base64 -d > /tmp/trackingtrucks-rancher-ca.crt
```

Do not export the CA's private key. Rancher is a management interface; the subsequent scripts deploy through kubectl/Helm directly.

## 6. Install the Zot image registry

Zot must be installed **before refreshing Jenkins**: the Jenkins deployment script checks that registry configuration and client credentials exist.

```bash
python3 artifacts/prepare.py
bash artifacts/deploy.sh
kubectl -n artifacts get sts,pods,svc,pvc
```

Preparation performs a read-only cluster lookup and discovers the single node's internal IPv4 address. It creates credentials, a private CA and a server certificate under gitignored `artifacts/.local/`. An explicit stable IPv4 address or DNS name is accepted as an argument; multiple-node clusters require one. Repeated preparation preserves existing credentials and refuses an address change that would silently invalidate them.

The Helm deployment creates Zot in `artifacts`, then provides client configuration/credentials in `production`. Zot stores images on a 50 GiB local-path PVC. It has a `jenkins` identity that can read/create images, and a `reader` identity that can only read. Neither identity can overwrite tags or delete images under the supplied policy.

Install registry trust on the K3s node:

```bash
bash artifacts/trust-k3s.sh
kubectl wait --for=condition=Ready node --all --timeout=180s
kubectl -n artifacts get pods
```

**This step uses sudo and briefly restarts K3s.** It backs up/merges `/etc/rancher/k3s/registries.yaml` and installs the public CA. On additional agent nodes, copy only the public CA and use the script's documented `K3S_SERVICE=k3s-agent` option. Do not restart all nodes simultaneously in a larger cluster.

Enable browser access from the K3s/Tailscale service host:

```bash
bash artifacts/deploy.sh --serve
sudo tailscale serve status
```

This adds `svc:registry` on 443 while retaining other services. Open **https://registry.tail7af369.ts.net** and log in:

```text
Username: reader
Password: generated locally, not a default password
```

Display the password only in your own terminal:

```bash
cat artifacts/.local/reader.password
echo
```

### Three registry addresses, different purposes

| Address | Purpose |
| --- | --- |
| Prepared `NODE_IP:30500` in `.local/endpoint` | Current canonical image repository address for Jenkins/BuildKit and K3s pulls; private-CA TLS. |
| `artifacts-zot.artifacts.svc.cluster.local:5000` | Kubernetes Service DNS, normally resolvable within pods. The current certificate does not cover this name. |
| `registry.tail7af369.ts.net:443` | Tailnet browser access; Tailscale supplies the browser-facing certificate. |

Kubernetes image pulls happen on nodes, not through pod DNS. Do not replace the image repository address with a Service DNS name or browser hostname without migrating certificate and credential configuration. The existing image address does not depend on MagicDNS or Tailscale route availability.

For the registry browser route only, Serve uses `https+insecure` to the loopback NodePort because Zot's private certificate does not name `127.0.0.1`. Browser TLS verification and registry authentication remain enabled. See the [registry-specific guide](../../artifacts/README.md) for certificate renewal and backup details.

## 7. Deploy Jenkins and configure Git access

First review `devops/jenkins/environments.yaml`. Set `production.hostname` to your application URL without `https://`, a path or a port. Keep `production.namespace: production`; the job explicitly supports only that namespace.

```bash
bash devops/jenkins/deployJenkins.sh
kubectl -n jenkins get sts,pods,svc,pvc
```

The script:

1. Checks the selected cluster, local-path storage and registry client resources.
2. Runs `seed-jobs.sh` to prepare the `DEPLOY_CODE` Job DSL definition and production RBAC.
3. Publishes deployment scripts as the `deploy-code-scripts` ConfigMap, plus production settings as `deploy-code-settings`.
4. Installs/upgrades Jenkins with pinned chart/plugins and Configuration as Code, then waits for its StatefulSet.

Jenkins uses a 20 GiB persistent volume for controller state, credentials, job history and archived release metadata. Kubernetes agents are temporary pods in `production`. The controller's service account receives agent-management permissions there; the agent's `deploy-code` account receives application deployment permissions. The job does not use Rancher admin credentials or a host Docker socket.

### Access Jenkins

For initial local access:

```bash
kubectl -n jenkins port-forward svc/jenkins 8080:8080
```

Leave it running in its terminal. The address is `http://127.0.0.1:8080` on that machine. If your browser is on a workstation, use an SSH tunnel to the server's loopback port rather than exposing this forwarding port publicly.

For the permanent Tailscale route, use a second server terminal with `setup.sh` sourced:

```bash
JENKINS_IP=$(kubectl -n jenkins get service jenkins -o jsonpath='{.spec.clusterIP}')
sudo tailscale serve --bg --service=svc:jenkins --tls-terminated-tcp=443 "tcp://$JENKINS_IP:8080"
```

Open `https://jenkins.tail7af369.ts.net`. Log in as `admin` with the generated password:

```bash
kubectl -n jenkins get secret jenkins -o jsonpath='{.data.jenkins-admin-password}' | base64 -d
echo
```

If the administrator changed the account password after installation, use the current password instead of assuming the bootstrap Secret remains authoritative.

### Git credential

In **Manage Jenkins → Credentials → System → Global credentials**, add:

- Kind: **SSH Username with private key**.
- Username: `git` for GitHub SSH URLs.
- ID: `github-ssh`, matching the job default.
- Private key: a dedicated key with read access to this repository; include its passphrase if applicable.

Grant the corresponding public key repository access (for example, as a read-only GitHub deploy key). Do not put the private key in Git, `.env`, a Jenkinsfile or a build parameter. If deploying from a different Git host, also configure its verified SSH host key; the current JCasC settings pin GitHub's host key.

Check **Manage Jenkins → Clouds** for the Kubernetes cloud named `kubernetes`. The job requests this exact cloud name. With the chart's normal in-cluster configuration, Jenkins uses the cluster API and its service account. If agents remain pending or cannot connect, inspect this cloud's Jenkins URL/tunnel settings and production RBAC instead of granting cluster-admin access.

The job definition is seeded from the local repository, not dynamically loaded from the selected application branch. Rerun `deployJenkins.sh` after changing the Jenkinsfile, mounted scripts or environment settings. UI edits to the seeded job are not the source of truth.

## 8. First application deployment

In Jenkins, open **DEPLOY_CODE → Build with Parameters**:

| Parameter | First deployment |
| --- | --- |
| `IMAGE` | Leave blank |
| `BRANCH` | `main`, or the branch to deploy |
| `REPO_URL` | Your repository SSH URL |
| `GIT_CREDENTIALS_ID` | `github-ssh`, or the credential ID you created |

The job serializes builds and has a 40-minute timeout. It uses five agent containers: Jenkins inbound agent, Node for compilation/deployment scripts, rootless BuildKit for image creation, K3s for local image import, and Skopeo for publication. The import container runs as root with the host containerd socket mounted, which grants node-level control: restrict this job to trusted maintainers. Fresh builds are deployed on the agent’s node, matching the current single-node K3s setup.

| Stage | What it does |
| --- | --- |
| Prepare release | Creates an isolated workspace and checks out the selected branch; an `IMAGE` deployment skips checkout. |
| Compile application | Runs `npm ci --include=dev`, TypeScript checking and Vite build; records source metadata. Skipped for a saved image. |
| Build image | Packages `dist` and metadata into an OCI archive and imports it into the agent node’s K3s runtime without uploading to Zot. Skipped for a saved image. |
| Deploy and verify | Applies the Deployment/Service using the digest (fresh builds stay on the import node), waits for rollout readiness, and checks the served build metadata and application index. |
| Publish image | Runs only after deployment verification passes. Uploads the verified archive under a `release-…` tag without rebuilding or changing the digest. Saved-image deployments only add a release tag. |

The job archives `release.json`, including the published tag, in Jenkins and prints the exact image reference for rollback. The runtime is a non-root Nginx container serving port 5173; the `trackingtrucks` Service exposes port 80. It serves compiled production files rather than Vite's development server.

Confirm the first deployment:

```bash
kubectl -n production rollout status deployment/trackingtrucks --timeout=6m
kubectl -n production get pods,svc
kubectl -n production get deployment trackingtrucks -o jsonpath='{.spec.template.spec.containers[0].image}'
echo
```

Once the Service exists, configure application browser access:

```bash
APP_IP=$(kubectl -n production get service trackingtrucks -o jsonpath='{.spec.clusterIP}')
sudo tailscale serve --bg --service=svc:production --tls-terminated-tcp=443 "tcp://$APP_IP:80"
```

Approve the service host if needed, then open `https://production.tail7af369.ts.net`. Changing `production.hostname` alone does not create DNS or a Tailscale route. The URL must match the service you configured.

Jenkins/production routes use discovered ClusterIPs. They usually persist through upgrades, but if you delete and recreate a Service, rerun its Serve command with the new IP. The registry helper discovers its NodePort on each invocation.

## 9. Routine deployment and rollback

### Deploy the latest code on a branch

Run `DEPLOY_CODE` with `IMAGE` blank and the desired `BRANCH`. Production remains running during checkout, compilation and image upload. No infrastructure reinstall is necessary.

### Restore a previous build

1. Open a **successful** Jenkins build and copy its printed image reference or the `image` value in its archived `release.json`.
2. Run `DEPLOY_CODE` again, supplying its release tag or full `repository@sha256:digest` as `IMAGE`.
3. Leave the other parameters at their defaults; Git checkout and compilation are skipped.
4. Check the new rollout and the browser application.

A short release tag is resolved in the configured repository before deployment; Kubernetes then uses that immutable digest. Full tag and digest references must use the prepared repository, not the Tailscale browser hostname. The saved image already contains the compiled files and web server: restoring it does not rebuild dependencies.

### Failure and retention behavior

- No new application image is uploaded before readiness and Service checks pass. Failed deployments can leave an image in the node’s local cache, but do not reach publication. Publication failures leave the healthy application running; until upload succeeds it depends on that local cache. An interrupted upload may leave partial content in Zot. Registry publication and Jenkins completion are not atomic. Saved-image deployments still require K3s registry CA trust.
- The Deployment uses a rolling update with zero unavailable replicas and one surge replica. Failed rollout/health checks attempt to restore the previous Deployment spec. A first-ever failed deployment has no previous release and is scaled down.
- A hard process/node failure can prevent cleanup. If automatic restoration fails, inspect the Deployment and run a known-good image through the job once the underlying issue is resolved.
- A release-publication or Jenkins artifact-archive failure after a healthy rollout fails the job but leaves the healthy application running.
- Jenkins keeps 30 build records. Zot currently retains images independently, with no automatic garbage collection or retention policy. Save release digests outside expiring job history if they must remain discoverable long-term.
- The legacy `trackingtrucks-releases` PVC is still defined but new image deployments do not mount it. Keep it through migration from the original workspace deployment so the previous spec can be restored if necessary.

## 10. Operations and troubleshooting

### Useful inspection commands

```bash
kubectl get nodes -o wide
helm list -A
kubectl -n artifacts get pods,svc,pvc
kubectl -n artifacts logs statefulset/artifacts-zot --tail=100
kubectl -n jenkins logs statefulset/jenkins --tail=100
kubectl -n production get pods
kubectl -n production logs deployment/trackingtrucks --tail=100
kubectl -n production get events --sort-by=.lastTimestamp
sudo tailscale serve status
sudo journalctl -u k3s -n 100 --no-pager
```

| Symptom | Check |
| --- | --- |
| `kubectl` permission/connection error | Source `devops/setup.sh`; confirm kubeconfig/context and that K3s is running. Do not chmod the admin kubeconfig to 644. |
| Rancher script exits before Helm | Check Helm 3, Traefik ingress class, cert-manager CRDs/readiness and Rancher hostname resolution. |
| Jenkins deployment reports missing registry ConfigMaps/Secrets | Run registry preparation and deployment first. |
| Jenkins cannot fetch Git | Credential ID, `git` username, private-key/passphrase, repository permissions and verified host key. |
| Build pod pending or agent offline | Pod events, available CPU/memory, Kubernetes cloud name `kubernetes`, RBAC and Jenkins agent connectivity. |
| BuildKit permission error | Cluster restrictions on unprivileged user namespaces/AppArmor/seccomp. The job already requests the required container profiles; do not add host Docker socket mounts as a workaround. |
| `ImagePullBackOff` / unknown certificate authority | `registry-reader` Secret, exact registry host/port, node reachability, and registry CA configuration on **every** eligible node. |
| HTTP 401 from registry `/v2/` without credentials | Expected: authentication is enabled. Use the `reader` credentials for browsing. |
| Tailscale DNS resolves but page times out | Service host approval, tailnet access policy, Serve route and backend readiness. Verify from a permitted tailnet client; DNS resolution alone is not proof the route is active. |
| Old Linux tailnet client cannot reach Services | Check the Tailscale Services documentation and whether that client needs `sudo tailscale set --accept-routes`. |
| Direct registry/Service DNS certificate mismatch | Use the prepared address; its private certificate does not automatically cover localhost, cluster DNS or the Tailscale browser hostname. |
| `/usr/bin/env: bash\r` or `$'\r'` error | Normalize the affected shell file to LF line endings. |
| APT/dpkg fails during prerequisite installation | Repair the package manager before continuing; check disk/inodes and refresh indexes. Repeated checksum corruption warrants storage/memory investigation. It is not a Zot configuration problem. |

### Backups and upgrades

Back up **all** of these to storage outside this server:

- Kubernetes datastore and the K3s server token. For the embedded-etcd setup, `sudo k3s etcd-snapshot save` creates a datastore snapshot; export it off-server using your backup tooling. Datastore snapshots do not include application PVC contents.
- Jenkins PVC contents, including encrypted credentials and the controller keys needed to decrypt them.
- Zot PVC contents and encrypted copies of `artifacts/.local/`.
- Any legacy workspace PVC still required for rollback, and separate backend/database data if you add those services later.
- Deployment configuration and important release digests in version control/your release records, without private credentials.

Local-path PVC sizes are requested capacities, not guaranteed disk quotas. Monitor actual filesystem usage. Stop the relevant workload or use an application-consistent snapshot method before filesystem backups. Validate restoration before relying on backups. A single node/PVC does not protect against disk or server failure.

Use the same deployment scripts for upgrades after reviewing pinned version changes. Changing a pinned image/chart version is an infrastructure upgrade; changing application code only needs a Jenkins run. Registry TLS certificates last one year and its CA lasts ten; follow [certificate renewal instructions](../../artifacts/README.md#maintain). Avoid deleting namespaces or PVCs as an upgrade procedure.

### Secrets and generated files

`artifacts/.local/`, `.env`, generated image contexts/release metadata, node_modules, build output and editor swap files are ignored by Git. Keep kubeconfigs and private Git keys outside the repository. `.env` is **not** automatically read by the DevOps scripts or injected into production. Vite build variables embedded in the frontend are public to browser users and must not contain private secrets.

## 11. Quick reference after initial installation

```bash
# At the beginning of a new admin shell:
cd ~/TrackingTrucks
source devops/setup.sh

# After changing registry configuration:
bash artifacts/deploy.sh

# After changing the seeded Jenkins job, deployment scripts or environment settings:
bash devops/jenkins/deployJenkins.sh

# After changing Rancher settings:
bash devops/rancher/deployRancher.sh

# Application code deployment or rollback:
# Use DEPLOY_CODE → Build with Parameters in Jenkins.
```

Related project guides: [registry](../../artifacts/README.md), [Jenkins job](../jenkins/jobs/README.md). These instructions document the current scripts; they are not evidence that a new installation or every failure/recovery path has been exercised on every Ubuntu/Debian release.
