# Plan: Cursor plugin for Claude Code

A Claude Code plugin that lets Claude hand work to the Cursor Agent CLI (`cursor-agent`) and get the result back. It is modeled on [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc). Claude stays the orchestrator and Cursor runs as a subagent.

## What the Cursor CLI already gives us

I checked these against `cursor-agent` version `2026.09.28`.

| Need | CLI support |
| --- | --- |
| Run without a TTY | `-p` / `--print` |
| Machine-readable output | `--output-format json` returns one `result` object with `result`, `session_id`, `is_error` and `usage`. `stream-json` returns one event per line (`system`, `user`, `thinking`, `assistant`, `result`). |
| Read-only runs | `--mode ask` or `--mode plan` |
| Write runs | the default mode plus `--force` and `--trust` |
| Continue a thread | `--resume <session_id>` |
| Model choice | `--model <id>` and `--list-models` |
| Auth check | `cursor-agent status` |

Codex needs a long-lived app-server and a broker process. Cursor needs neither, because each call is a single child process. That removes most of the code in the Codex plugin.

## Scope for v1

Commands, all under the `/cursor:` namespace:

- `/cursor:setup` checks that `cursor-agent` is on PATH and logged in. If it isn't, it prints the install or login command.
- `/cursor:review [--base <ref>] [--wait|--background]` runs a read-only review of the working tree or of the branch diff against a base.
- `/cursor:adversarial-review [--base <ref>] [focus text]` runs the same review with a prompt that challenges design decisions.
- `/cursor:rescue [--model <id>] [--read-only] [--resume|--fresh] <task>` delegates a task through the `cursor:cursor-rescue` subagent.
- `/cursor:status`, `/cursor:result [job]` and `/cursor:cancel [job]` manage background jobs.

The subagent `cursor-rescue` forwards the task to the companion script with one Bash call and returns its output unchanged. It follows the same pattern as `codex-rescue`.

Out of scope for v1: session transfer (`/codex:transfer`), the Stop-hook review gate, and prompting skills.

## Layout

```
.claude-plugin/marketplace.json
plugins/cursor/
  .claude-plugin/plugin.json
  commands/        setup, review, adversarial-review, rescue, status, result, cancel
  agents/          cursor-rescue.md
  prompts/         review.md, adversarial-review.md
  scripts/
    cursor-companion.mjs   CLI entry point, one subcommand per slash command
    lib/cursor.mjs         builds argv and runs cursor-agent
    lib/jobs.mjs           background job state
    lib/git.mjs            review target and diff
tests/
  fake-cursor-agent.mjs    stub binary that prints recorded JSON
  *.test.mjs
```

The code is plain Node (18.18 or later) ESM with no runtime dependencies. Tests use `node:test`.

## How a run works

1. The slash command calls `node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" <subcommand> ...`.
2. The companion script builds the `cursor-agent -p --output-format stream-json --trust ...` argv from the flags.
3. In foreground mode it waits and prints the final `result` text.
4. In background mode it spawns a detached child, writes the stream to `<stateDir>/<jobId>.jsonl`, and returns the job id right away. `status` reads the last events, `result` reads the `result` event, and `cancel` kills the process group.
5. It saves `session_id` for each repo, so `--resume` can continue the last thread.

For a review, the script collects the diff with `git`, puts it into the review prompt, and runs Cursor in `--mode ask`. The Codex plugin can use Codex's built-in review. Cursor doesn't have one, so we build the prompt ourselves.

## Steps

1. Scaffold the marketplace, the plugin manifest and `/cursor:setup`. Verify by running `/plugin marketplace add ./` locally, installing the plugin, and checking that `/cursor:setup` reports the login status.
2. Add `lib/cursor.mjs` for foreground runs and `/cursor:rescue` with the subagent. Verify with unit tests against the fake binary and one real rescue in a scratch repo.
3. Add background jobs with `status`, `result` and `cancel`. Verify by starting a long task, polling its status, cancelling it, and confirming the process is gone.
4. Add `review` and `adversarial-review`. Verify on a scratch repo with a known bug in the diff.
5. Add resume support. Verify that a second `--resume` call sees the first call's context.
6. Write the README and add CI that runs `node --test`.

## Decisions

- Cursor edits the same checkout that Claude works in. Claude orchestrates and Cursor implements, so a separate worktree would only add a merge step.
- The default model is `auto`. Every command accepts `--model <id>` and passes it to the CLI unchanged. `/cursor:setup` prints the output of `cursor-agent --list-models`.
- The repo will be public, so the README and code should not assume a specific Cursor team or account.
