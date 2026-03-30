#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  ensureClaudeReady,
  getClaudeAvailability,
  getClaudeAuthStatus,
  runClaudeHeadless,
  runClaudeReview,
  runClaudeTask
} from "./lib/claude-cli.mjs";
import { readJsonFile, readStdinIfPiped } from "./lib/fs.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget } from "./lib/git.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import {
  generateJobId,
  getConfig,
  listJobs,
  setConfig,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./lib/job-control.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  nowIso,
  runTrackedJob,
  SESSION_ID_ENV
} from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import {
  renderReviewResult,
  renderStoredJobResult,
  renderCancelReport,
  renderJobStatusReport,
  renderSetupReport,
  renderStatusReport,
  renderTaskResult
} from "./lib/render.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
const STOP_REVIEW_TASK_MARKER = "Run a stop-gate review of the previous Codex turn.";

const MODEL_ALIASES = new Map([
  ["opus", "claude-opus-4-6"],
  ["sonnet", "claude-sonnet-4-6"],
  ["haiku", "claude-haiku-4-5"]
]);

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/claude-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/claude-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>]",
      "  node scripts/claude-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [focus text]",
      "  node scripts/claude-companion.mjs task [--background] [--write] [--resume-last|--resume|--fresh] [--model <model>] [prompt]",
      "  node scripts/claude-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/claude-companion.mjs result [job-id] [--json]",
      "  node scripts/claude-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeRequestedModel(model) {
  if (model == null) return null;
  const normalized = String(model).trim();
  if (!normalized) return null;
  return MODEL_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) return [];
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallback.failureMessage ?? "Claude Code did not return a final structured message.",
      rawOutput: rawOutput ?? "",
      ...fallback
    };
  }

  try {
    return {
      parsed: JSON.parse(rawOutput),
      parseError: null,
      rawOutput,
      ...fallback
    };
  } catch (error) {
    return {
      parsed: null,
      parseError: error.message,
      rawOutput,
      ...fallback
    };
  }
}

// --- Setup ---

function buildSetupReport(cwd, actionsTaken = []) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const npmStatus = binaryAvailable("npm", ["--version"], { cwd });
  const claudeStatus = getClaudeAvailability(cwd);
  const authStatus = getClaudeAuthStatus(cwd);
  const config = getConfig(workspaceRoot);

  const nextSteps = [];
  if (!claudeStatus.available) {
    nextSteps.push("Install Claude Code with `npm install -g @anthropic-ai/claude-code`.");
  }
  if (claudeStatus.available && !authStatus.loggedIn) {
    nextSteps.push("Run `!claude auth login` or set `ANTHROPIC_API_KEY`.");
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Optional: run `$claude-setup --enable-review-gate` to require a fresh review before stop.");
  }

  return {
    ready: nodeStatus.available && claudeStatus.available && authStatus.loggedIn,
    node: nodeStatus,
    npm: npmStatus,
    claude: claudeStatus,
    auth: authStatus,
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps
  };
}

function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
  });

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken = [];

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push(`Enabled the stop-time review gate for ${workspaceRoot}.`);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push(`Disabled the stop-time review gate for ${workspaceRoot}.`);
  }

  const finalReport = buildSetupReport(cwd, actionsTaken);
  outputResult(options.json ? finalReport : renderSetupReport(finalReport), options.json);
}

// --- Review ---

function buildAdversarialReviewPrompt(context, focusText) {
  const template = loadPromptTemplate(ROOT_DIR, "adversarial-review");
  const base = interpolateTemplate(template, {
    REVIEW_KIND: "Adversarial Review",
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_INPUT: context.content
  });
  const schemaJson = JSON.stringify(readJsonFile(REVIEW_SCHEMA), null, 2);
  return `${base}\n\n<output_schema>\nYou MUST return ONLY valid JSON (no markdown, no code fences) matching this exact schema:\n${schemaJson}\n</output_schema>`;
}

function executeReviewRun(request) {
  ensureClaudeReady(request.cwd);
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });
  const focusText = request.focusText?.trim() ?? "";
  const reviewName = request.reviewName ?? "Review";

  const context = collectReviewContext(request.cwd, target);
  let prompt;
  let jsonSchema = null;

  const schemaInstruction = [
    "Return ONLY valid JSON matching this exact schema (no markdown, no commentary, no code fences):",
    JSON.stringify(readJsonFile(REVIEW_SCHEMA), null, 2),
    'verdict must be "approve" or "needs-attention".',
    "severity must be one of: critical, high, medium, low.",
    "Every finding needs: severity, title, body, file, line_start, line_end, confidence (0-1), recommendation."
  ].join("\n");

  if (reviewName === "Review") {
    prompt = [
      `Review the following code changes.`,
      `Target: ${context.target.label}`,
      "",
      context.content,
      "",
      schemaInstruction
    ].join("\n");
    jsonSchema = REVIEW_SCHEMA;
  } else {
    prompt = buildAdversarialReviewPrompt(context, focusText);
    jsonSchema = REVIEW_SCHEMA;
  }

  const result = runClaudeReview(context.repoRoot, prompt, {
    model: request.model,
    jsonSchema
  });

  const rawOutput = result.structuredOutput
    ? JSON.stringify(result.structuredOutput)
    : (typeof result.result === "string" ? result.result : result.stdout);

  const parsed = parseStructuredOutput(rawOutput, {
    status: result.status,
    failureMessage: result.stderr?.trim() || ""
  });

  const payload = {
    review: reviewName,
    target,
    context: {
      repoRoot: context.repoRoot,
      branch: context.branch,
      summary: context.summary
    },
    claude: {
      status: result.status,
      stderr: result.stderr,
      stdout: rawOutput,
      sessionId: result.sessionId
    },
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError
  };

  return {
    exitStatus: result.status,
    sessionId: result.sessionId,
    payload,
    rendered: renderReviewResult(parsed, {
      reviewLabel: reviewName,
      targetLabel: context.target.label
    }),
    summary: parsed.parsed?.summary ?? parsed.parseError ?? firstMeaningfulLine(rawOutput, `${reviewName} finished.`),
    jobTitle: `Claude Code ${reviewName}`,
    jobClass: "review",
    targetLabel: context.target.label
  };
}

// --- Task ---

function executeTaskRun(request) {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  ensureClaudeReady(request.cwd);

  const prompt = request.prompt;
  const write = Boolean(request.write);

  if (!prompt && !request.resumeLast) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }

  const claudeOptions = {
    model: request.model,
    write
  };

  if (request.resumeLast && request.resumeSessionId) {
    claudeOptions.resume = request.resumeSessionId;
  }

  const effectivePrompt = prompt || "Continue from the current state. Pick the next highest-value step and follow through until the task is resolved.";
  const result = runClaudeTask(workspaceRoot, effectivePrompt, claudeOptions);

  const rawOutput = typeof result.result === "string" ? result.result : result.stdout;
  const failureMessage = result.stderr?.trim() ?? "";
  const title = request.resumeLast ? "Claude Code Resume" : "Claude Code Task";

  const rendered = renderTaskResult(
    { rawOutput, failureMessage },
    { title, jobId: request.jobId ?? null, write }
  );

  const payload = {
    status: result.status,
    sessionId: result.sessionId,
    rawOutput,
    stdout: result.stdout,
    stderr: result.stderr
  };

  return {
    exitStatus: result.status,
    sessionId: result.sessionId,
    payload,
    rendered,
    summary: firstMeaningfulLine(rawOutput, firstMeaningfulLine(failureMessage, `${title} finished.`)),
    jobTitle: title,
    jobClass: "task",
    write
  };
}

// --- Job helpers ---

function buildReviewJobMetadata(reviewName, target) {
  return {
    kind: reviewName === "Adversarial Review" ? "adversarial-review" : "review",
    title: reviewName === "Review" ? "Claude Code Review" : `Claude Code ${reviewName}`,
    summary: `${reviewName} ${target.label}`
  };
}

function buildTaskRunMetadata({ prompt, resumeLast = false }) {
  if (!resumeLast && String(prompt ?? "").includes(STOP_REVIEW_TASK_MARKER)) {
    return {
      title: "Claude Code Stop Gate Review",
      summary: "Stop-gate review of previous Codex turn"
    };
  }

  const title = resumeLast ? "Claude Code Resume" : "Claude Code Task";
  const fallbackSummary = resumeLast ? "Continue from current state" : "Task";
  return {
    title,
    summary: shorten(prompt || fallbackSummary)
  };
}

function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary, write = false }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: jobClass === "review" ? (kind === "adversarial-review" ? "adversarial-review" : "review") : "rescue",
    title,
    workspaceRoot,
    jobClass,
    summary,
    write
  });
}

function createTrackedProgress(job, options = {}) {
  const logFile = options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id)
    })
  };
}

function renderQueuedTaskLaunch(payload) {
  return `${payload.title} started in the background as ${payload.jobId}. Check $claude-status ${payload.jobId} for progress.\n`;
}

function spawnDetachedTaskWorker(cwd, jobId) {
  const scriptPath = path.join(ROOT_DIR, "scripts", "claude-companion.mjs");
  const child = spawn(process.execPath, [scriptPath, "task-worker", "--cwd", cwd, "--job-id", jobId], {
    cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return child;
}

// --- Command handlers ---

async function handleReview(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "background", "wait"],
    aliasMap: { m: "model" }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const target = resolveReviewTarget(cwd, { base: options.base, scope: options.scope });
  const metadata = buildReviewJobMetadata("Review", target);
  const job = createCompanionJob({
    prefix: "review",
    kind: metadata.kind,
    title: metadata.title,
    workspaceRoot,
    jobClass: "review",
    summary: metadata.summary
  });

  const { logFile } = createTrackedProgress(job, { stderr: !options.json });
  const execution = await runTrackedJob(job, () =>
    executeReviewRun({
      cwd,
      base: options.base,
      scope: options.scope,
      model: options.model,
      reviewName: "Review"
    }),
    { logFile }
  );
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
}

async function handleAdversarialReview(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "background", "wait"],
    aliasMap: { m: "model" }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();
  const target = resolveReviewTarget(cwd, { base: options.base, scope: options.scope });
  const metadata = buildReviewJobMetadata("Adversarial Review", target);
  const job = createCompanionJob({
    prefix: "review",
    kind: metadata.kind,
    title: metadata.title,
    workspaceRoot,
    jobClass: "review",
    summary: metadata.summary
  });

  const { logFile } = createTrackedProgress(job, { stderr: !options.json });
  const execution = await runTrackedJob(job, () =>
    executeReviewRun({
      cwd,
      base: options.base,
      scope: options.scope,
      model: options.model,
      focusText,
      reviewName: "Adversarial Review"
    }),
    { logFile }
  );
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
}

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "cwd", "prompt-file"],
    booleanOptions: ["json", "write", "resume-last", "resume", "fresh", "background"],
    aliasMap: { m: "model" }
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const model = normalizeRequestedModel(options.model);
  const resumeLast = Boolean(options["resume-last"] || options.resume);
  const fresh = Boolean(options.fresh);
  if (resumeLast && fresh) {
    throw new Error("Choose either --resume/--resume-last or --fresh.");
  }
  const write = Boolean(options.write);

  let prompt;
  if (options["prompt-file"]) {
    prompt = fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8");
  } else {
    prompt = positionals.join(" ") || readStdinIfPiped();
  }

  if (!prompt && !resumeLast) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, or use --resume-last.");
  }

  const taskMetadata = buildTaskRunMetadata({ prompt, resumeLast });
  const job = createCompanionJob({
    prefix: "task",
    kind: "task",
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: "task",
    summary: taskMetadata.summary,
    write
  });

  if (options.background) {
    ensureClaudeReady(cwd);
    const { logFile } = createTrackedProgress(job);
    appendLogLine(logFile, "Queued for background execution.");
    const child = spawnDetachedTaskWorker(cwd, job.id);
    const queuedRecord = {
      ...job,
      status: "queued",
      phase: "queued",
      pid: child.pid ?? null,
      logFile,
      request: { cwd, model, prompt, write, resumeLast, jobId: job.id }
    };
    writeJobFile(workspaceRoot, job.id, queuedRecord);
    upsertJob(workspaceRoot, queuedRecord);
    const payload = { jobId: job.id, status: "queued", title: job.title, summary: job.summary, logFile };
    outputCommandResult(payload, renderQueuedTaskLaunch(payload), options.json);
    return;
  }

  const { logFile } = createTrackedProgress(job, { stderr: !options.json });
  const execution = await runTrackedJob(job, () =>
    executeTaskRun({ cwd, model, prompt, write, resumeLast, jobId: job.id }),
    { logFile }
  );
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
}

async function handleTaskWorker(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "job-id"]
  });

  if (!options["job-id"]) {
    throw new Error("Missing required --job-id for task-worker.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const storedJob = readStoredJob(workspaceRoot, options["job-id"]);
  if (!storedJob) {
    throw new Error(`No stored job found for ${options["job-id"]}.`);
  }

  const request = storedJob.request;
  if (!request || typeof request !== "object") {
    throw new Error(`Stored job ${options["job-id"]} is missing its task request payload.`);
  }

  const { logFile } = createTrackedProgress(
    { ...storedJob, workspaceRoot },
    { logFile: storedJob.logFile ?? null }
  );
  await runTrackedJob(
    { ...storedJob, workspaceRoot, logFile },
    () => executeTaskRun(request),
    { logFile }
  );
}

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "all", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";

  if (reference) {
    const snapshot = buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), options.json);
    return;
  }

  const report = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(options.json ? report : renderStatusReport(report), options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  const payload = { job, storedJob };

  outputCommandResult(payload, renderStoredJobResult(job, storedJob), options.json);
}

function handleTaskResumeCandidate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const sessionId = process.env[SESSION_ID_ENV] ?? null;
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const candidate =
    jobs.find(
      (job) =>
        job.jobClass === "task" &&
        job.sessionId &&
        job.status !== "queued" &&
        job.status !== "running" &&
        (!sessionId || job.sessionId === sessionId)
    ) ?? null;

  const payload = {
    available: Boolean(candidate),
    sessionId,
    candidate:
      candidate == null
        ? null
        : {
            id: candidate.id,
            status: candidate.status,
            title: candidate.title ?? null,
            summary: candidate.summary ?? null,
            sessionId: candidate.sessionId,
            completedAt: candidate.completedAt ?? null,
            updatedAt: candidate.updatedAt ?? null
          }
  };

  const rendered = candidate
    ? `Resumable task found: ${candidate.id} (${candidate.status}).\n`
    : "No resumable task found for this session.\n";
  outputCommandResult(payload, rendered, options.json);
}

async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference);

  terminateProcessTree(job.pid ?? Number.NaN);
  appendLogLine(job.logFile, "Cancelled by user.");

  const completedAt = nowIso();
  const nextJob = {
    ...job,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt,
    errorMessage: "Cancelled by user."
  };

  const existing = readStoredJob(workspaceRoot, job.id) ?? {};
  writeJobFile(workspaceRoot, job.id, {
    ...existing,
    ...nextJob,
    cancelledAt: completedAt
  });
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    errorMessage: "Cancelled by user.",
    completedAt
  });

  const payload = {
    jobId: job.id,
    status: "cancelled",
    title: job.title
  };

  outputCommandResult(payload, renderCancelReport(nextJob), options.json);
}

// --- Main ---

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      handleSetup(argv);
      break;
    case "review":
      await handleReview(argv);
      break;
    case "adversarial-review":
      await handleAdversarialReview(argv);
      break;
    case "task":
      await handleTask(argv);
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
