// Entry point for the /cursor:* slash commands. Each command runs one subcommand of this script.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { CURSOR_BIN, readLog } from "./lib/cursor.ts";
import { collectReviewInput, findRepoRoot } from "./lib/git.ts";
import {
  cancelJob,
  findLastTaskSession,
  getStateDir,
  type Job,
  type JobDetails,
  jobFiles,
  listJobs,
  loadJob,
  startJob,
} from "./lib/jobs.ts";
import { fetchModels, modelMatches } from "./lib/models.ts";

const PROMPTS_DIR = path.join(import.meta.dirname, "..", "prompts");

function fillTemplate(name: string, values: Record<string, string>): string {
  let text = fs.readFileSync(path.join(PROMPTS_DIR, name + ".md"), "utf8");
  for (const key of Object.keys(values)) {
    // With a replacer function, String.replace copies "$&" and similar sequences in a diff as plain text.
    text = text.replace("{{" + key + "}}", () => values[key]);
  }
  return text;
}

function currentStateDir(): string {
  return getStateDir(findRepoRoot(process.cwd()));
}

function formatDuration(job: Job): string {
  let end = Date.now();
  if (job.finishedAt) {
    end = Date.parse(job.finishedAt);
  }
  const seconds = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  if (seconds < 60) {
    return seconds + "s";
  }
  return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
}

function shorten(text: string, length: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= length) {
    return oneLine;
  }
  return oneLine.slice(0, length - 3) + "...";
}

function printResult(stateDir: string, job: Job): void {
  const files = jobFiles(stateDir, job.id);
  const log = readLog(files.log);

  if (job.status === "running") {
    console.log("Cursor job " + job.id + " is still running. Check /cursor:status " + job.id + ".");
    return;
  }
  if (job.status === "cancelled") {
    console.log("Cursor job " + job.id + " was cancelled.");
  } else if (job.status === "completed" && log.result) {
    console.log(log.result.result);
  } else {
    console.log("Cursor job " + job.id + " failed.");
    let stderr = fs.readFileSync(files.stderr, "utf8").trim();
    // After a rejected --model, cursor-agent lists about 250 model ids. Only the first sentence is useful.
    const listStart = stderr.indexOf(" Available models:");
    if (listStart !== -1) {
      stderr = stderr.slice(0, listStart) + " Run /cursor:models to see the listed models.";
    }
    if (stderr !== "") {
      console.log(stderr);
    } else if (log.result) {
      console.log(log.result.result);
    }
  }

  let footer = "[Cursor job " + job.id + ", model " + job.model;
  if (log.sessionId) {
    footer += ", session " + log.sessionId;
  }
  console.log("\n" + footer + "]");
}

// Starts a job and waits for it. It prints the job id first, so the caller still has the id if a
// timeout stops this script while cursor-agent keeps running.
async function runJob(details: JobDetails): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  const stateDir = getStateDir(repoRoot);
  const { job, child } = startJob(stateDir, repoRoot, details);
  console.log("Started Cursor job " + job.id + ".\n");

  await new Promise((resolve) => child.on("exit", resolve));

  const finished = loadJob(stateDir, job.id);
  if (!finished) {
    throw new Error("The state file of Cursor job " + job.id + " is missing.");
  }
  printResult(stateDir, finished);
  if (finished.status !== "completed") {
    process.exitCode = 1;
  }
}

function runSetup(): void {
  const version = spawnSync(CURSOR_BIN, ["--version"], { encoding: "utf8" });
  if (version.error) {
    console.log("cursor-agent is not installed.");
    console.log("Install it with: curl https://cursor.com/install -fsS | bash");
    return;
  }
  console.log("cursor-agent " + version.stdout.trim() + " is installed.");

  const status = spawnSync(CURSOR_BIN, ["status"], { encoding: "utf8" });
  const text = (status.stdout + status.stderr).trim();
  if (text.includes("Logged in as")) {
    console.log(text);
  } else {
    console.log("cursor-agent is not logged in. Run: !cursor-agent login");
  }
}

function runModels(argv: string[]): void {
  const { models, raw } = fetchModels();
  if (models.length === 0) {
    console.log("Could not read any models from `cursor-agent models`. Its output was:\n");
    console.log(raw);
    process.exitCode = 1;
    return;
  }

  // The slash command passes its arguments as one string, so this splits them into words.
  const words: string[] = [];
  for (const word of argv.join(" ").split(" ")) {
    if (word !== "") {
      words.push(word);
    }
  }

  let shown = 0;
  for (const model of models) {
    if (modelMatches(model, words)) {
      console.log(model.id + " - " + model.label);
      shown += 1;
    }
  }
  if (shown === 0) {
    console.log('No Cursor model matches "' + words.join(" ") + '". Run /cursor:models to see every model.');
  }
}

async function runTask(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string" },
      "read-only": { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
    },
  });
  const task = positionals.join(" ").trim();
  if (task === "") {
    throw new Error('Tell Cursor what to do, for example: task "fix the failing test"');
  }

  let resumeSessionId = null;
  if (values.resume) {
    resumeSessionId = findLastTaskSession(currentStateDir());
    if (!resumeSessionId) {
      throw new Error("There is no earlier Cursor task in this repository to resume.");
    }
  }

  await runJob({
    kind: "task",
    summary: task,
    prompt: fillTemplate("task", { TASK: task }),
    model: values.model ?? "auto",
    readOnly: values["read-only"],
    resumeSessionId: resumeSessionId,
  });
}

// Only the adversarial review takes focus text.
async function runReview(kind: "review" | "adversarial-review", argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: kind === "adversarial-review",
    options: {
      base: { type: "string" },
      model: { type: "string" },
    },
  });

  const review = collectReviewInput(findRepoRoot(process.cwd()), values.base);
  if (!review) {
    console.log("Nothing to review. The working tree is clean. Use --base <ref> to review a branch.");
    return;
  }

  let focus = positionals.join(" ").trim();
  if (focus === "") {
    focus = "none";
  }

  await runJob({
    kind: kind,
    summary: "Review of " + review.target,
    prompt: fillTemplate(kind, { TARGET: review.target, FOCUS: focus, INPUT: review.input }),
    model: values.model ?? "auto",
    readOnly: true,
    resumeSessionId: null,
  });
}

function printJobDetails(stateDir: string, job: Job): void {
  const log = readLog(jobFiles(stateDir, job.id).log);
  console.log("Job: " + job.id);
  console.log("Kind: " + job.kind);
  console.log("Status: " + job.status);
  console.log("Model: " + job.model);
  console.log("Read-only: " + (job.readOnly ? "yes" : "no"));
  console.log("Started: " + job.startedAt);
  console.log("Elapsed: " + formatDuration(job));
  console.log("Tool calls: " + log.toolCalls);
  if (log.sessionId) {
    console.log("Session: " + log.sessionId);
  }
  console.log("Task: " + job.summary);
  if (log.lastText !== "") {
    console.log("\nLatest message from Cursor:\n" + log.lastText.trim());
  }
  if (job.status === "running") {
    console.log("\nCancel it with /cursor:cancel " + job.id + ".");
  } else {
    console.log("\nSee the full output with /cursor:result " + job.id + ".");
  }
}

function runStatus(id: string): void {
  const stateDir = currentStateDir();
  if (id !== "") {
    const job = loadJob(stateDir, id);
    if (!job) {
      throw new Error("No Cursor job with id " + id + " in this repository.");
    }
    printJobDetails(stateDir, job);
    return;
  }

  const jobs = listJobs(stateDir);
  if (jobs.length === 0) {
    console.log("No Cursor jobs in this repository yet.");
    return;
  }
  console.log("| Job | Kind | Status | Model | Elapsed | Task |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const job of jobs) {
    const cells = [job.id, job.kind, job.status, job.model, formatDuration(job), shorten(job.summary, 60)];
    console.log("| " + cells.join(" | ") + " |");
  }
}

// Picks the job named by id, or the newest job that passes the filter when no id is given.
function pickJob(stateDir: string, id: string, filter: (job: Job) => boolean): Job | null {
  if (id !== "") {
    const job = loadJob(stateDir, id);
    if (!job) {
      throw new Error("No Cursor job with id " + id + " in this repository.");
    }
    return job;
  }
  for (const job of listJobs(stateDir)) {
    if (filter(job)) {
      return job;
    }
  }
  return null;
}

function runResult(id: string): void {
  const stateDir = currentStateDir();
  const job = pickJob(stateDir, id, (candidate) => candidate.status !== "running");
  if (!job) {
    console.log("No finished Cursor jobs in this repository yet.");
    return;
  }
  printResult(stateDir, job);
}

function runCancel(id: string): void {
  const stateDir = currentStateDir();
  const job = pickJob(stateDir, id, (candidate) => candidate.status === "running");
  if (!job) {
    console.log("No running Cursor jobs in this repository.");
    return;
  }
  if (job.status !== "running") {
    console.log("Cursor job " + job.id + " is not running. Its status is " + job.status + ".");
    return;
  }
  cancelJob(stateDir, job);
  console.log("Cancelled Cursor job " + job.id + ".");
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  // status, result and cancel take an optional job id. The slash commands pass "" when there is none.
  const jobId = (argv[0] || "").trim();

  if (command === "setup") {
    runSetup();
  } else if (command === "models") {
    runModels(argv);
  } else if (command === "task") {
    await runTask(argv);
  } else if (command === "review" || command === "adversarial-review") {
    await runReview(command, argv);
  } else if (command === "status") {
    runStatus(jobId);
  } else if (command === "result") {
    runResult(jobId);
  } else if (command === "cancel") {
    runCancel(jobId);
  } else {
    throw new Error("Unknown command: " + command);
  }
}

try {
  await main();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
