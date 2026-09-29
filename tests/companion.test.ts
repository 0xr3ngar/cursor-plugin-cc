import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";

import { isRunning } from "../plugins/cursor/scripts/lib/cursor.ts";

const companion = path.join(import.meta.dirname, "..", "plugins", "cursor", "scripts", "cursor-companion.ts");

let repo: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-plugin-test-"));
  repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(repo, "app.js"), "console.log('one');\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);

  env = {
    ...process.env,
    PATH: path.join(import.meta.dirname, "fake-bin") + path.delimiter + process.env.PATH,
    CLAUDE_PLUGIN_DATA: path.join(root, "data"),
    FAKE_CURSOR_RECORD: path.join(root, "record.json"),
  };
});

function git(args: string[]) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function run(args: string[]) {
  return spawnSync("node", [companion, ...args], { cwd: repo, env: env, encoding: "utf8" });
}

function recorded() {
  return JSON.parse(fs.readFileSync(env.FAKE_CURSOR_RECORD!, "utf8"));
}

test("setup reports the installed version and login", () => {
  const result = run(["setup"]);
  assert.match(result.stdout, /cursor-agent 0\.0\.0-fake is installed/);
  assert.match(result.stdout, /Logged in as test@example\.com/);
});

test("models lists ids and filters by every word", () => {
  assert.match(run(["models"]).stdout, /^auto - Auto \(default\)$/m);

  const filtered = run(["models", "codex extra"]).stdout.trim().split("\n");
  assert.deepEqual(filtered, [
    "gpt-5.3-codex-xhigh - Codex 5.3 Extra High",
    "gpt-5.3-codex-xhigh-fast - Codex 5.3 Extra High Fast",
  ]);
});

test("task runs cursor-agent with write access and the auto model", () => {
  const result = run(["task", "fix", "the", "bug"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Started Cursor job task-/);
  assert.match(result.stdout, /fake result/);
  assert.match(result.stdout, /model auto, session fake-session-1\]/);

  const call = recorded();
  assert.deepEqual(call.args, ["-p", "--output-format", "stream-json", "--trust", "--model", "auto", "--force"]);
  assert.match(call.prompt, /^fix the bug\n/);
});

test("task --read-only uses ask mode", () => {
  run(["task", "--read-only", "explain the bug"]);
  const call = recorded();
  assert.ok(call.args.includes("--mode"));
  assert.ok(!call.args.includes("--force"));
});

test("task rejects an unknown model before starting cursor-agent", () => {
  const result = run(["task", "--model", "codex-high", "fix it"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no model named "codex-high"\. Close matches: gpt-5\.3-codex-high/);
  assert.ok(!fs.existsSync(env.FAKE_CURSOR_RECORD!));
});

test("task --resume continues the last task session", () => {
  assert.match(run(["task", "--resume", "go on"]).stderr, /no earlier Cursor task/);

  run(["task", "first"]);
  run(["task", "--resume", "go on"]);
  const call = recorded();
  assert.deepEqual(call.args.slice(-2), ["--resume", "fake-session-1"]);
});

test("a failed run prints stderr and exits with 1", () => {
  const result = run(["task", "FAIL"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /failed\.\nfake failure/);
});

test("review says there is nothing to review on a clean tree", () => {
  const result = run(["review"]);
  assert.match(result.stdout, /Nothing to review/);
});

test("review sends the diff and untracked files in read-only mode", () => {
  fs.writeFileSync(path.join(repo, "app.js"), "console.log('two $& ');\n");
  fs.writeFileSync(path.join(repo, "new.js"), "new\n");
  run(["review"]);

  const call = recorded();
  assert.ok(call.args.includes("--mode"));
  assert.match(call.prompt, /Target: the uncommitted changes in the working tree/);
  assert.match(call.prompt, /\+console\.log\('two \$& '\);/);
  assert.match(call.prompt, /- new\.js/);
});

test("review rejects focus text and adversarial review accepts it", () => {
  fs.writeFileSync(path.join(repo, "app.js"), "console.log('two');\n");
  assert.equal(run(["review", "look at errors"]).status, 1);

  run(["adversarial-review", "look", "at", "errors"]);
  assert.match(recorded().prompt, /User focus: look at errors/);
});

test("review --base reviews the branch diff", () => {
  git(["checkout", "-q", "-b", "feature"]);
  fs.writeFileSync(path.join(repo, "app.js"), "console.log('branch');\n");
  git(["commit", "-qam", "change"]);
  run(["review", "--base", "main"]);
  assert.match(recorded().prompt, /Target: the branch diff against main/);
});

test("status, result and cancel manage a running job", async () => {
  const waiting = spawn("node", [companion, "task", "SLEEP"], { cwd: repo, env: env });
  const exited = new Promise((resolve) => waiting.on("exit", resolve));

  let table = "";
  while (!table.includes("| running |")) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    table = run(["status"]).stdout;
  }
  const id = table.match(/\| (task-\S+) \|/)![1];
  assert.match(run(["result"]).stdout, /No finished Cursor jobs/);
  assert.match(run(["status", id]).stdout, /Status: running/);

  assert.match(run(["cancel"]).stdout, new RegExp("Cancelled Cursor job " + id));
  assert.equal(await exited, 1);
  assert.equal(isRunning(recorded().shellPid), false);
  assert.match(run(["status", id]).stdout, /Status: cancelled/);
  assert.match(run(["result", id]).stdout, /was cancelled/);
  assert.match(run(["cancel"]).stdout, /No running Cursor jobs/);
});
