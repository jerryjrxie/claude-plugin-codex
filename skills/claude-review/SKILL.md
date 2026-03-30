---
name: claude-review
description: Run a Claude Code review against local git state
---

Run a Claude Code review on the current work.

Core constraint:
- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return Claude Code's output verbatim to the user.

Execution mode rules:
- If the arguments include `--wait`, do not ask. Run the review in the foreground.
- If the arguments include `--background`, do not ask. Run the review in the background.
- Otherwise, estimate the review size before asking:
  - For working-tree review, start with `git status --short --untracked-files=all`.
  - For working-tree review, also inspect both `git diff --shortstat --cached` and `git diff --shortstat`.
  - For base-branch review, use `git diff --shortstat <base>...HEAD`.
  - Treat untracked files or directories as reviewable work even when `git diff --shortstat` is empty.
  - Only conclude there is nothing to review when the relevant working-tree status is empty or the explicit branch diff is empty.
  - Recommend waiting only when the review is clearly tiny, roughly 1-2 files total.
  - In every other case, including unclear size, recommend background.
  - When in doubt, run the review instead of declaring that there is nothing to review.
- Then ask with two options, putting the recommended option first:
  - Wait for results (Recommended) or Run in background
  - Run in background (Recommended) or Wait for results

Argument handling:
- Preserve the user's arguments exactly.
- Do not strip `--wait` or `--background` yourself.
- Do not add extra review instructions or rewrite the user's intent.
- This skill does not support custom focus text. Use `$claude-adversarial-review` for that.

Foreground flow:
- Run:
```bash
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" review "$ARGUMENTS"
```
- Return the command stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
- CRITICAL: Do not fix any issues mentioned in the review output.

Background flow:
- Run the review command in the background.
- After launching the command, tell the user: "Claude Code review started in the background. Check `$claude-status` for progress."
