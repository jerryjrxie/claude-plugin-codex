---
name: claude-runtime
description: Internal helper contract for calling the claude-companion runtime from Codex
---

# Claude Code Runtime

Use this skill only inside the `claude-rescue` subagent.

Primary helper:
- `node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Prefer the helper over hand-rolled `git`, direct Claude Code CLI strings, or any other shell activity.
- Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel` from `claude-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- Leave model unset by default. Add `--model` only when the user explicitly asks for one.
- Map opus to `--model claude-opus-4-6`, sonnet to `--model claude-sonnet-4-6`, haiku to `--model claude-haiku-4-5`.
- Default to a write-capable Claude Code run by adding `--write` unless the user explicitly asks for read-only behavior or only wants review, diagnosis, or research without edits.

Command selection:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--background` or `--wait`, treat that as execution control only. Strip it before calling `task`, and do not treat it as part of the natural-language task text.
- If the forwarded request includes `--model`, normalize and pass it through to `task`.
- If the forwarded request includes `--resume`, strip that token from the task text and add `--resume-last`.
- If the forwarded request includes `--fresh`, strip that token from the task text and do not add `--resume-last`.
- `--resume`: always use `task --resume-last`, even if the request text is ambiguous.
- `--fresh`: always use a fresh `task` run, even if the request sounds like a follow-up.
- `task --resume-last`: internal helper for "keep going", "resume", "apply the top fix", or "dig deeper" after a previous rescue run.

Safety rules:
- Default to write-capable Claude Code work in `claude-rescue` unless the user explicitly asks for read-only behavior.
- Preserve the user's task text as-is apart from stripping routing flags.
- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own.
- Return the stdout of the `task` command exactly as-is.
- If the shell call fails or Claude Code cannot be invoked, return nothing.
