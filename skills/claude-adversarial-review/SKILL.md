---
name: claude-adversarial-review
description: Run a Claude Code review that challenges the implementation approach and design choices
---

Run an adversarial Claude Code review. Position it as a challenge review that questions the chosen implementation, design choices, tradeoffs, and assumptions. It is not just a stricter pass over implementation defects.

Core constraint:
- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return Claude Code's output verbatim to the user.
- Keep the framing focused on whether the current approach is the right one, what assumptions it depends on, and where the design could fail under real-world conditions.

Execution mode rules:
- If the arguments include `--wait`, do not ask. Run in the foreground.
- If the arguments include `--background`, do not ask. Run in the background.
- Otherwise, estimate the review size before asking:
  - For working-tree review, start with `git status --short --untracked-files=all`.
  - For working-tree review, also inspect both `git diff --shortstat --cached` and `git diff --shortstat`.
  - For base-branch review, use `git diff --shortstat <base>...HEAD`.
  - Treat untracked files or directories as reviewable work even when `git diff --shortstat` is empty.
  - Only conclude there is nothing to review when the relevant scope is actually empty.
  - Recommend waiting only when the scoped review is clearly tiny, roughly 1-2 files total.
  - In every other case, including unclear size, recommend background.
  - When in doubt, run the review instead of declaring that there is nothing to review.
- Then ask with two options, putting the recommended option first.

Argument handling:
- Preserve the user's arguments exactly.
- Do not strip `--wait` or `--background` yourself.
- Do not weaken the adversarial framing or rewrite the user's focus text.
- Supports `--base <ref>` for branch review.
- Unlike `$claude-review`, this skill can take extra focus text after the flags.

Foreground flow:
- Run:
```bash
node "${PLUGIN_ROOT}/scripts/claude-companion.mjs" adversarial-review "$ARGUMENTS"
```
- Return the command stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
- CRITICAL: Do not fix any issues mentioned in the review output.

Background flow:
- Run the adversarial review command in the background.
- After launching the command, tell the user: "Claude Code adversarial review started in the background. Check `$claude-status` for progress."
