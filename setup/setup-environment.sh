#!/usr/bin/env bash
# Run as your normal user: bash setup/setup-environment.sh [--install-docker]
# Node/npm: Linux or macOS. Optional Docker Engine installation: Ubuntu only.
set -Eeuo pipefail

install_docker=false
for argument in "$@"; do
  case "$argument" in
    --install-docker) install_docker=true ;;
    -h|--help)
      echo 'Usage: bash setup/setup-environment.sh [--install-docker]'
      echo 'Installs frontend dependencies and .NET 8. --install-docker installs Docker Engine on Ubuntu.'
      exit 0 ;;
    *) echo "Unknown option: $argument" >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in
  Linux|Darwin) ;;
  *) echo 'Use setup/setup-environment.ps1 on Windows, or run this script inside WSL.' >&2; exit 1 ;;
esac

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  set +u
  source "$NVM_DIR/nvm.sh" --no-use
  set -u
fi

node_version=''
if command -v node >/dev/null 2>&1; then
  node_version="$(node --version)"
  node_version="${node_version#v}"
fi

# Use nvm to install/switch when Node is missing or older than version 24.
if [[ -z "$node_version" ]] || (( ${node_version%%.*} < 24 )); then
  command -v curl >/dev/null 2>&1 || {
    echo 'Install curl first (Ubuntu: sudo apt-get install -y curl ca-certificates).' >&2
    exit 1
  }
  target_version=24
  if [[ -s .nvmrc ]]; then
    target_version="$(tr -d '[:space:]' < .nvmrc)"
    [[ "$target_version" =~ ^v?[0-9]+(\.[0-9]+){0,2}$ ]] || {
      echo '.nvmrc must contain a numeric Node version.' >&2; exit 1;
    }
    target_version="${target_version#v}"
    (( ${target_version%%.*} >= 24 )) || {
      echo '.nvmrc must specify Node 24 or newer.' >&2; exit 1;
    }
  fi
  if ! command -v nvm >/dev/null 2>&1; then
    installer="$(mktemp)"
    trap 'rm -f -- "$installer"' EXIT
    curl --fail --silent --show-error --location --retry 3 \
      https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh -o "$installer"
    bash "$installer"
    rm -f -- "$installer"
    trap - EXIT
    set +u
    source "$NVM_DIR/nvm.sh" --no-use
    set -u
  fi
  set +u
  nvm install "$target_version"
  nvm use "$target_version"
  set -u
fi

command -v npm >/dev/null 2>&1 || { echo 'npm is missing; reinstall Node through nvm.' >&2; exit 1; }
node_version="$(node --version)"
node_version="${node_version#v}"
node_major="${node_version%%.*}"
(( node_major >= 24 )) || { echo "Node 24 or newer is required; found $node_version." >&2; exit 1; }

# Preserve an existing package.json.
if [[ ! -f package.json ]]; then
  cat > package.json <<'JSON'
{
  "name": "tracking-trucks",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
JSON
fi

npm install --engine-strict --save-exact react react-dom
npm install --engine-strict --save-dev --save-exact \
  typescript vite @vitejs/plugin-react \
  @types/react @types/react-dom "@types/node@$node_major" electron

printf '%s\n' "$node_version" > .nvmrc
touch .gitignore
existing_ignores="$(tr -d '\r' < .gitignore)"
missing_ignores=()
for pattern in 'node_modules/' 'dist/' 'dist-electron/' 'release/' '.env' '.env.*' '!.env.example'; do
  if ! grep -Fxq -- "$pattern" <<< "$existing_ignores"; then
    missing_ignores+=("$pattern")
  fi
done
if (( ${#missing_ignores[@]} )); then
  printf '\n%s\n' "${missing_ignores[@]}" >> .gitignore
fi

if [[ "$install_docker" == true ]]; then
  if command -v docker >/dev/null 2>&1; then
    echo 'Docker is already installed; keeping the existing installation.'
    docker --version
  else
    [[ -r /etc/os-release ]] || { echo '--install-docker supports Ubuntu only.' >&2; exit 1; }
    source /etc/os-release
    [[ "${ID:-}" == ubuntu ]] || { echo '--install-docker supports Ubuntu only.' >&2; exit 1; }
    codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
    [[ -n "$codename" ]] || { echo 'Cannot determine Ubuntu release.' >&2; exit 1; }
    as_root=()
    if (( EUID != 0 )); then as_root=(sudo); fi
    "${as_root[@]}" apt-get update
    "${as_root[@]}" apt-get install -y --no-remove ca-certificates curl
    "${as_root[@]}" install -m 0755 -d /etc/apt/keyrings
    "${as_root[@]}" curl --fail --silent --show-error --location \
      https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    "${as_root[@]}" chmod a+r /etc/apt/keyrings/docker.asc
    printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' \
      "$codename" "$(dpkg --print-architecture)" |
      "${as_root[@]}" tee /etc/apt/sources.list.d/docker.sources >/dev/null
    "${as_root[@]}" apt-get update
    "${as_root[@]}" apt-get install -y --no-remove \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    echo 'Docker installed. Use sudo docker unless your user already has Docker access.'
  fi
fi

npm run setup:backend
npm ls --depth=0
printf '\nDependencies installed. Commit package.json and package-lock.json.\n'
echo 'Other developers should install the recorded Node version, then run npm ci.'
if command -v nvm >/dev/null 2>&1; then
  echo 'To activate Node in your current terminal, run:'
  printf 'source %q\n' "$NVM_DIR/nvm.sh"
  echo 'nvm use'
fi
