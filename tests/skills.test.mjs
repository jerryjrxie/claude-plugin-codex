import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..");

function readSkill(skillName) {
  return fs.readFileSync(path.join(ROOT, "skills", skillName, "SKILL.md"), "utf8");
}

test("review skill stays review-only and runs companion script", () => {
  const source = readSkill("claude-review");
  assert.match(source, /review-only/i);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /Claude Code's output verbatim/i);
  assert.match(source, /claude-companion\.mjs" review/);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /Recommend waiting only when the review is clearly tiny, roughly 1-2 files/i);
  assert.match(source, /In every other case, including unclear size, recommend background/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /Recommended/);
  assert.match(source, /Use `\$claude-adversarial-review` for that/);
  assert.match(source, /CRITICAL: Do not fix any issues/i);
});

test("adversarial review skill stays review-only and supports focus text", () => {
  const source = readSkill("claude-adversarial-review");
  assert.match(source, /review-only/i);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /Claude Code's output verbatim/i);
  assert.match(source, /claude-companion\.mjs" adversarial-review/);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /Supports `--base <ref>` for branch review/);
  assert.match(source, /this skill can take extra focus text after the flags/i);
  assert.match(source, /CRITICAL: Do not fix any issues/i);
});

test("skill files are complete", () => {
  const skillDirs = fs.readdirSync(path.join(ROOT, "skills")).sort();
  assert.deepEqual(skillDirs, [
    "claude-adversarial-review",
    "claude-cancel",
    "claude-rescue",
    "claude-result",
    "claude-result-handling",
    "claude-review",
    "claude-runtime",
    "claude-setup",
    "claude-status"
  ]);
});

test("rescue skill routes to subagent and supports resume flow", () => {
  const rescue = readSkill("claude-rescue");
  const agent = fs.readFileSync(path.join(ROOT, "agents", "claude-rescue.toml"), "utf8");
  const runtimeSkill = readSkill("claude-runtime");

  assert.match(rescue, /Claude Code's output verbatim/i);
  assert.match(rescue, /--background/);
  assert.match(rescue, /--resume/);
  assert.match(rescue, /--fresh/);
  assert.match(rescue, /task-resume-candidate --json/);
  assert.match(rescue, /Continue current Claude Code thread/);
  assert.match(rescue, /Start a new Claude Code thread/);
  assert.match(rescue, /default to foreground/i);
  assert.match(rescue, /claude-rescue.*subagent/i);
  assert.match(rescue, /thin forwarder only/i);

  assert.match(agent, /claude-rescue/);
  assert.match(agent, /thin forwarding wrapper/i);
  assert.match(agent, /claude-companion\.mjs" task/);
  assert.match(agent, /--write/);
  assert.match(agent, /claude-opus-4-6/);
  assert.match(agent, /claude-sonnet-4-6/);
  assert.match(agent, /claude-haiku-4-5/);

  assert.match(runtimeSkill, /invoke `task` once and return that stdout unchanged/i);
  assert.match(runtimeSkill, /Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel`/i);
});

test("result-handling skill prevents auto-fixing", () => {
  const resultHandling = readSkill("claude-result-handling");
  assert.match(resultHandling, /do not turn a failed or incomplete Claude Code run into a Codex-side implementation attempt/i);
  assert.match(resultHandling, /if Claude Code was never successfully invoked, do not generate a substitute answer/i);
  assert.match(resultHandling, /CRITICAL.*Do not make any code changes/i);
});

test("hooks are configured for SessionStart and Stop", () => {
  const source = fs.readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8");
  assert.match(source, /SessionStart/);
  assert.match(source, /Stop/);
  assert.match(source, /stop-review-gate-hook\.mjs/);
  assert.match(source, /session-lifecycle-hook\.mjs/);
});

test("setup skill offers installation and auth guidance", () => {
  const setup = readSkill("claude-setup");
  assert.match(setup, /npm install -g @anthropic-ai\/claude-code/);
  assert.match(setup, /claude-companion\.mjs" setup --json/);
  assert.match(setup, /claude auth login/i);
  assert.match(setup, /ANTHROPIC_API_KEY/);
  assert.match(setup, /--enable-review-gate/);
  assert.match(setup, /--disable-review-gate/);
});
