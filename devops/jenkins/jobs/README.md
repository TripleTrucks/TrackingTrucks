# DEPLOY_CODE

For the separate development environment and GitHub Actions connection, see [DEPLOY_TESTING](#deploy_testing) below.

First install the cluster registry following [artifacts/README.md](../../../artifacts/README.md). Then run `bash devops/jenkins/deployJenkins.sh` from the project root to refresh the job and scripts.

## Parameters

- `IMAGE`: saved release tag (for example `release-build-24-20261015T010447`) or `repository@sha256:digest` from a successful Jenkins run. Tags are resolved to a digest before deployment. Leave blank to build new code.
- `BRANCH`: branch to build, default `main`; ignored when IMAGE is supplied.
- `REPO_URL`: Git repository SSH URL.
- `GIT_CREDENTIALS_ID`: Jenkins SSH credential ID, default `github-ssh`.

Production hostname/namespace are read from the operator's `devops/jenkins/environments.yaml` when Jenkins is seeded. This lets saved-image deployments work without checking out Git. Rerun the Jenkins deployment script when those settings change.

## Flow

1. **Prepare release**: select an existing image or check out the branch.
2. **Compile application**: run `npm ci` and `npm run build` for new images.
3. **Build image**: export an OCI archive and import it directly into the local K3s container runtime. Nothing is uploaded to Zot. Skipped for an existing image.
4. **Deploy and verify**: deploy the immutable digest on the Jenkins agent’s node, wait for readiness and check the application through its Service.
5. **Publish image**: only after verification succeeds, upload the local archive to Zot under a `release-…` tag, preserving the exact digest and archive `release.json`. No rebuild occurs. A healthy saved-image deployment also gets a new release tag.

Use the image digest printed by a successful job as `IMAGE` to roll back. Failed deployments leave no new image in Zot; the imported image may remain in the node’s local cache. Published releases have `release-…` tags; rollback still uses the immutable digest. A publication or archive failure after a healthy rollout fails the job without stopping the healthy application. Jenkins completion and registry tagging are not an atomic transaction; an interruption during publication may require checking the tag.

Production keeps running during compilation. Failed deployments attempt to restore the previous Deployment. The application serves compiled assets using Nginx on port 5173 behind the existing Service on port 80. Existing external routing to the Service is unchanged.

Build workspaces are temporary; new application pods no longer mount the release workspace PVC. Registry storage persists independently of Jenkins's 30-build history. Only compiled public assets and metadata enter the image, not `.env`, source files or `node_modules`.

The rootless BuildKit container requires unconfined seccomp/AppArmor. A root runtime container mounts the K3s containerd socket to import images; this grants node-level control. Restrict this job and its branches to trusted maintainers. The publisher uses Skopeo to copy the verified archive without rebuilding. Fresh deployments remain pinned to the agent’s node, so this flow targets the current single-node K3s setup. Saved-image deployments can pull from Zot and are not pinned. Registry CA trust is still required for those pulls. If publication fails, the healthy application remains dependent on its node’s local image cache until a successful publication.

## DEPLOY_TESTING

`deployTesting.Jenkinsfile` checks out `development`, compiles the frontend, imports its image into the agent node's containerd, and deploys to the testing namespace. It waits for readiness and verifies the served commit. It never publishes images to Zot. The testing endpoint comes from `environments.testing` in `devops/jenkins/environments.yaml`; existing routing must point at `testing/trackingtrucks:80`.

GitHub Actions runs frontend lint/build and a backend build for PRs. After a push or merge to `development`, it reruns those checks and triggers `DEPLOY_TESTING` with the exact checked `COMMIT`. A manual Jenkins build with an empty `COMMIT` uses the latest development revision. Checkout repository and SSH credential defaults come from `ci` in `environments.yaml`.

Follow the [cluster runner installation guide](../../rancher/actions-runner/README.md) for the YAML settings, two local credential entries, and installation commands. Refresh Jenkins using `bash devops/jenkins/deployJenkins.sh` to seed both jobs and their namespace resources. There is no Git polling trigger and no public Jenkins webhook requirement. Actions waits for Jenkins and reports deployment failures back to GitHub.
