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
PERSONAL_PLUGIN_DIR="${HOME}/.codex/plugins/claude-plugin-codex"
LEGACY_PERSONAL_PLUGIN_DIR="${PERSONAL_MARKETPLACE_ROOT}/claude-plugin-codex"
INSTALL_TMP_DIR=""
REPO_MARKETPLACE_DIR=""
REPO_MARKETPLACE_FILE=""
REPO_PLUGIN_DIR=""
LEGACY_REPO_PLUGIN_DIR=""
TTY_INPUT="/dev/tty"

usage() {
  cat <<'EOF'
Usage:
  ./install.sh
  ./install.sh --personal
  ./install.sh --repo

Options:
  --personal         Install into ~/.codex/plugins and register in ~/.agents/plugins
  --repo             Install into ./plugins and register in ./.agents/plugins
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
  mkdir -p "$(dirname "$PERSONAL_PLUGIN_DIR")"
  rm -rf "$PERSONAL_PLUGIN_DIR"
  rm -rf "$LEGACY_PERSONAL_PLUGIN_DIR"
  mkdir -p "$PERSONAL_PLUGIN_DIR"

  INSTALL_TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${INSTALL_TMP_DIR:-}"' EXIT
  git clone --depth=1 "$REPO_GIT_URL" "${INSTALL_TMP_DIR}/claude-plugin-codex" >/dev/null 2>&1
  rsync -a \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.DS_Store' \
    "${INSTALL_TMP_DIR}/claude-plugin-codex/" "${PERSONAL_PLUGIN_DIR}/"
}

copy_repo_for_repo_install() {
  mkdir -p "$REPO_MARKETPLACE_DIR"
  mkdir -p "$(dirname "$REPO_PLUGIN_DIR")"
  rm -rf "$REPO_PLUGIN_DIR"
  rm -rf "$LEGACY_REPO_PLUGIN_DIR"
  mkdir -p "$REPO_PLUGIN_DIR"

  INSTALL_TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${INSTALL_TMP_DIR:-}"' EXIT
  git clone --depth=1 "$REPO_GIT_URL" "${INSTALL_TMP_DIR}/claude-plugin-codex" >/dev/null 2>&1
  rsync -a \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.DS_Store' \
    "${INSTALL_TMP_DIR}/claude-plugin-codex/" "${REPO_PLUGIN_DIR}/"
}

write_repo_marketplace() {
  mkdir -p "$REPO_MARKETPLACE_DIR"
  write_or_update_marketplace \
    "$REPO_MARKETPLACE_FILE" \
    "local-repo" \
    "Local Repo Plugins" \
    "./plugins/claude-plugin-codex"
}

write_or_update_marketplace() {
  local marketplace_file="$1"
  local default_name="$2"
  local default_display_name="$3"
  local source_path="$4"

  python3 - "$marketplace_file" "$default_name" "$default_display_name" "$source_path" <<'PY'
import json
import os
import sys

marketplace_file = sys.argv[1]
default_name = sys.argv[2]
default_display_name = sys.argv[3]
source_path = sys.argv[4]

if os.path.exists(marketplace_file):
    with open(marketplace_file, "r", encoding="utf8") as f:
        marketplace = json.load(f)
else:
    marketplace = {
        "name": default_name,
        "interface": {"displayName": default_display_name},
        "plugins": []
    }

if not isinstance(marketplace, dict):
    marketplace = {}

marketplace.setdefault("name", default_name)

interface = marketplace.get("interface")
if not isinstance(interface, dict):
    interface = {}
interface.setdefault("displayName", default_display_name)
marketplace["interface"] = interface

plugins = marketplace.get("plugins")
if not isinstance(plugins, list):
    plugins = []

entry = {
    "name": "claude",
    "description": "Use Claude Code from Codex to review code or delegate tasks.",
    "version": "1.0.0",
    "source": {
        "source": "local",
        "path": source_path
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

write_or_update_personal_marketplace() {
  mkdir -p "$PERSONAL_MARKETPLACE_ROOT"
  write_or_update_marketplace \
    "$PERSONAL_MARKETPLACE_FILE" \
    "personal" \
    "Personal Plugins" \
    "./.codex/plugins/claude-plugin-codex"
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
Plugin copy: ${REPO_PLUGIN_DIR}

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
    REPO_ROOT="$PWD"
    REPO_MARKETPLACE_DIR="${REPO_ROOT}/.agents/plugins"
    REPO_MARKETPLACE_FILE="${REPO_MARKETPLACE_DIR}/marketplace.json"
    REPO_PLUGIN_DIR="${REPO_ROOT}/plugins/claude-plugin-codex"
    LEGACY_REPO_PLUGIN_DIR="${REPO_MARKETPLACE_DIR}/claude-plugin-codex"
    copy_repo_for_repo_install
    write_repo_marketplace
    print_repo_next_steps
    ;;
  *)
    printf 'Unsupported install mode: %s\n' "$INSTALL_MODE" >&2
    exit 1
    ;;
esac
