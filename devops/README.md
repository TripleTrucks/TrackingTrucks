# TrackingTrucks DevOps guide

This guide takes a new administrator from a Linux server to a running TrackingTrucks production frontend. Run commands on the server in Bash unless a step explicitly says otherwise. The repository's deployment scripts manage an existing Kubernetes cluster; they do not install the operating system or K3s for you.

The supported layout in this repository is a **single K3s node**, with Rancher, Jenkins and Zot running in separate namespaces. Rancher provides the management UI; Jenkins runs on Kubernetes, not inside the Rancher container. Tailscale Services provide private HTTPS browser access.

**Installation order:** Linux tools → K3s → Helm/shell configuration → Tailscale → cert-manager/Rancher → Zot → Jenkins → application → ARC/GitHub automation.

If this stack is already installed, skip installation steps and use [routine deployment](#9-routine-deployment-and-rollback). Do not overwrite an existing K3s configuration or reinstall the cluster to update the app.

For PR build/lint checks and automatic testing deployments after `development` updates, follow the [in-cluster GitHub Actions runner setup](#12-github-actions-and-arc) after installing Jenkins. Its configuration lives under `devops/rancher/actions-runner`; credentials are loaded from the ignored root `.env` into Kubernetes Secrets. GitHub-hosted runners check PRs, and a cluster runner triggers Jenkins through internal DNS without WARP/Tailscale credentials.


## Release flow

| Event | What runs | Deployment |
| --- | --- | --- |
| PR opened/updated targeting `development` | Frontend lint/type check/build and backend build on GitHub-hosted runners | None |
| Push or merge to `development` | Checks, then ARC calls Jenkins `DEPLOY_TESTING` | Testing, no registry publication |
| PR opened/updated targeting `main` | No PR-check workflow | None |
| PR merged into `main` | ARC calls Jenkins `DEPLOY_CODE` with the exact merge SHA | Production; publish image only after deployment verification |
| PR closed without merging, or direct push to `main` | No automatic production deployment | None |

There are no unit/integration suites or C# lint checks yet. Jenkins deploys the frontend only; the backend is compiled by CI but is not deployed by these jobs. A production merge does not update `development`, so it does not trigger testing.

## Start here

- **Existing cluster:** follow [apply updates](#13-apply-updated-infrastructure-and-ci-configuration). Do not reinstall K3s.
- **New server:** follow sections 1–8 in order, then [GitHub automation](#12-github-actions-and-arc).
- **Configuration:** edit the YAML files in [configuration reference](#what-the-repository-yaml-files-mean); keep secrets in the ignored `.env` or Kubernetes Secrets.
- **Rollback:** use a successful saved image through [DEPLOY_CODE](#9-routine-deployment-and-rollback).

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
| Rancher chart | `2.15.1` | `devops/orchestrator.yaml` |
| Jenkins chart | `5.9.64` | `devops/jenkins/deployJenkins.sh` |
| Jenkins plugins | Explicit version pins | `devops/jenkins/jenkinsConfig.yaml` |
| Zot chart / image | `0.1.128` / `v2.1.22` | `artifacts/deploy.sh`, `artifacts/values.yaml` |
| Node build container | `node:24-bookworm` | Jenkinsfile |
| BuildKit | `moby/buildkit:v0.23.2-rootless` | Jenkinsfile |
| Application web server | `nginx:1.28-alpine` | Deployment Dockerfile |

### Install basic tools and clone

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssh-client openssl python3 python3-bcrypt python3-yaml python3-dotenv

git clone git@github.com:TripleTrucks/TrackingTrucks.git
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

From the repository root, edit `rancher.hostname` in `devops/orchestrator.yaml` before sourcing setup. The same YAML controls the Rancher display name, chart versions, cluster context and deployment timeout:

```bash
source devops/setup.sh
kubectl config current-context
kubectl get nodes -o wide
kubectl get storageclass local-path
kubectl get ingressclass traefik
```

Replace `tail7af369.ts.net` throughout this guide with your own tailnet suffix when installing elsewhere.

`setup.sh`:

- Requires Bash, Helm, kubectl, Python 3 and PyYAML (`sudo apt-get install python3-yaml`).
- Selects a kubeconfig and current context, honoring `KUBECONFIG` and `KUBE_CONTEXT` overrides.
- When necessary, uses sudo to copy K3s credentials into `~/.kube/trackingtrucks-k3s.yaml`, readable only by your user.
- Exports deployment settings and adds convenience shell functions/paths.
- Does **not** install or deploy any cluster component.

Source it again in each new shell. The kubeconfig grants cluster administrator access: do not commit it or make it world-readable. If another kubeconfig is selected unintentionally, explicitly set `KUBECONFIG`/`KUBE_CONTEXT` before sourcing.

### What the repository YAML files mean

| File | Purpose |
| --- | --- |
| [`orchestrator.yaml`](orchestrator.yaml) | Shared cluster context/timeout, Rancher hostname/display name, Rancher and Jenkins chart versions. Tailscale access settings document routing; they do not provision it. |
| [`rancher/rancherConfig.yaml`](rancher/rancherConfig.yaml) | Rancher Helm values: replica count, Traefik ingress and private-CA TLS. Hostname is injected from the orchestrator. |
| [`jenkins/jenkinsConfig.yaml`](jenkins/jenkinsConfig.yaml) | Jenkins controller resources, storage, plugin pins and Configuration as Code settings. |
| [`jenkins/environments.yaml`](jenkins/environments.yaml) | Production/testing endpoints and GitHub/Jenkins connection settings. Both jobs are seeded; staging is not deployed. |
| [`jenkins/scripts/deploy-code-rbac.yaml`](jenkins/scripts/deploy-code-rbac.yaml) | Production namespace, deployment service account/RBAC, Jenkins agent permissions, and legacy release PVC. |
| [`artifacts/values.yaml`](../artifacts/values.yaml) | Zot resources, PVC, NodePort, TLS/authentication and read/push policies. |
| [`jenkins/jobs/deployCode.Jenkinsfile`](jenkins/jobs/deployCode.Jenkinsfile) | Job parameters, temporary agent Pod YAML and deployment stages. |

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

Edit `rancher.hostname` and `rancher.instance_name` in `devops/orchestrator.yaml`. Rancher and Jenkins scripts load that file even when called directly. The Rancher hostname always comes from orchestrator.yaml. Other settings permit environment overrides; use a fresh shell or unset previous overrides before applying YAML changes. Changing the hostname does not create a matching DNS/tunnel route.

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

### Registry maintenance


- `artifacts/values.yaml` configures Zot and requests a 50 GiB PVC. Local-path capacity is not a hard disk quota; monitor server disk space.
- Images are retained until explicitly removed. Jenkins log retention does not remove images. Back up the registry volume off-server and back up `.local/` securely; a PVC alone is not a backup. Stop the Zot StatefulSet during a filesystem backup for consistency (`kubectl -n artifacts get sts,pvc` identifies resources).
- Upgrade the pinned chart/image deliberately and rerun `bash artifacts/deploy.sh`. Do not delete its PVC during upgrades.
- The TLS server certificate lasts one year. Check `openssl x509 -in artifacts/.local/tls.crt -noout -enddate`. To renew, back up `.local/`, move `tls.crt`, `tls.key`, and `tls.csr` out of it, rerun preparation with the same hostname, deploy, and restart the Zot StatefulSet. Keep the CA unchanged so nodes retain trust.
- Keep the old `trackingtrucks-releases` PVC through the first image deployment, in case it rolls back to the previous workspace-based application.

Application images contain the compiled frontend and web server, not databases, runtime secrets or the .NET backend. Build-time `VITE_*` values are public browser assets.

References: [Zot Helm chart](https://github.com/project-zot/helm-charts), [K3s registry trust](https://docs.k3s.io/installation/private-registry).

### Three registry addresses, different purposes

| Address | Purpose |
| --- | --- |
| Prepared `NODE_IP:30500` in `.local/endpoint` | Current canonical image repository address for Jenkins/BuildKit and K3s pulls; private-CA TLS. |
| `artifacts-zot.artifacts.svc.cluster.local:5000` | Kubernetes Service DNS, normally resolvable within pods. The current certificate does not cover this name. |
| `registry.tail7af369.ts.net:443` | Tailnet browser access; Tailscale supplies the browser-facing certificate. |

Kubernetes image pulls happen on nodes, not through pod DNS. Do not replace the image repository address with a Service DNS name or browser hostname without migrating certificate and credential configuration. The existing image address does not depend on MagicDNS or Tailscale route availability.

For the registry browser route only, Serve uses `https+insecure` to the loopback NodePort because Zot's private certificate does not name `127.0.0.1`. Browser TLS verification and registry authentication remain enabled. See the [registry-specific guide](#registry-maintenance) for certificate renewal and backup details.

## 7. Deploy Jenkins and configure Git access

First review `devops/jenkins/environments.yaml`. Set `production.hostname` to your application URL without `https://`, a path or a port. Keep namespaces `production` and `testing`; each job targets its own namespace.

```bash
bash devops/jenkins/deployJenkins.sh
kubectl -n jenkins get sts,pods,svc,pvc
```

The script:

1. Checks the selected cluster, local-path storage and registry client resources.
2. Runs `seed-jobs.sh` to prepare both `DEPLOY_CODE` and `DEPLOY_TESTING` Job DSL definitions and their namespace RBAC.
3. Publishes deployment scripts as the `deploy-code-scripts` ConfigMap, plus settings as `deploy-code-settings` in each application namespace.
4. Installs/upgrades Jenkins with pinned chart/plugins and Configuration as Code, then waits for its StatefulSet.

Jenkins uses a 20 GiB persistent volume for controller state, credentials, job history and archived release metadata. Kubernetes agents are temporary pods in `production` or `testing`, depending on the job. The controller's service account receives agent-management permissions there; the agent's `deploy-code` account receives application deployment permissions. The job does not use Rancher admin credentials or a host Docker socket.

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

In Jenkins, open **DEPLOY_CODE → Build with Parameters** (or DEPLOY_TESTING for the latest development frontend without publishing an image):

| Parameter | First deployment |
| --- | --- |
| `COMMIT` | Leave blank for the latest branch revision; automation supplies the merge SHA |
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

Use the same deployment scripts for upgrades after reviewing pinned version changes. Changing a pinned image/chart version is an infrastructure upgrade; changing application code only needs a Jenkins run. Registry TLS certificates last one year and its CA lasts ten; follow [certificate renewal instructions](#registry-maintenance). Avoid deleting namespaces or PVCs as an upgrade procedure.

### Secrets and generated files

`artifacts/.local/`, `.env`, generated image contexts/release metadata, node_modules, build output and editor swap files are ignored by Git. Keep kubeconfigs and private Git keys outside the repository. Only the ARC installer reads the root `.env` for its credentials; it is not injected into application pods. Vite build variables embedded in the frontend are public to browser users and must not contain private secrets.

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

These instructions document the current scripts; they are not evidence that a new installation or every failure/recovery path has been exercised on every Ubuntu/Debian release.


## 12. GitHub Actions and ARC

ARC creates temporary in-cluster Actions runners. They reach Jenkins over cluster DNS using outbound GitHub connectivity; no public Jenkins webhook, WARP enrollment or Tailscale CI secret is required. PR checks run separately on GitHub-hosted runners.

### CI settings

| File | What to edit |
| --- | --- |
| `devops/orchestrator.yaml` | Shared Kubernetes context and Rancher/Jenkins deployment settings |
| `devops/jenkins/environments.yaml` → `ci` | GitHub `repository` as `OWNER/REPO`, existing Jenkins SSH `git_credentials_id`, internal `jenkins_url`, Jenkins automation `jenkins_user` |
| `devops/jenkins/environments.yaml` → `environments.testing` | Testing hostname; namespace is currently fixed to `testing` |
| `devops/rancher/actions-runner/values.yaml` | ARC version, controller/runner namespaces, runner image, capacity, authentication mode and optional GitHub App IDs |
| `.github/workflows/pr-checks.yml` | PR target branches, check commands, tool versions |
| `.github/workflows/deploy-testing.yml` | Development push trigger, testing environment and runner name |
| `.github/workflows/deploy-production.yml` | Merged-main-PR trigger, production environment and runner name |
| Root `.env` (gitignored) | Actual credential values; see below |

`runnerScaleSetName` and the workflow's `runs-on` must match. The testing source branch is `development`; changing it requires updating the Jenkins pipeline's branch restriction as well as the workflow. Production/testing namespaces and `DEPLOY_TESTING` are implementation identities, not arbitrary labels. Do not put token values in committed YAML.

### Create credentials

For the simplest repository-scoped setup, create a fine-grained GitHub PAT for this repository with **Administration: read and write** and an owner who can administer runners. Metadata read access is included. Grant organization approval if required. Set an expiry and plan to rotate it. Alternatively use a classic token with `repo` scope. For organization-scoped registration, follow GitHub's different permissions for organization runners.

In Jenkins create a dedicated automation user (for example `github-actions`; set `ci.jenkins_user` to its actual username), with Overall/Read and read/build access to both `DEPLOY_TESTING` and `DEPLOY_CODE`. Generate a **user API token**, not a password. The existing SSH credential `github-ssh` remains separate and is used only by Jenkins for checkout. The API user needs production build permission but no cluster administrator permissions; configure Jenkins authorization accordingly if it currently gives all authenticated users administrator access.

Add only these two entries to the existing root `.env`:

```dotenv
ARC_GITHUB_TOKEN='your-github-personal-access-token'
JENKINS_API_TOKEN='your-jenkins-user-api-token'
```

Preserve existing entries. `.env.example` contains empty placeholders only. The installer reads values literally with `python-dotenv` and does not source the file as shell code. It writes `arc-github-auth` and `jenkins-trigger-auth` in the runner namespace using Kubernetes Secrets; only the Jenkins token is injected into runner pods. GitHub registration credentials stay with ARC. No credentials are written to Helm values or committed files. Kubernetes Secrets still require restricted RBAC and cluster backups/encryption appropriate to your deployment.

For a longer-lived, transferable setup, prefer a **GitHub App** over a personal token. Set `authentication.mode: app` and the public `app_id`/`installation_id` in `values.yaml`. Install the app on the target account/repository with the permissions in [GitHub's ARC authentication guide](https://docs.github.com/en/actions/how-tos/manage-runners/use-actions-runner-controller/authenticate-to-the-api). Put the downloaded private key in the gitignored `devops/rancher/actions-runner/.local/github-app.pem`, restrict its file permissions, and replace `ARC_GITHUB_TOKEN` in `.env` with:

```dotenv
ARC_GITHUB_APP_PRIVATE_KEY_FILE=devops/rancher/actions-runner/.local/github-app.pem
```

Keep `JENKINS_API_TOKEN`. A local key path is resolved relative to the repository root. The installer copies the key contents into the ARC Secret, not the runner pod.

### Configure GitHub access

Create GitHub environments **testing** (allow `development`) and **production** (allow `main`; optionally require approval). Remove required PR checks from main protection if they would wait for the intentionally disabled main PR checks. Require PRs and the checks **Frontend lint and build** and **Backend build** on `development`. Require the PR branch to be up to date before merging. Protect workflow/configuration changes with review.

The private runner must only execute trusted deployment code. Runner labels and the `environment` field alone are not access controls: another workflow could request this runner and access its injected Jenkins token. For public repositories or repositories with untrusted contributors, use an **organization runner group restricted to this repository and the testing workflow on development and production workflow on main** (where supported by your GitHub plan) before enabling it. Set `githubConfigUrl: https://github.com/YOUR_ORG` and `runnerGroup` in `values.yaml`, and use organization-scope ARC credentials. If those restrictions are unavailable, do not expose a privileged private runner to untrusted workflows; use a separate trusted deployment repository. See [GitHub's self-hosted runner security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

### Install ARC

On the cluster administration machine, from the repository root:

```bash
sudo apt-get install python3-yaml python3-dotenv
# helm and kubectl must already be installed, using your cluster-admin kubeconfig.
python3 devops/rancher/actions-runner/deploy.py       # validate YAML only
bash devops/jenkins/deployJenkins.sh                 # seed both jobs and RBAC
python3 devops/rancher/actions-runner/deploy.py --apply
```

The installer uses `KUBECONFIG`/`KUBE_CONTEXT`, or `~/.kube/trackingtrucks-k3s.yaml` if present. Without `KUBE_CONTEXT`, it uses `cluster.context` from `devops/orchestrator.yaml`, falling back to the current kubeconfig context when blank. Check the selected cluster before applying. It creates controller/runner namespaces, two Secrets, a settings ConfigMap, and the two pinned Helm releases. No application rollout is triggered by installation.

Keep runner pods in `arc-runners`, separate from application pods in `testing`. The runner calls Jenkins over cluster DNS and needs no access to application resources. Sharing the testing namespace would also put its credentials alongside the application and its deployment RBAC. `runners.namespace` in `values.yaml` remains configurable; changing it after installation requires a planned Helm migration, not just a namespace edit.

Verify:

```bash
kubectl -n arc-systems get pods
kubectl -n arc-runners get pods,autoscalingrunnersets
```

GitHub **Settings → Actions → Runners** should show the scale set. With `minRunners: 0`, a listener should remain available but there may be no idle runner pod. Push the workflows, then merge a PR into `development`. GitHub's deployment job should move from queued to running and report Jenkins's actual result. No GitHub-hosted PR job uses cluster credentials.

### Endpoints and operation

The runner uses `http://jenkins.jenkins.svc.cluster.local:8080` by default; this sends the API token over cluster HTTP, matching the existing Jenkins Service. If the cluster threat model requires encryption in transit, configure a reachable trusted HTTPS endpoint in YAML. The runner must resolve/reach Jenkins and have outbound HTTPS to GitHub and GitHub's Actions services. The external browser URL can remain private behind WARP/Tailscale; it is not used for triggering.

The testing hostname in `environments.yaml` must already route to Service `testing/trackingtrucks`, port 80. Configuration alone does not provision DNS/tunnels. Jenkins's internal checks verify the Service; verify your external tunnel route separately. This currently deploys the frontend/Nginx application, not the C# backend.

Rerun the installer after YAML edits or secret rotation. New pods use the new settings; active jobs retain their starting environment. Refresh Jenkins after changing repository or checkout credential settings. The installer does not delete retired Secrets when switching authentication modes.

Set `maxRunners` for capacity. Deployments to this shared environment remain serialized by Actions and Jenkins; GitHub may replace an older pending run with a newer one. A cancelled/timed-out Actions run may leave Jenkins running—inspect the job before retrying. Failed Jenkins rollouts attempt restoration of the previous Deployment. Testing images remain in the importing K3s node's cache and pods are pinned there, so this deployment method does not yet provide multi-node application failover; rebuilding restores a lost image. ARC runner scaling itself is independent of that application limitation.

To remove ARC, uninstall the runner release first, then the controller. Secrets and namespaces are retained unless you explicitly delete them:

```bash
helm uninstall trackingtrucks-deploy -n arc-runners
helm uninstall arc -n arc-systems
```

### Release configuration and first run

`deploy-production.yml` uses a `pull_request` **closed** event and checks `merged == true`. It checks out the resulting merge commit (including squash/rebase merge results). The shared trigger validates the event, submits `BRANCH=main`, empty `IMAGE`, and `COMMIT` to Jenkins, then reports Jenkins's result. Jenkins validates the SHA and its ancestry on main before compilation. Manual DEPLOY_CODE runs can still build the latest selected branch or restore an image.

Refresh Jenkins **before** enabling the workflows, so its COMMIT parameter exists. Commit both workflows and the trigger script to the appropriate branches: testing runs from development; production must be included in the merged main revision. The manual testing workflow button requires its file on the default branch too. No new token is needed if the existing Jenkins account can build both jobs.

The shared runner has credentials that can trigger both environments. Only approved workflows should execute there; environment approval alone does not isolate the injected token. Queue ordering is not a release-history guarantee: GitHub concurrency can replace pending runs. Avoid overlapping release merges when every release must deploy. Cancelling Actions does not cancel a queued/running Jenkins build.

### Testing browser route

After the first testing deployment creates its Service, run on the Tailscale host:

```bash
TESTING_IP=$(kubectl -n testing get service trackingtrucks -o jsonpath='{.spec.clusterIP}')
sudo tailscale serve --bg --service=svc:testing --tls-terminated-tcp=443 "tcp://$TESTING_IP:80"
```

The Tailscale Service name must match the hostname configured in environments.yaml. Approve the service host if requested. Rerun after recreating the Service; do not hardcode its ClusterIP.

### Automation troubleshooting

| Symptom | Check |
| --- | --- |
| No Actions run | Workflow exists on the event branch; exact branch name; Actions enabled; production requires a merged PR, not a direct push |
| Waiting for runner | ARC controller/listener pods, GitHub token access to the current repository owner, runner scale-set name matches runs-on |
| Awaiting approval | GitHub environment deployment rules/reviewers |
| Jenkins 401/403 | API token belongs to ci.jenkins_user; account can read/build the target job |
| Jenkins unknown parameter/old behavior | Rerun deployJenkins.sh to refresh seeded pipelines |
| Action fails after queuing | Inspect Jenkins first; the trigger deliberately never retries the POST to avoid duplicate deployments |

## 13. Apply updated infrastructure and CI configuration

For only the release automation changes, refresh Jenkins and push the workflow/script files. Rancher needs no update unless its own configuration changed. Refresh ARC only when its settings or credentials changed.

Edit `devops/orchestrator.yaml` for your server's Rancher hostname and cluster settings. Edit `devops/jenkins/environments.yaml` for application endpoints and Jenkins/GitHub identity. ARC resources, namespace and capacity stay in `devops/rancher/actions-runner/values.yaml`; actual tokens stay in the root `.env`.

Run from the repository root. Clear previously exported deployment settings so YAML edits take effect; leave `KUBECONFIG` pointing at the intended cluster:

```bash
sudo apt-get install python3-yaml python3-dotenv
unset RANCHER_HOSTNAME RANCHER_INSTANCE_NAME RANCHER_CHART_VERSION JENKINS_CHART_VERSION KUBE_VERSION DEPLOY_TIMEOUT KUBE_CONTEXT
source devops/setup.sh
kubectl --context "$KUBE_CONTEXT" get nodes
bash devops/rancher/deployRancher.sh
bash devops/jenkins/deployJenkins.sh
python3 devops/rancher/actions-runner/deploy.py --apply
```

These update Rancher, refresh Jenkins and seed both deployment jobs, then install/upgrade ARC and its Secrets. Jenkins is restarted by its deployment script; run when no builds are active. Skip Rancher deployment when only Jenkins/job/runner files changed. No K3s restart is required. Push the workflow files to GitHub to activate the repository-side triggers.

```bash
kubectl --context "$KUBE_CONTEXT" -n cattle-system rollout status deployment/rancher
kubectl --context "$KUBE_CONTEXT" -n jenkins rollout status statefulset/jenkins
kubectl --context "$KUBE_CONTEXT" -n arc-systems get pods
kubectl --context "$KUBE_CONTEXT" -n arc-runners get pods,autoscalingrunnersets
```

The runner namespace is intentionally separate from `testing`; Jenkins deploys the application into testing. At zero idle runners, ARC's listener can be running without a runner pod. See the [runner guide](#12-github-actions-and-arc) for credentials and access restrictions before enabling it.
