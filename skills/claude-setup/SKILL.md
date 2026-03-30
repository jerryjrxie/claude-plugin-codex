---
name: claude-setup
description: Check whether the local Claude Code CLI is ready and optionally toggle the stop-time review gate
---

Run:

```bash
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" setup --json $ARGUMENTS
```

If the result says Claude Code is unavailable and npm is available:
- Ask the user whether to install Claude Code now.
- Put the install option first and recommend it.
- Options:
  - Install Claude Code (Recommended)
  - Skip for now
- If the user chooses install, run:

```bash
npm install -g @anthropic-ai/claude-code
```

- Then rerun:

```bash
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" setup --json $ARGUMENTS
```

If Claude Code is already installed or npm is unavailable:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If Claude Code is installed but not authenticated, preserve the guidance to run `!claude auth login` or set `ANTHROPIC_API_KEY`.

Arguments:
- `--enable-review-gate`: Enable the stop-time review gate.
- `--disable-review-gate`: Disable the stop-time review gate.
