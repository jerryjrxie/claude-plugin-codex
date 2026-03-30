#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
PERSONAL_MARKETPLACE_ROOT="${HOME}/.agents/plugins"
PERSONAL_MARKETPLACE_FILE="${PERSONAL_MARKETPLACE_ROOT}/marketplace.json"
PERSONAL_PLUGIN_DIR="${PERSONAL_MARKETPLACE_ROOT}/claude-plugin-codex"
REPO_MARKETPLACE_DIR="${REPO_ROOT}/.agents/plugins"
REPO_MARKETPLACE_FILE="${REPO_MARKETPLACE_DIR}/marketplace.json"

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
  read -r choice

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

  rsync -a \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.DS_Store' \
    "${REPO_ROOT}/" "${PERSONAL_PLUGIN_DIR}/"
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
        "path": "./"
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
    write_repo_marketplace
    print_repo_next_steps
    ;;
  *)
    printf 'Unsupported install mode: %s\n' "$INSTALL_MODE" >&2
    exit 1
    ;;
esac
