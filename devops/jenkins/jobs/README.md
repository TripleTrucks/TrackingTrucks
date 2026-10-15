# DEPLOY_CODE

First install the cluster registry following [artifacts/README.md](../../../artifacts/README.md). Then run `bash devops/jenkins/deployJenkins.sh` from the project root to refresh the job and scripts.

## Parameters

- `IMAGE`: saved `repository@sha256:digest` from a successful Jenkins run. Leave blank to build new code.
- `BRANCH`: branch to build, default `main`; ignored when IMAGE is supplied.
- `REPO_URL`: Git repository SSH URL.
- `GIT_CREDENTIALS_ID`: Jenkins SSH credential ID, default `github-ssh`.

Production hostname/namespace are read from the operator's `devops/jenkins/environments.yaml` when Jenkins is seeded. This lets saved-image deployments work without checking out Git. Rerun the Jenkins deployment script when those settings change.

## Flow

1. **Prepare release**: select an existing image or check out the branch.
2. **Compile application**: run `npm ci` and `npm run build` for new images.
3. **Build candidate image**: build an OCI image and upload a `candidate-…` tag so Kubernetes can pull it. Skipped for an existing image.
4. **Deploy and verify**: deploy the immutable digest, wait for readiness and check the application through its Service.
5. **Publish image**: only after verification succeeds, add a `release-…` tag pointing to the exact same digest and archive `release.json`. No rebuild occurs. A healthy saved-image deployment also gets a new release tag.

Use the image digest printed by a successful job as `IMAGE` to roll back. Failed deployments may leave candidate images, but never reach the Publish image stage. Published releases have `release-…` tags; rollback still uses the immutable digest. A publication or archive failure after a healthy rollout fails the job without stopping the healthy application. Jenkins completion and registry tagging are not an atomic transaction; an interruption during publication may require checking the tag.

Production keeps running during compilation. Failed deployments attempt to restore the previous Deployment. The application serves compiled assets using Nginx on port 5173 behind the existing Service on port 80. Existing external routing to the Service is unchanged.

Build workspaces are temporary; new application pods no longer mount the release workspace PVC. Registry storage persists independently of Jenkins's 30-build history. Only compiled public assets and metadata enter the image, not `.env`, source files or `node_modules`.

The rootless BuildKit container requires unconfined seccomp/AppArmor; no host Docker socket is mounted. Build only trusted branches because npm lifecycle scripts run in a pod authorized to deploy production.
