#!/usr/bin/env node

/**
 * SessionStart hook handler for Claude Code Companion.
 *
 * Reads session_id from hook input (stdin JSON) and persists it
 * for job tracking.
 */
import fs from "node:fs";
import process from "node:process";

export const SESSION_ID_ENV = "CLAUDE_COMPANION_SESSION_ID";
const PLUGIN_DATA_ENV = "CLAUDE_COMPANION_PLUGIN_DATA";
const LEGACY_PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function appendEnvVar(name, value) {
  if (!process.env.CLAUDE_ENV_FILE || value == null || value === "") {
    return;
  }
  fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export ${name}=${shellEscape(value)}\n`, "utf8");
}

function handleSessionStart(input) {
  const sessionId = input.session_id ?? null;
  if (sessionId) {
    appendEnvVar(SESSION_ID_ENV, sessionId);
  }
  const pluginDataDir = process.env[PLUGIN_DATA_ENV] || process.env[LEGACY_PLUGIN_DATA_ENV] || null;
  if (pluginDataDir) {
    appendEnvVar(PLUGIN_DATA_ENV, pluginDataDir);
    appendEnvVar(LEGACY_PLUGIN_DATA_ENV, pluginDataDir);
  }
}

async function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";

  if (eventName === "SessionStart") {
    handleSessionStart(input);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
