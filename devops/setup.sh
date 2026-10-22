#!/usr/bin/env bash
# One-time setup for your CURRENT Bash session:
#   source /path/to/TrackingTrucks/devops/setup.sh
# Sets paths/settings for running the deployment .sh scripts directly.
# Does not install software, change cluster resources, or deploy anything.
# Edit devops/orchestrator.yaml for deployment settings.

if [ -z "${BASH_VERSION:-}" ]; then
  echo 'Open Bash, then run: source devops/setup.sh' >&2
  return 2 2>/dev/null || exit 2
fi
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo 'Run: source devops/setup.sh (so changes remain in your current shell).' >&2
  exit 2
fi

_prepare_deploy_environment() {
  source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/config.sh" || return 1
  local cluster_context="$KUBE_CONTEXT"
  local rancher_hostname="$RANCHER_HOSTNAME"
  local rancher_version="$RANCHER_CHART_VERSION"
  local jenkins_version="$JENKINS_CHART_VERSION"
  local deploy_timeout="$DEPLOY_TIMEOUT"
  local repo_dir tool directory
  for tool in bash helm kubectl; do
    command -v "$tool" >/dev/null || {
      printf 'Missing prerequisite: %s. Install it and source this file again.\n' "$tool" >&2
      return 1
    }
  done
  repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)" || return
  for directory in rancher jenkins; do
    [[ -f "$repo_dir/devops/$directory/deploy${directory^}.sh" ]] || {
      printf 'Missing deployment script in %s/devops/%s\n' "$repo_dir" "$directory" >&2
      return 1
    }
  done
  # Use the same credentials for kubectl and Helm. Keep custom configs intact.
  local k3s_config="/etc/rancher/k3s/k3s.yaml"
  local managed_config="$HOME/.kube/trackingtrucks-k3s.yaml"
  local selected_config="${KUBECONFIG:-}" temporary_config
  if [[ -z "$selected_config" ]]; then
    if [[ -f "$managed_config" ]]; then
      selected_config="$managed_config"
    elif [[ -f "$HOME/.kube/config" ]]; then
      selected_config="$HOME/.kube/config"
    elif [[ -f "$k3s_config" ]]; then
      selected_config="$managed_config"
    else
      echo 'No kubeconfig found. Set KUBECONFIG to your cluster config and source this file again.' >&2
      return 1
    fi
  elif [[ "$selected_config" == "$k3s_config" ]]; then
    selected_config="$managed_config"
  fi

  # The private K3s copy contains administrator credentials; never commit it.
  # Refresh it after K3s rotates the certificates in its source config.
  if [[ "$selected_config" == "$managed_config" ]] &&
     { [[ ! -s "$managed_config" ]] || [[ "$k3s_config" -nt "$managed_config" ]]; }; then
    [[ -f "$k3s_config" ]] || {
      echo 'Local K3s config is missing; set KUBECONFIG to an existing cluster config.' >&2
      return 1
    }
    mkdir -p -m 700 -- "$HOME/.kube" || return 1
    temporary_config="$(mktemp "$HOME/.kube/.trackingtrucks-k3s.XXXXXX")" || return 1
    echo 'Preparing your private K3s kubeconfig (sudo may request your password).'
    if ! sudo install -m 600 -o "$(id -u)" -g "$(id -g)" -- "$k3s_config" "$temporary_config"; then
      rm -f -- "$temporary_config"
      echo 'Could not copy K3s credentials. Resolve the sudo error and source this file again.' >&2
      return 1
    fi
    if ! mv -f -- "$temporary_config" "$managed_config"; then
      rm -f -- "$temporary_config"
      return 1
    fi
  fi
  if [[ "$selected_config" == "$managed_config" ]]; then
    chmod 600 -- "$managed_config" || return 1
  fi
  KUBECONFIG="$selected_config" kubectl config view >/dev/null || {
    echo 'Cannot read the selected kubeconfig. Check its path and permissions.' >&2
    return 1
  }
  export KUBECONFIG="$selected_config"

  if [[ -z "$cluster_context" ]]; then
    cluster_context="$(kubectl config current-context)" || {
      echo 'Set a current context in your kubeconfig or set KUBE_CONTEXT, then source setup.sh again.' >&2
      return 1
    }
  fi
  [[ -n "$cluster_context" ]] || { echo 'Kubernetes context is empty.' >&2; return 1; }

  cd -- "$repo_dir" || return
  export DEPLOY_REPO_ROOT="$repo_dir"
  export KUBE_CONTEXT="$cluster_context" RANCHER_HOSTNAME="$rancher_hostname"
  export RANCHER_CHART_VERSION="$rancher_version" JENKINS_CHART_VERSION="$jenkins_version"
  export DEPLOY_TIMEOUT="$deploy_timeout"
  # Preserve your existing PATH and avoid duplicates if sourced again.
  for directory in "$repo_dir/devops" "$repo_dir/devops/rancher" "$repo_dir/devops/jenkins"; do
    case ":$PATH:" in
      *":$directory:"*) ;;
      *) export PATH="$directory:$PATH" ;;
    esac
  done

  # Optional shortcuts; the .sh script is the primary deployment interface.
  deployRancher() {
    bash "$DEPLOY_REPO_ROOT/devops/rancher/deployRancher.sh" "$@"
  }
  deployJenkins() {
    bash "$DEPLOY_REPO_ROOT/devops/jenkins/deployJenkins.sh" "$@"
  }

  printf 'Environment ready. Repo: %s\nKubernetes context: %s\n' "$DEPLOY_REPO_ROOT" "$KUBE_CONTEXT"
  printf 'Rancher URL: https://%s\n' "$RANCHER_HOSTNAME"
  printf 'Deploy Rancher: bash "%s/devops/rancher/deployRancher.sh"\n' "$DEPLOY_REPO_ROOT"
  echo 'Setup only prepared this shell; run the .sh script above to deploy.'
}

if _prepare_deploy_environment; then
  unset -f _prepare_deploy_environment
  return 0
else
  unset -f _prepare_deploy_environment
  return 1
fi
