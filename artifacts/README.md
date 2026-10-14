# Image registry

Zot runs in the cluster's `artifacts` namespace with persistent storage, HTTPS and a browser UI. Jenkins pushes application images; production pulls them using a separate read-only account. Developers do not need Zot to run the app locally.

## Install

Requirements: K3s with `local-path` storage, kubectl, Helm, OpenSSL, Python 3, `python3-bcrypt` and `python3-yaml`.

Run from the project root. The setup discovers your single-node cluster's internal IPv4 address:

```bash
python3 artifacts/prepare.py
bash artifacts/deploy.sh
bash artifacts/trust-k3s.sh
kubectl get nodes
bash devops/jenkins/deployJenkins.sh
```

`prepare.py` reads the node address using kubectl and only writes local configuration. Both it and `deploy.sh` honor `KUBECONFIG` and `KUBE_CONTEXT`, falling back to `~/.kube/trackingtrucks-k3s.yaml` when available. For multiple nodes or a preferred DNS name, use `python3 artifacts/prepare.py registry.example.com` instead; the address must be reachable by both pods and nodes.

`deploy.sh` installs the registry and client credentials. `trust-k3s.sh` explicitly uses sudo to install registry CA trust, merge/back up `/etc/rancher/k3s/registries.yaml`, and restart K3s briefly. Schedule that step accordingly. On additional agent nodes, copy the public CA and run `K3S_SERVICE=k3s-agent bash artifacts/trust-k3s.sh HOST:30500 /path/to/ca.crt`.

Passwords, certificates and generated private configuration stay in gitignored `artifacts/.local/`. Re-running preparation preserves them. Reserve the server IP in DHCP; changing the address requires updating the certificate and registry clients.

Browse the HTTPS address printed by `deploy.sh` (also saved in `.local/endpoint`). Trust `.local/ca.crt` on your workstation and log in as `reader` with `.local/reader.password`. Port 30500 is exposed on node interfaces; restrict access to your LAN/tailnet as appropriate. Authentication and certificate verification remain enabled.

## Deploy an image

In Jenkins `DEPLOY_CODE`:

- Leave `IMAGE` blank to compile `BRANCH`, then build and upload the image in **Push artifacts**.
- Set `IMAGE` to the exact `repository@sha256:digest` printed by a successful job to redeploy those saved bytes. No checkout or compilation happens in this mode.

Images have unique `build-…` tags for browsing. Deployments use immutable digests. Successful jobs archive `release.json` with the digest and source metadata.

The image must be uploaded before Kubernetes can deploy it. A later deployment failure can therefore leave an image in Zot; use a **successful Jenkins build's digest** for rollback. There is no separate promotion service or custom registry API helper. Deployment failures attempt to restore the previous Deployment. An archive failure after a healthy rollout leaves that application running; a hard node/process failure may prevent automatic restoration.

## Maintain

- `values.yaml` configures Zot and requests a 50 GiB PVC. Local-path capacity is not a hard disk quota; monitor server disk space.
- Images are retained until explicitly removed. Jenkins log retention does not remove images. Back up the registry volume off-server and back up `.local/` securely; a PVC alone is not a backup. Stop the Zot StatefulSet during a filesystem backup for consistency (`kubectl -n artifacts get sts,pvc` identifies resources).
- Upgrade the pinned chart/image deliberately and rerun `deploy.sh`. Do not delete its PVC during upgrades.
- The TLS server certificate lasts one year. Check `openssl x509 -in artifacts/.local/tls.crt -noout -enddate`. To renew, back up `.local/`, move `tls.crt`, `tls.key`, and `tls.csr` out of it, rerun preparation with the same hostname, deploy, and restart the Zot StatefulSet. Keep the CA unchanged so nodes retain trust.
- Keep the old `trackingtrucks-releases` PVC through the first image deployment, in case it rolls back to the previous workspace-based application.

Application images contain the compiled frontend and web server, not databases, runtime secrets or the .NET backend. Build-time `VITE_*` values are public browser assets.

References: [Zot Helm chart](https://github.com/project-zot/helm-charts), [K3s registry trust](https://docs.k3s.io/installation/private-registry).
