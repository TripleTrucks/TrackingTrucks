#!/usr/bin/env bash
set -euo pipefail
: "${DEPLOY_COMMIT:?Checkout must run first}"

export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export npm_config_cache=/tmp/npm-cache
npm ci --include=dev
npm run build
test -s dist/index.html

node <<'JS'
const fs = require('node:fs');
fs.writeFileSync('.deploy-code-release.json', JSON.stringify({
  commit: process.env.DEPLOY_COMMIT,
  branch: process.env.BRANCH,
  repository: process.env.REPO_URL,
  release: process.env.RELEASE_ID,
  buildUrl: process.env.BUILD_URL,
  compiledAt: new Date().toISOString()
}, null, 2) + '\n');
JS

# Only compiled public assets enter the image context; source, .env and node_modules do not.
mkdir image-context
cp -R dist image-context/dist
cp .deploy-code-release.json image-context/release.json
cp /opt/deploy-code/Dockerfile /opt/deploy-code/nginx.conf image-context/
