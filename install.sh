#!/usr/bin/env bash
set -euo pipefail

REPO_GIT_URL="https://github.com/jerryjrxie/claude-plugin-codex.git"
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
if [[ -n "$SCRIPT_SOURCE" && "$SCRIPT_SOURCE" != "bash" && "$SCRIPT_SOURCE" != "-bash" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  REPO_ROOT="$SCRIPT_DIR"
  RUNNING_FROM_PIPE=0
else
  SCRIPT_DIR=""
  REPO_ROOT=""
  RUNNING_FROM_PIPE=1
fi

PERSONAL_MARKETPLACE_ROOT="${HOME}/.agents/plugins"
PERSONAL_MARKETPLACE_FILE="${PERSONAL_MARKETPLACE_ROOT}/marketplace.json"
PERSONAL_PLUGIN_DIR="${PERSONAL_MARKETPLACE_ROOT}/claude-plugin-codex"
INSTALL_TMP_DIR=""
REPO_MARKETPLACE_DIR=""
REPO_MARKETPLACE_FILE=""
TTY_INPUT="/dev/tty"
if [[ -n "$REPO_ROOT" ]]; then
  REPO_MARKETPLACE_DIR="${REPO_ROOT}/.agents/plugins"
  REPO_MARKETPLACE_FILE="${REPO_MARKETPLACE_DIR}/marketplace.json"
fi

usage() {
  cat <<'EOF'
Usage:
  ./install.sh
  ./install.sh --personal
  ./install.sh --repo

Options:
  --personal         Install into the personal marketplace at ~/.agents/plugins
  --repo             Set up the repo-local marketplace at ./.agents/plugins
  -h, --help         Show this help text

If no mode is provided, the script runs in interactive mode and asks whether you
want a personal install or a repo-local install.
EOF
}

pick_mode_interactive() {
  printf 'Choose install mode:\n'
  printf '1. Personal install (Recommended)\n'
  printf '2. Repo-local install\n'
  printf '> '
  if [[ -r "$TTY_INPUT" ]]; then
    read -r choice < "$TTY_INPUT"
  else
    printf '\nInteractive input is unavailable. Falling back to personal install.\n'
    choice=""
  fi

  case "$choice" in
    1|"") INSTALL_MODE="personal" ;;
    2) INSTALL_MODE="repo" ;;
    *)
      printf 'Invalid selection: %s\n' "$choice" >&2
      exit 1
      ;;
  esac
}

copy_repo_for_personal_install() {
  mkdir -p "$PERSONAL_MARKETPLACE_ROOT"
  rm -rf "$PERSONAL_PLUGIN_DIR"
  mkdir -p "$PERSONAL_PLUGIN_DIR"

  if [[ "$RUNNING_FROM_PIPE" -eq 1 ]]; then
    INSTALL_TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "${INSTALL_TMP_DIR:-}"' EXIT
    git clone --depth=1 "$REPO_GIT_URL" "${INSTALL_TMP_DIR}/claude-plugin-codex" >/dev/null 2>&1
    rsync -a \
      --exclude '.git' \
      --exclude 'node_modules' \
      --exclude '.DS_Store' \
      "${INSTALL_TMP_DIR}/claude-plugin-codex/" "${PERSONAL_PLUGIN_DIR}/"
    return
  fi

  rsync -a \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.DS_Store' \
    "${REPO_ROOT}/" "${PERSONAL_PLUGIN_DIR}/"
}

copy_repo_for_repo_install() {
  mkdir -p "$REPO_MARKETPLACE_DIR"
  local repo_plugin_dir="${REPO_MARKETPLACE_DIR}/claude-plugin-codex"
  rm -rf "$repo_plugin_dir"
  mkdir -p "$repo_plugin_dir"

  if [[ "$RUNNING_FROM_PIPE" -eq 1 ]]; then
    INSTALL_TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "${INSTALL_TMP_DIR:-}"' EXIT
    git clone --depth=1 "$REPO_GIT_URL" "${INSTALL_TMP_DIR}/claude-plugin-codex" >/dev/null 2>&1
    rsync -a \
      --exclude '.git' \
      --exclude 'node_modules' \
      --exclude '.DS_Store' \
      "${INSTALL_TMP_DIR}/claude-plugin-codex/" "${repo_plugin_dir}/"
    return
  fi

  rsync -a \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.DS_Store' \
    "${REPO_ROOT}/" "${repo_plugin_dir}/"
}

write_repo_marketplace() {
  mkdir -p "$REPO_MARKETPLACE_DIR"
  cat > "$REPO_MARKETPLACE_FILE" <<'EOF'
{
  "name": "jerryjrxie-local",
  "interface": {
    "displayName": "Jerry Xie Local Plugins"
  },
  "plugins": [
    {
      "name": "claude",
      "source": {
        "source": "local",
        "path": "./claude-plugin-codex"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Coding"
    }
  ]
}
EOF
}

write_or_update_personal_marketplace() {
  mkdir -p "$PERSONAL_MARKETPLACE_ROOT"
  python3 - "$PERSONAL_MARKETPLACE_FILE" <<'PY'
import json
import os
import sys

marketplace_file = sys.argv[1]

if os.path.exists(marketplace_file):
    with open(marketplace_file, "r", encoding="utf8") as f:
        marketplace = json.load(f)
else:
    marketplace = {
        "name": "personal",
        "interface": {"displayName": "Personal Plugins"},
        "plugins": []
    }

plugins = marketplace.get("plugins")
if not isinstance(plugins, list):
    plugins = []

entry = {
    "name": "claude",
    "description": "Use Claude Code from Codex to review code or delegate tasks.",
    "version": "1.0.0",
    "source": {
        "source": "local",
        "path": "./claude-plugin-codex"
    },
    "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
    },
    "category": "Coding"
}

replaced = False
for index, plugin in enumerate(plugins):
    if isinstance(plugin, dict) and plugin.get("name") == "claude":
        plugins[index] = {**plugin, **entry}
        replaced = True
        break

if not replaced:
    plugins.append(entry)

marketplace["plugins"] = plugins

with open(marketplace_file, "w", encoding="utf8") as f:
    json.dump(marketplace, f, indent=2)
    f.write("\n")
PY
}

print_personal_next_steps() {
  cat <<EOF
Installed Claude Code plugin for Codex into your personal marketplace.

Plugin copy: ${PERSONAL_PLUGIN_DIR}
Marketplace: ${PERSONAL_MARKETPLACE_FILE}

Next steps:
1. Restart Codex.
2. Open the Plugin Directory and choose the Personal Plugins marketplace.
3. Install or enable the \`claude\` plugin if it is not already enabled.
4. Run \`\$claude-setup\` inside Codex.
EOF
}

print_repo_next_steps() {
  cat <<EOF
Set up the repo-local marketplace for this checkout.

Marketplace: ${REPO_MARKETPLACE_FILE}
Plugin copy: ${REPO_MARKETPLACE_DIR}/claude-plugin-codex

Next steps:
1. Restart Codex if it was already open in this repo.
2. Open this repository in Codex.
3. Open the Plugin Directory and look for the repo-local marketplace.
4. Install or enable the \`claude\` plugin if it is not already enabled.
5. Run \`\$claude-setup\` inside Codex.
EOF
}

INSTALL_MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --personal)
      INSTALL_MODE="personal"
      shift
      ;;
    --repo)
      INSTALL_MODE="repo"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$INSTALL_MODE" ]]; then
  pick_mode_interactive
fi

case "$INSTALL_MODE" in
  personal)
    copy_repo_for_personal_install
    write_or_update_personal_marketplace
    print_personal_next_steps
    ;;
  repo)
    if [[ "$RUNNING_FROM_PIPE" -eq 1 ]]; then
      REPO_ROOT="$PWD"
      REPO_MARKETPLACE_DIR="${REPO_ROOT}/.agents/plugins"
      REPO_MARKETPLACE_FILE="${REPO_MARKETPLACE_DIR}/marketplace.json"
    fi
    copy_repo_for_repo_install
    write_repo_marketplace
    print_repo_next_steps
    ;;
  *)
    printf 'Unsupported install mode: %s\n' "$INSTALL_MODE" >&2
    exit 1
    ;;
esac
