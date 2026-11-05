# Nightly staging sync

`SYNC_STAGING` runs every day at **23:59 America/New_York**, including daylight
saving changes. It can also be run manually. Its timer is installed by the seed
script immediately, before its first build. It does not replace `DEPLOY_TESTING`.

The job checks out the latest `development` branch, compiles the application,
builds its container with BuildKit, imports it into the build node's containerd,
and deploys it in `staging`. This follows the same build and deployment flow as
`DEPLOY_TESTING`. It does not copy testing images or publish images to a registry.
The OCI archive is temporary build workspace data; the runtime image remains
local to the node, as required to run the app.

Staging uses the shared deployment script, health checks and automatic rollback.
A compilation or image build failure leaves the existing staging deployment
unchanged. A failed rollout triggers rollback. The job has a 30-minute timeout,
no branch/image parameters, and prevents overlapping staging runs. It verifies
the deployed commit and release metadata after rollout. A successful build and
health check do not replace application tests.

The app uses `imagePullPolicy: Never` and runs on the node that built its image.
This has the same single-node availability limitation as testing. No databases
or other stateful services are cloned by this job.

## Install

With K3s healthy and the existing Jenkins prerequisites available:

```bash
bash devops/jenkins/deployJenkins.sh
```

This seeds `SYNC_STAGING`, refreshes the mounted deployment scripts, creates
namespace-scoped deployment settings/RBAC, and removes the obsolete testing-reader
permissions. The installer reads local files, so these pipeline changes do not
need a commit to be installed. Application builds consume pushed `development` code. Run
`SYNC_STAGING` once manually to create the initial app Deployment and Service, or
wait for 23:59. Existing testing and production automation continues unchanged.

The endpoint is read from `environments.yaml`: currently
**https://staging.tail7af369.ts.net**. As with testing, Kubernetes Service creation
does not configure Tailscale by itself. Routing follows the same one-time setup
as testing and production. If the staging route is already configured, no further
action is needed. Otherwise, create/approve `svc:staging` in the tailnet and run
on the Tailscale host after the first staging deployment:

```bash
STAGING_IP=$(kubectl -n staging get service trackingtrucks -o jsonpath='{.spec.clusterIP}')
sudo tailscale serve --bg --service=svc:staging --tls-terminated-tcp=443 "tcp://$STAGING_IP:80"
```

The service name must match the hostname in `environments.yaml`. Approve the
service host if required. Rerun only if the Kubernetes Service is recreated and
its ClusterIP changes; ordinary app deployments retain the route.

Verify the endpoint and source commit:

```bash
curl -fsS https://staging.tail7af369.ts.net/release.json
kubectl -n staging rollout status deployment/trackingtrucks
```

Jenkins verifies traffic through the internal Service. External DNS/Tailscale
availability must also be checked from an authorized tailnet client.

The schedule is defined in both `jobs/syncStaging.Jenkinsfile` and the seeded timer
in `scripts/seed-jobs.sh`; keep them consistent when changing the time.
