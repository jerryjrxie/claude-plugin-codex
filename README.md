# Claude Code plugin for Codex

Use Claude Code from inside Codex for code reviews or to delegate tasks.

This plugin is for Codex users who want an easy way to start using Claude Code from the workflow they already have.

> Based on [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc), the Codex plugin for Claude Code. This project is the exact mirror: a Codex plugin that wraps Claude Code.

## What You Get

- `$claude-review` for a read-only Claude Code review
- `$claude-adversarial-review` for a steerable challenge review
- `$claude-rescue`, `$claude-status`, `$claude-result`, and `$claude-cancel` to delegate work and manage background jobs

## Requirements

- **Anthropic API key or Claude Code authentication.**
  - Set `ANTHROPIC_API_KEY` or run `claude auth login`.
- **Node.js 18.18 or later**

## Install

The old shell-style commands like `plugin marketplace add ...` are not available in every Codex build.
The official Codex plugin docs instead describe repo and personal marketplaces backed by JSON files:
[Build plugins](https://developers.openai.com/codex/plugins/build).

The easiest reliable install today is:

```bash
curl -fsSL https://raw.githubusercontent.com/jerryjrxie/claude-plugin-codex/main/install.sh | bash
```

That opens a simple interactive installer where you can choose:

- `1` for a personal install in `~/.agents/plugins`
- `2` for a repo-local install in `./.agents/plugins` when you are running from a local checkout

Then restart Codex, enable the `claude` plugin from the marketplace the script set up, and run:

```bash
$claude-setup
```

## Repo Marketplace

This repo also includes a repo-local marketplace at [`.agents/plugins/marketplace.json`](/Users/jerry.xie/personal/claude-plugin-codex/.agents/plugins/marketplace.json), which matches the structure described in the official docs.

If you are developing the plugin locally, cloning the repo is enough for Codex to discover that marketplace when it supports repo marketplaces directly.

## Personal Marketplace

The personal install mode copies this repo into `~/.agents/plugins/claude-plugin-codex` and updates `~/.agents/plugins/marketplace.json` so Codex can load it through the documented personal marketplace flow.

If you want to do that manually, the important files are:

- the plugin bundle at `~/.agents/plugins/claude-plugin-codex`
- the personal marketplace file at `~/.agents/plugins/marketplace.json`

## Non-Interactive Install

If you want to script installation, use one of these:

```bash
curl -fsSL https://raw.githubusercontent.com/jerryjrxie/claude-plugin-codex/main/install.sh | bash -s -- --personal
```

Repo-local install requires a clone first:

```bash
git clone https://github.com/jerryjrxie/claude-plugin-codex.git
cd claude-plugin-codex
./install.sh --repo
```

If you prefer cloning first, personal install also works:

```bash
git clone https://github.com/jerryjrxie/claude-plugin-codex.git
cd claude-plugin-codex
./install.sh --personal
```

## Legacy Notes

Earlier I suggested these commands:

```bash
plugin marketplace add jerryjrxie/claude-plugin-codex
plugin install claude@jerryjrxie
```

Those do not work in the Codex CLI build I tested on March 30, 2026, because there is no standalone `plugin` shell command in that environment.

`$claude-setup` will tell you whether Claude Code is ready. If Claude Code is missing and npm is available, it can offer to install Claude Code for you.

If you prefer to install Claude Code yourself, use:

```bash
npm install -g @anthropic-ai/claude-code
```

If Claude Code is installed but not logged in yet, run:

```bash
!claude auth login
```

Or set the API key directly:

```bash
export ANTHROPIC_API_KEY=your-key
```

After install, you should see:

- the `$claude-*` skills listed below
- the `claude-rescue` subagent

One simple first run is:

```bash
$claude-review --background
$claude-status
$claude-result
```

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/jerryjrxie/claude-plugin-codex/main/install.sh | bash -s -- --personal
$claude-setup
```

## Usage

### `$claude-review`

Runs a Claude Code review on your current work.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. It is not steerable and does not take custom focus text. Use [`$claude-adversarial-review`](#claude-adversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```
$claude-review
$claude-review --base main
$claude-review --background
```

This skill is read-only and will not perform any changes.

### `$claude-adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

Examples:

```
$claude-adversarial-review
$claude-adversarial-review --base main challenge whether this was the right caching design
$claude-adversarial-review --background look for race conditions
```

This skill is read-only. It does not fix code.

### `$claude-rescue`

Hands a task to Claude Code through the `claude-rescue` subagent.

Use it when you want Claude Code to:

- investigate a bug
- try a fix
- continue a previous Claude Code task

It supports `--background`, `--wait`, `--resume`, and `--fresh`.

Examples:

```
$claude-rescue investigate why the tests started failing
$claude-rescue fix the failing test with the smallest safe patch
$claude-rescue --resume apply the top fix from the last run
$claude-rescue --model opus investigate the flaky integration test
$claude-rescue --background investigate the regression
```

You can also just ask for a task to be delegated to Claude Code:

```
Ask Claude Code to redesign the database connection to be more resilient.
```

**Notes:**

- if you do not pass `--model`, the default Claude model is used
- model shorthands: `opus` -> `claude-opus-4-6`, `sonnet` -> `claude-sonnet-4-6`, `haiku` -> `claude-haiku-4-5`
- follow-up rescue requests can continue the latest Claude Code task

### `$claude-status`

Shows running and recent Claude Code jobs for the current repository.

Examples:

```
$claude-status
$claude-status task-abc123
```

### `$claude-result`

Shows the final stored output for a finished job.

Examples:

```
$claude-result
$claude-result task-abc123
```

### `$claude-cancel`

Cancels an active background Claude Code job.

Examples:

```
$claude-cancel
$claude-cancel task-abc123
```

### `$claude-setup`

Checks whether Claude Code is installed and authenticated. If Claude Code is missing and npm is available, it can offer to install it for you.

You can also use `$claude-setup` to manage the optional review gate.

#### Enabling review gate

```
$claude-setup --enable-review-gate
$claude-setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a Stop hook to run a targeted Claude Code review based on Codex's response. If that review finds issues, the stop is blocked so Codex can address them first.

> **Warning:** The review gate can create a long-running Codex/Claude loop and may use API credits quickly. Only enable it when you plan to actively monitor the session.

## Claude Code Integration

The plugin wraps the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). It invokes `claude -p --bare --output-format json` for each review or task, using your local Claude Code installation and authentication.

That means:

- it uses the same Claude Code install you would use directly
- it uses the same local authentication state
- it uses the same repository checkout and machine-local environment

## FAQ

### Do I need a separate Claude Code account for this plugin?

If you are already authenticated with Claude Code on this machine, that account works here too. If you only use Codex today and have not used Claude Code yet, you will need to sign in. Run `$claude-setup` to check, and use `!claude auth login` or set `ANTHROPIC_API_KEY` if needed.

### Will it use the same Claude Code config I already have?

Yes. Because the plugin uses your local Claude Code CLI with `--bare` mode, it picks up your API key and model configuration.

### Can I keep using my existing API key setup?

Yes. If you have `ANTHROPIC_API_KEY` set, the plugin detects it automatically. No additional configuration is needed.

## License

Apache-2.0
