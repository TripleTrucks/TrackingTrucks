#!/usr/bin/env bash
set -euo pipefail
: "${DEPLOY_COMMIT:?Checkout must run first}"

export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export npm_config_cache=/tmp/npm-cache
export TRACKINGTRUCKS_DOTNET_DIR=/tmp/dotnet8
export DOTNET_CLI_HOME=/tmp/dotnet-cli
export NUGET_PACKAGES=/tmp/nuget-packages
npm ci --include=dev
npm run build
test -s build/app/wwwroot/index.html
test -s build/app/Backend.dll

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

# Only published application files enter the image context; .env and source stay out.
mkdir image-context
cp -R build/app image-context/app
cp .deploy-code-release.json image-context/release.json
cp /opt/deploy-code/Dockerfile image-context/
