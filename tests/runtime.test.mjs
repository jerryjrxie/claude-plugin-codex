import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir, run } from "./helpers.mjs";

const SESSION_HOOK = path.resolve(import.meta.dirname, "..", "scripts", "session-lifecycle-hook.mjs");

test("session start hook exports the Claude session id and plugin data dir for later commands", () => {
  const repo = makeTempDir();
  const envFile = path.join(makeTempDir(), "claude-env.sh");
  fs.writeFileSync(envFile, "", "utf8");
  const pluginDataDir = makeTempDir();

  const result = run("node", [SESSION_HOOK, "SessionStart"], {
    cwd: repo,
    env: {
      ...process.env,
      CLAUDE_ENV_FILE: envFile,
      CLAUDE_COMPANION_PLUGIN_DATA: pluginDataDir
    },
    input: JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "sess-current",
      cwd: repo
    })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.readFileSync(envFile, "utf8"),
    [
      "export CLAUDE_COMPANION_SESSION_ID='sess-current'",
      `export CLAUDE_COMPANION_PLUGIN_DATA='${pluginDataDir}'`,
      `export CLAUDE_PLUGIN_DATA='${pluginDataDir}'`,
      ""
    ].join("\n")
  );
});
