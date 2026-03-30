/**
 * Claude Code CLI integration layer.
 *
 * Each invocation spawns a fresh `claude -p` subprocess.
 */
import { spawn } from "node:child_process";
import { readJsonFile } from "./fs.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";

const DEFAULT_REVIEW_TOOLS = ["Read", "Glob", "Grep", "Bash(git:*)"];
const DEFAULT_TASK_TOOLS = ["Read", "Edit", "Bash", "Glob", "Grep"];
const DEFAULT_READONLY_TOOLS = ["Read", "Glob", "Grep", "Bash(git:*)"];

const MODEL_ALIASES = new Map([
  ["opus", "claude-opus-4-6"],
  ["sonnet", "claude-sonnet-4-6"],
  ["haiku", "claude-haiku-4-5"]
]);

function normalizeModel(model) {
  if (!model) return null;
  const normalized = String(model).trim().toLowerCase();
  return MODEL_ALIASES.get(normalized) ?? model;
}

export function getClaudeAvailability(cwd) {
  return binaryAvailable("claude", ["--version"], { cwd });
}

export function getClaudeAuthStatus(cwd) {
  const availability = getClaudeAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail
    };
  }

  // Check ANTHROPIC_API_KEY first
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      available: true,
      loggedIn: true,
      detail: "authenticated via ANTHROPIC_API_KEY"
    };
  }

  // Check claude CLI auth status
  const result = runCommand("claude", ["auth", "status"], { cwd });
  if (result.error) {
    return {
      available: true,
      loggedIn: false,
      detail: result.error.message
    };
  }

  if (result.status === 0) {
    return {
      available: true,
      loggedIn: true,
      detail: result.stdout.trim() || "authenticated"
    };
  }

  return {
    available: true,
    loggedIn: false,
    detail: result.stderr.trim() || result.stdout.trim() || "not authenticated"
  };
}

export function ensureClaudeReady(cwd) {
  const authStatus = getClaudeAuthStatus(cwd);
  if (!authStatus.available) {
    throw new Error("Claude Code CLI is not installed. Install it with `npm install -g @anthropic-ai/claude-code`, then rerun `$claude-setup`.");
  }
  if (!authStatus.loggedIn) {
    throw new Error("Claude Code CLI is not authenticated. Run `!claude auth login` or set ANTHROPIC_API_KEY and retry.");
  }
}

function buildClaudeArgs(prompt, options = {}) {
  const args = ["-p"];
  if (!options.jsonSchema) {
    args.push("--bare");
  }
  args.push("--output-format", "json");

  if (options.model) {
    const resolvedModel = normalizeModel(options.model);
    if (resolvedModel) {
      args.push("--model", resolvedModel);
    }
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }

  if (options.jsonSchema) {
    const schema = typeof options.jsonSchema === "string"
      ? JSON.stringify(readJsonFile(options.jsonSchema))
      : JSON.stringify(options.jsonSchema);
    args.push("--json-schema", schema);
  }

  if (options.appendSystemPrompt) {
    args.push("--append-system-prompt", options.appendSystemPrompt);
  }

  if (options.resume) {
    args.push("--resume", options.resume);
  } else if (options.continueSession) {
    args.push("--continue");
  }

  // Prompt is passed via stdin to avoid --allowedTools consuming it as a tool name
  return { args, prompt };
}

function parseClaudeJsonOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        continue;
      }
    }
    return null;
  }
}

/**
 * Extract a JSON object from a text response that may contain JSON inside
 * markdown code fences or inline.
 */
function extractJsonFromText(text) {
  if (!text || typeof text !== "string") return null;

  // Try parsing the whole text as JSON first
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}

  // Try extracting from ```json ... ``` fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }

  // Try finding the first { ... } block
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      const parsed = JSON.parse(text.slice(braceStart, braceEnd + 1));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }

  return null;
}

/**
 * Run claude -p as a subprocess and return the result.
 */
export function runClaudeHeadless(cwd, prompt, options = {}) {
  const built = buildClaudeArgs(prompt, options);
  const result = runCommand("claude", built.args, {
    cwd,
    env: options.env,
    input: built.prompt
  });

  const parsed = parseClaudeJsonOutput(result.stdout);
  const resultText = parsed?.result ?? result.stdout;

  // structured_output is the primary source; fall back to extracting JSON from the result text
  const structuredOutput = parsed?.structured_output ?? extractJsonFromText(resultText);

  return {
    status: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    sessionId: parsed?.session_id ?? null,
    result: resultText,
    structuredOutput
  };
}

/**
 * Run a Claude Code review with review-specific flags.
 */
export function runClaudeReview(cwd, prompt, options = {}) {
  return runClaudeHeadless(cwd, prompt, {
    ...options,
    allowedTools: options.allowedTools ?? DEFAULT_REVIEW_TOOLS,
    jsonSchema: options.jsonSchema ?? null
  });
}

/**
 * Run a Claude Code task with task-specific flags.
 */
export function runClaudeTask(cwd, prompt, options = {}) {
  const tools = options.write !== false ? DEFAULT_TASK_TOOLS : DEFAULT_READONLY_TOOLS;
  return runClaudeHeadless(cwd, prompt, {
    ...options,
    allowedTools: options.allowedTools ?? tools
  });
}

/**
 * Spawn a detached Claude Code subprocess for background execution.
 * Returns the child process (unref'd).
 */
export function spawnClaudeBackground(cwd, args, options = {}) {
  const child = spawn("claude", args, {
    cwd,
    env: options.env ?? process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}

export { MODEL_ALIASES, DEFAULT_REVIEW_TOOLS, DEFAULT_TASK_TOOLS, DEFAULT_READONLY_TOOLS };
