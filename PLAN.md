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
| Model choice | `--model <id>`, and `cursor-agent models` to list them |
| Auth check | `cursor-agent status` |

Codex needs a long-lived app-server and a broker process. Cursor needs neither, because each call is a single child process. That removes most of the code in the Codex plugin.

## Scope for v1

Commands, all under the `/cursor:` namespace:

- `/cursor:setup` checks that `cursor-agent` is on PATH and logged in. If it isn't, it prints the install or login command.
- `/cursor:review [--base <ref>] [--wait|--background]` runs a read-only review of the working tree or of the branch diff against a base.
- `/cursor:adversarial-review [--base <ref>] [focus text]` runs the same review with a prompt that challenges design decisions.
- `/cursor:rescue [--model <id>] [--read-only] [--resume] <task>` delegates a task through the `cursor:cursor-rescue` subagent.
- `/cursor:status`, `/cursor:result [job]` and `/cursor:cancel [job]` manage background jobs.
- `/cursor:models` lists the model ids the user's Cursor account can use.

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
    cursor-companion.ts    CLI entry point, one subcommand per slash command
    lib/cursor.ts          builds argv, runs cursor-agent and reads its log
    lib/models.ts          parses `cursor-agent models` output
    lib/jobs.ts            job state per repository
    lib/git.ts             review target and diff
tests/
  fake-bin/cursor-agent    puts the fake on PATH
  fake-cursor-agent.ts     stub that prints recorded JSON
  fixtures/models.txt      recorded `cursor-agent models` output
  *.test.ts
```

The code is TypeScript that Node 22.18 or later runs directly, with no build step and no runtime dependencies. `tsc --noEmit` type checks it, and tests use `node:test`.

## How a run works

1. The slash command calls `node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" <subcommand> ...`.
2. The companion script builds the `cursor-agent -p --output-format stream-json --trust ...` argv from the flags.
3. In foreground mode it waits and prints the final `result` text.
4. cursor-agent runs as a detached process that writes its stream to `<stateDir>/<jobId>.jsonl`. `--background` uses Claude Code's background Bash, and if a timeout stops the companion, Cursor keeps running. `status` reads the last events, `result` reads the `result` event, and `cancel` stops the whole process tree. A process group is not enough, because cursor-agent starts each shell command in a new group.
5. It saves `session_id` for each repo, so `--resume` can continue the last thread.

For a review, the script collects the diff with `git`, puts it into the review prompt, and runs Cursor in `--mode ask`. The Codex plugin can use Codex's built-in review. Cursor doesn't have one, so we build the prompt ourselves.

## Model selection

Claude has no way to know which models a Cursor account can use. The list depends on the plan and team, and it changes often. My account currently shows about 250 ids. So the plugin asks the CLI and parses its answer.

`cursor-agent models` prints a header, one line per model, and a tip at the end:

```
Available models

auto - Auto (default)
composer-2.5 - Composer 2.5 (current)
gpt-5.3-codex-high - Codex 5.3 High
...

Tip: use --model <id> (or /model <id> in interactive mode) to switch. ...
```

`lib/models.mjs` keeps only lines that match `^(\S+) - (.+)$`. For each match it returns `{ id, label, isDefault, isCurrent }`, where the two flags come from the ` (default)` and ` (current)` suffixes on the label. The header, blank lines and tip don't match, so they are dropped. `cursor-companion.ts models [words]` prints the list, filtered to models whose id or label contains every word.

The list is used in three places:

1. `/cursor:models` shows the list to the user.
2. When the user names a model loosely, such as "use opus" or "the fast codex one", the `cursor-rescue` subagent runs `models <words>` and picks the matching id. If more than one id matches, it asks the user to choose. It never guesses an id that is not in the list.
3. Before a run starts, the companion script checks the `--model` value against the list and fails with the closest ids if the value is not there. Some models take a bracket override such as `claude-opus-4-8[effort=high]`. For those, only the part before `[` is checked.

The CLI output is plain text with no stable format, so a Cursor release could change it. Unit tests run the parser against a recorded copy in `tests/fixtures/models.txt`. If parsing finds no models, the script says so and prints the raw output rather than failing silently. The script does not cache the list: fetching it takes about a second, and a cache would go stale when the account changes.

## Steps

1. Scaffold the marketplace, the plugin manifest and `/cursor:setup`. Verify by running `/plugin marketplace add ./` locally, installing the plugin, and checking that `/cursor:setup` reports the login status.
2. Add `lib/models.mjs` and `/cursor:models`. Verify with parser tests against the fixture and by running `/cursor:models` for real.
3. Add `lib/cursor.mjs` for foreground runs and `/cursor:rescue` with the subagent, including model lookup and validation. Verify with unit tests against the fake binary, one real rescue in a scratch repo, and one rescue that says "use opus".
4. Add background jobs with `status`, `result` and `cancel`. Verify by starting a long task, polling its status, cancelling it, and confirming the process is gone.
5. Add `review` and `adversarial-review`. Verify on a scratch repo with a known bug in the diff.
6. Add resume support. Verify that a second `--resume` call sees the first call's context.
7. Write the README and add CI that runs `node --test`.

## Decisions

- Cursor edits the same checkout that Claude works in. Claude orchestrates and Cursor implements, so a separate worktree would only add a merge step.
- The default model is `auto`. Every command accepts `--model <id>`, which is checked against the parsed model list (see Model selection).
- The repo will be public, so the README and code should not assume a specific Cursor team or account.
