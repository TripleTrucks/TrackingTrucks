# In-cluster deployment runner

ARC runs temporary GitHub Actions runner pods in K3s. This is a separate Rancher-managed workload: installing it does not reinstall Rancher. It is installed with `deploy.py`, not implicitly by `deployRancher.sh`.

The flow is:

1. A PR targeting `development` or `main` runs ESLint, TypeScript/Vite compilation, and a .NET backend build on GitHub-hosted runners. There are no unit/integration suites or C# lint rules yet.
2. Updating `development` (merges and direct pushes) reruns those checks on the merged commit.
3. Only after checks pass, GitHub assigns the deployment job to the `trackingtrucks-deploy` scale set. ARC creates a temporary runner in the cluster.
4. The runner calls Jenkins over cluster DNS and waits for its result. Jenkins builds that exact commit, locally imports the image, deploys testing, and verifies readiness and served commit metadata. No testing image is published to Zot.

No scheduled polling, WARP enrollment, Tailscale credentials, or GitHub environment secrets are needed. ARC listens for assigned jobs; this is not periodic polling of your Git branch. The runner itself gets no Docker/containerd socket or Kubernetes API token. The existing Jenkins build agent still uses containerd for local image import.

## Where to put settings

| File | What to edit |
| --- | --- |
| `devops/jenkins/environments.yaml` → `ci` | GitHub `repository` as `OWNER/REPO`, existing Jenkins SSH `git_credentials_id`, internal `jenkins_url`, Jenkins automation `jenkins_user` |
| `devops/jenkins/environments.yaml` → `environments.testing` | Testing hostname; namespace is currently fixed to `testing` |
| `devops/rancher/actions-runner/values.yaml` | ARC version, controller/runner namespaces, runner image, capacity, authentication mode and optional GitHub App IDs |
| `.github/workflows/pr-checks.yml` | PR target branches, check commands, tool versions |
| `.github/workflows/deploy-testing.yml` | Deployment trigger, GitHub environment and runner scale-set name |
| Root `.env` (gitignored) | Actual credential values; see below |

`runnerScaleSetName` and the workflow's `runs-on` must match. The default branch is `development`; changing it requires updating the Jenkins pipeline's branch restriction as well as the workflow. Production/testing namespaces and `DEPLOY_TESTING` are implementation identities, not arbitrary labels. Do not put token values in committed YAML.

## 1. Create credentials

For the simplest repository-scoped setup, create a fine-grained GitHub PAT for this repository with **Administration: read and write** and an owner who can administer runners. Metadata read access is included. Grant organization approval if required. Set an expiry and plan to rotate it. Alternatively use a classic token with `repo` scope. For organization-scoped registration, follow GitHub's different permissions for organization runners.

In Jenkins create a dedicated automation user (default YAML name `github-actions`), with Overall/Read and read/build access to `DEPLOY_TESTING`. Generate a **user API token**, not a password. The existing SSH credential `github-ssh` remains separate and is used only by Jenkins for checkout. The API user does not need production build or cluster administrator permissions; configure Jenkins authorization accordingly if it currently gives all authenticated users administrator access.

Add only these two entries to the existing root `.env`:

```dotenv
ARC_GITHUB_TOKEN='your-github-runner-registration-token'
JENKINS_API_TOKEN='your-jenkins-user-api-token'
```

Preserve existing entries. `.env.example` contains empty placeholders only. The installer reads values literally with `python-dotenv` and does not source the file as shell code. It writes `arc-github-auth` and `jenkins-trigger-auth` in the runner namespace using Kubernetes Secrets; only the Jenkins token is injected into runner pods. GitHub registration credentials stay with ARC. No credentials are written to Helm values or committed files. Kubernetes Secrets still require restricted RBAC and cluster backups/encryption appropriate to your deployment.

For a longer-lived, transferable setup, prefer a **GitHub App** over a personal token. Set `authentication.mode: app` and the public `app_id`/`installation_id` in `values.yaml`. Install the app on the target account/repository with the permissions in [GitHub's ARC authentication guide](https://docs.github.com/en/actions/how-tos/manage-runners/use-actions-runner-controller/authenticate-to-the-api). Put the downloaded private key in the gitignored `devops/rancher/actions-runner/.local/github-app.pem`, restrict its file permissions, and replace `ARC_GITHUB_TOKEN` in `.env` with:

```dotenv
ARC_GITHUB_APP_PRIVATE_KEY_FILE=devops/rancher/actions-runner/.local/github-app.pem
```

Keep `JENKINS_API_TOKEN`. A local key path is resolved relative to the repository root. The installer copies the key contents into the ARC Secret, not the runner pod.

## 2. Restrict deployment access

Create a GitHub environment named **testing** and allow deployments only from `development`. Require PRs and the checks **Frontend lint and build** and **Backend build** on `development`. Require the PR branch to be up to date before merging. Protect workflow/configuration changes with review.

The private runner must only execute trusted deployment code. Runner labels and the `environment` field alone are not access controls: another workflow could request this runner and access its injected Jenkins token. For public repositories or repositories with untrusted contributors, use an **organization runner group restricted to this repository and this deployment workflow/ref** (where supported by your GitHub plan) before enabling it. Set `githubConfigUrl: https://github.com/YOUR_ORG` and `runnerGroup` in `values.yaml`, and use organization-scope ARC credentials. If those restrictions are unavailable, do not expose a privileged private runner to untrusted workflows; use a separate trusted deployment repository. See [GitHub's self-hosted runner security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

## 3. Install

On the cluster administration machine, from the repository root:

```bash
sudo apt-get install python3-yaml python3-dotenv
# helm and kubectl must already be installed, using your cluster-admin kubeconfig.
python3 devops/rancher/actions-runner/deploy.py       # validate YAML only
bash devops/jenkins/deployJenkins.sh                 # seed DEPLOY_TESTING and RBAC
python3 devops/rancher/actions-runner/deploy.py --apply
```

The installer uses `KUBECONFIG`/`KUBE_CONTEXT`, or `~/.kube/trackingtrucks-k3s.yaml` if present. Check the selected cluster before applying. It creates controller/runner namespaces, two Secrets, a settings ConfigMap, and the two pinned Helm releases. No application rollout is triggered by installation.

Verify:

```bash
kubectl -n arc-systems get pods
kubectl -n arc-runners get pods,autoscalingrunnersets
```

GitHub **Settings → Actions → Runners** should show the scale set. With `minRunners: 0`, a listener should remain available but there may be no idle runner pod. Push the workflows, then merge a PR into `development`. GitHub's deployment job should move from queued to running and report Jenkins's actual result. No GitHub-hosted PR job uses cluster credentials.

## 4. Testing endpoint and operation

The runner uses `http://jenkins.jenkins.svc.cluster.local:8080` by default; this sends the API token over cluster HTTP, matching the existing Jenkins Service. If the cluster threat model requires encryption in transit, configure a reachable trusted HTTPS endpoint in YAML. The runner must resolve/reach Jenkins and have outbound HTTPS to GitHub and GitHub's Actions services. The external browser URL can remain private behind WARP/Tailscale; it is not used for triggering.

The testing hostname in `environments.yaml` must already route to Service `testing/trackingtrucks`, port 80. Configuration alone does not provision DNS/tunnels. Jenkins's internal checks verify the Service; verify your external tunnel route separately. This currently deploys the frontend/Nginx application, not the C# backend.

Rerun the installer after YAML edits or secret rotation. New pods use the new settings; active jobs retain their starting environment. Refresh Jenkins after changing repository or checkout credential settings. The installer does not delete retired Secrets when switching authentication modes.

Set `maxRunners` for capacity. Deployments to this shared environment remain serialized by Actions and Jenkins; GitHub may replace an older pending run with a newer one. A cancelled/timed-out Actions run may leave Jenkins running—inspect the job before retrying. Failed Jenkins rollouts attempt restoration of the previous Deployment. Testing images remain in the importing K3s node's cache and pods are pinned there, so this deployment method does not yet provide multi-node application failover; rebuilding restores a lost image. ARC runner scaling itself is independent of that application limitation.

To remove ARC, uninstall the runner release first, then the controller. Secrets and namespaces are retained unless you explicitly delete them:

```bash
helm uninstall trackingtrucks-deploy -n arc-runners
helm uninstall arc -n arc-systems
```
