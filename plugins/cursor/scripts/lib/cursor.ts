import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";

export const CURSOR_BIN = "cursor-agent";

export interface RunOptions {
  model: string;
  readOnly: boolean;
  resumeSessionId: string | null;
}

export interface RunFiles {
  prompt: string;
  log: string;
  stderr: string;
}

// The last event of a run. `result` holds Cursor's final reply, or the error text when is_error is true.
export interface ResultEvent {
  is_error: boolean;
  result: string;
}

export interface LogSummary {
  sessionId: string | null;
  result: ResultEvent | null;
  lastText: string;
  toolCalls: number;
}

interface MessagePart {
  type: string;
  text?: string;
}

export function buildRunArgs(options: RunOptions): string[] {
  const args = ["-p", "--output-format", "stream-json", "--trust", "--model", options.model];
  if (options.readOnly) {
    args.push("--mode", "ask");
  } else {
    // Without --force, print mode refuses shell commands that need approval.
    args.push("--force");
  }
  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  }
  return args;
}

// Starts cursor-agent with the prompt file as stdin and the event stream written to the log file.
export function startCursor(args: string[], files: RunFiles, cwd: string): ChildProcess {
  const promptFd = fs.openSync(files.prompt, "r");
  const logFd = fs.openSync(files.log, "w");
  const stderrFd = fs.openSync(files.stderr, "w");

  // detached puts cursor-agent in its own process group. Cancel can then stop it together with
  // the shell commands it started, and it keeps running if this script is stopped by a timeout.
  const child = spawn(CURSOR_BIN, args, {
    cwd: cwd,
    detached: true,
    stdio: [promptFd, logFd, stderrFd],
  });
  // A missing binary is reported through child.pid being undefined, so the error event is ignored.
  child.on("error", () => {});

  fs.closeSync(promptFd);
  fs.closeSync(logFd);
  fs.closeSync(stderrFd);
  return child;
}

function messageText(parts: MessagePart[]): string {
  let text = "";
  for (const part of parts) {
    if (part.type === "text" && part.text) {
      text += part.text;
    }
  }
  return text;
}

// Reads the stream-json log of a run, which may still be growing.
export function readLog(logPath: string): LogSummary {
  const summary: LogSummary = { sessionId: null, result: null, lastText: "", toolCalls: 0 };
  if (!fs.existsSync(logPath)) {
    return summary;
  }

  for (const line of fs.readFileSync(logPath, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      // The last line can be half written while cursor-agent is running.
      continue;
    }

    if (event.session_id) {
      summary.sessionId = event.session_id;
    }
    if (event.type === "assistant") {
      summary.lastText = messageText(event.message.content);
    }
    if (event.type === "tool_call" && event.subtype === "started") {
      summary.toolCalls += 1;
    }
    if (event.type === "result") {
      summary.result = event;
    }
  }
  return summary;
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
