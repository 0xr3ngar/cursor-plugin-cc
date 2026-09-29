import { spawnSync } from "node:child_process";

export interface ReviewInput {
  target: string;
  input: string;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error("git " + args.join(" ") + " failed: " + result.stderr.trim());
  }
  return result.stdout;
}

export function findRepoRoot(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: cwd, encoding: "utf8" });
  if (result.status !== 0) {
    return cwd;
  }
  return result.stdout.trim();
}

function diffBlock(title: string, diff: string): string {
  return "## " + title + "\n\n```diff\n" + diff + "```\n";
}

// Returns the review target and the text for the review prompt, or null when there is nothing to review.
export function collectReviewInput(cwd: string, base: string | undefined): ReviewInput | null {
  if (base) {
    const diff = git(cwd, ["diff", base + "...HEAD"]);
    if (diff.trim() === "") {
      return null;
    }
    return { target: "the branch diff against " + base, input: diffBlock("Branch diff", diff) };
  }

  const status = git(cwd, ["status", "--short", "--untracked-files=all"]);
  if (status.trim() === "") {
    return null;
  }

  const parts = ["## git status\n\n```\n" + status + "```\n"];
  const staged = git(cwd, ["diff", "--cached"]);
  if (staged.trim() !== "") {
    parts.push(diffBlock("Staged changes", staged));
  }
  const unstaged = git(cwd, ["diff"]);
  if (unstaged.trim() !== "") {
    parts.push(diffBlock("Unstaged changes", unstaged));
  }
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]).trim();
  if (untracked !== "") {
    let list = "## Untracked files\n\nThese files are new and not in the diff. Read them directly.\n\n";
    for (const file of untracked.split("\n")) {
      list += "- " + file + "\n";
    }
    parts.push(list);
  }
  return { target: "the uncommitted changes in the working tree", input: parts.join("\n") };
}
