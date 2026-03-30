import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..");

test("plugin manifest uses the Claude Code identity", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8"));

  assert.equal(manifest.name, "claude");
  assert.equal(manifest.interface.displayName, "Claude Code");
  assert.equal(manifest.interface.developerName, "Jerry Xie");
  assert.equal(manifest.skills, "./skills/");
});

test("marketplace manifest exposes the claude plugin under the jerryjrxie namespace", () => {
  const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, "marketplace.json"), "utf8"));

  assert.equal(marketplace.name, "jerryjrxie");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, "claude");
  assert.deepEqual(marketplace.plugins[0].source, {
    source: "local",
    path: "./"
  });
});

test("repo-local marketplace exposes the claude plugin for Codex discovery", () => {
  const marketplace = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".agents", "plugins", "marketplace.json"), "utf8")
  );

  assert.equal(marketplace.name, "jerryjrxie-local");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, "claude");
  assert.deepEqual(marketplace.plugins[0].source, {
    source: "local",
    path: "./"
  });
});
