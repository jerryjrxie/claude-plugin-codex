---
name: claude-result
description: Show the stored final output for a finished Claude Code job in this repository
---

Run:

```bash
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" result $ARGUMENTS
```

Present the full command output to the user. Do not summarize or condense it. Preserve all details including:
- Job ID and status
- The complete result payload, including verdict, summary, findings, details, artifacts, and next steps
- File paths and line numbers exactly as reported
- Any error messages or parse errors
- Follow-up commands such as `$claude-status <id>` and `$claude-review`
