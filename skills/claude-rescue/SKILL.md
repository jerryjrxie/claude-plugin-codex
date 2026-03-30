---
name: claude-rescue
description: Delegate investigation, an explicit fix request, or follow-up rescue work to the Claude Code rescue subagent
---

Route this request to the `claude-rescue` subagent.
The final user-visible response must be Claude Code's output verbatim.

Execution mode:

- If the request includes `--background`, run the `claude-rescue` subagent in the background.
- If the request includes `--wait`, run the `claude-rescue` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags. Do not forward them to `task`, and do not treat them as part of the natural-language task text.
- `--model` is a runtime-selection flag. Preserve it for the forwarded `task` call, but do not treat it as part of the natural-language task text.
- If the request includes `--resume`, do not ask whether to continue. The user already chose.
- If the request includes `--fresh`, do not ask whether to continue. The user already chose.
- Otherwise, before starting Claude Code, check for a resumable rescue thread from this session by running:

```bash
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" task-resume-candidate --json
```

- If that helper reports `available: true`, ask whether to continue the current Claude Code thread or start a new one.
- The two choices must be:
  - Continue current Claude Code thread
  - Start a new Claude Code thread
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put Continue first and recommend it.
- Otherwise put Start a new thread first and recommend it.
- If the user chooses continue, add `--resume` before routing to the subagent.
- If the user chooses a new thread, add `--fresh` before routing to the subagent.
- If the helper reports `available: false`, do not ask. Route normally.

Operating rules:

- The subagent is a thin forwarder only. It should use one shell call to invoke `node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" task ...` and return that command's stdout as-is.
- Return the Claude Code companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, poll status, fetch results, call cancel, summarize output, or do follow-up work of its own.
- Leave --model unset unless the user explicitly asks for one. Map opus to claude-opus-4-6, sonnet to claude-sonnet-4-6, haiku to claude-haiku-4-5.
- If the helper reports that Claude Code is missing or unauthenticated, stop and tell the user to run `$claude-setup`.
- If the user did not supply a request, ask what Claude Code should investigate or fix.
