import { type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildRunArgs, isRunning, readLog, type RunFiles, type RunOptions, startCursor } from "./cursor.ts";

export type JobKind = "task" | "review" | "adversarial-review";
export type JobStatus = "running" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  kind: JobKind;
  summary: string;
  model: string;
  readOnly: boolean;
  status: JobStatus;
  pid: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface JobDetails extends RunOptions {
  kind: JobKind;
  summary: string;
  prompt: string;
}

// Each repository gets its own state directory, so jobs from different repositories stay apart.
export function getStateDir(repoRoot: string): string {
  let root = process.env.CLAUDE_PLUGIN_DATA;
  if (!root) {
    root = path.join(os.tmpdir(), "cursor-plugin-cc");
  }
  const hash = createHash("sha256").update(repoRoot).digest("hex").slice(0, 12);
  return path.join(root, "state", path.basename(repoRoot) + "-" + hash);
}

export function jobFiles(stateDir: string, id: string): RunFiles & { job: string } {
  return {
    job: path.join(stateDir, id + ".json"),
    prompt: path.join(stateDir, id + ".prompt.md"),
    log: path.join(stateDir, id + ".jsonl"),
    stderr: path.join(stateDir, id + ".stderr.log"),
  };
}

function saveJob(stateDir: string, job: Job): void {
  fs.writeFileSync(jobFiles(stateDir, job.id).job, JSON.stringify(job, null, 2) + "\n");
}

export function loadJob(stateDir: string, id: string): Job | null {
  const file = jobFiles(stateDir, id).job;
  if (!fs.existsSync(file)) {
    return null;
  }
  return refreshJob(stateDir, JSON.parse(fs.readFileSync(file, "utf8")));
}

// Returns the jobs of this repository, newest first.
export function listJobs(stateDir: string): Job[] {
  if (!fs.existsSync(stateDir)) {
    return [];
  }
  const jobs: Job[] = [];
  for (const name of fs.readdirSync(stateDir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const job = loadJob(stateDir, name.slice(0, -".json".length));
    if (job) {
      jobs.push(job);
    }
  }
  jobs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return jobs;
}

export function startJob(stateDir: string, cwd: string, details: JobDetails): { job: Job; child: ChildProcess } {
  fs.mkdirSync(stateDir, { recursive: true });
  const id = details.kind + "-" + Date.now().toString(36);
  const files = jobFiles(stateDir, id);
  fs.writeFileSync(files.prompt, details.prompt);

  const child = startCursor(buildRunArgs(details), files, cwd);
  if (!child.pid) {
    throw new Error("Could not start cursor-agent. Run /cursor:setup.");
  }

  const job: Job = {
    id: id,
    kind: details.kind,
    summary: details.summary,
    model: details.model,
    readOnly: details.readOnly,
    status: "running",
    pid: child.pid,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  saveJob(stateDir, job);
  return { job, child };
}

// A job can finish while no script is waiting on it, so a running job is checked against its
// process every time it is read. Once the process is gone, the log decides the final status.
function refreshJob(stateDir: string, job: Job): Job {
  if (job.status !== "running" || isRunning(job.pid)) {
    return job;
  }
  const files = jobFiles(stateDir, job.id);
  const log = readLog(files.log);
  if (log.result && !log.result.is_error) {
    job.status = "completed";
  } else {
    job.status = "failed";
  }
  job.finishedAt = fs.statSync(files.log).mtime.toISOString();
  saveJob(stateDir, job);
  return job;
}

export function cancelJob(stateDir: string, job: Job): void {
  // The status is saved before the kill, so the waiting script sees "cancelled" and not "failed".
  job.status = "cancelled";
  job.finishedAt = new Date().toISOString();
  saveJob(stateDir, job);
  try {
    // A negative pid signals the whole process group started by startCursor.
    process.kill(-job.pid, "SIGTERM");
  } catch {
    // The process already exited.
  }
}

// Returns the Cursor session of the newest task in this repository, or null.
export function findLastTaskSession(stateDir: string): string | null {
  for (const job of listJobs(stateDir)) {
    if (job.kind !== "task") {
      continue;
    }
    const log = readLog(jobFiles(stateDir, job.id).log);
    if (log.sessionId) {
      return log.sessionId;
    }
  }
  return null;
}
