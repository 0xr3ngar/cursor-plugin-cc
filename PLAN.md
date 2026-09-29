# Plan: Cursor plugin for Claude Code

This Claude Code plugin lets Claude hand work to the Cursor Agent CLI (`cursor-agent`) and read the result. It follows the design of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc). Claude is the orchestrator and Cursor runs as a subagent.

## What the Cursor CLI already does

I checked these flags against `cursor-agent` version `2026.09.28`.

| Need | CLI support |
| --- | --- |
| Run without a TTY | `-p` / `--print` |
| Machine-readable output | `--output-format json` returns one `result` object with `result`, `session_id`, `is_error` and `usage`. `stream-json` returns one event per line (`system`, `user`, `thinking`, `assistant`, `tool_call`, `result`). |
| Prompt on stdin | `-p` reads the prompt from stdin when there is no prompt argument |
| Read-only runs | `--mode ask` or `--mode plan` |
| Write runs | the default mode plus `--force` and `--trust` |
| Continue a thread | `--resume <session_id>` |
| Model choice | `--model <id>`, and `cursor-agent models` to list the ids |
| Auth check | `cursor-agent status` |

Codex needs a long-lived app-server and a broker process. Cursor needs neither, because each call is a single child process. That removes most of the code in the Codex plugin.

## Scope for v1

All commands use the `/cursor:` namespace:

- `/cursor:setup` checks that `cursor-agent` is on PATH and logged in. If it isn't, it prints the install or login command.
- `/cursor:review [--background] [--base <ref>] [--model <id>]` runs a read-only review of the working tree, or of the branch diff against a base.
- `/cursor:adversarial-review [--background] [--base <ref>] [--model <id>] [focus text]` runs the same review with a prompt that questions the design.
- `/cursor:rescue [--background] [--model <id or name>] [--read-only] [--resume] <task>` hands a task to the `cursor:cursor-rescue` subagent.
- `/cursor:status [job]`, `/cursor:result [job]` and `/cursor:cancel [job]` manage jobs.
- `/cursor:models [words]` lists the model ids the user's Cursor account can use.

The `cursor-rescue` subagent resolves the model, runs the companion script with one Bash call, and returns its output unchanged. It follows the same pattern as `codex-rescue`.

v1 leaves out session transfer (`/codex:transfer`), the Stop-hook review gate, and prompting skills.

## Layout

```
.claude-plugin/marketplace.json
plugins/cursor/
  .claude-plugin/plugin.json
  package.json             marks the plugin's .ts files as ES modules
  commands/                setup, models, rescue, review, adversarial-review, status, result, cancel
  agents/                  cursor-rescue.md
  prompts/                 task.md, review.md, adversarial-review.md
  scripts/
    cursor-companion.ts    entry point, one subcommand per slash command
    lib/cursor.ts          builds argv, runs cursor-agent, reads its log, stops its process tree
    lib/models.ts          parses `cursor-agent models` output
    lib/jobs.ts            job state per repository
    lib/git.ts             review target and diff
tests/
  fake-bin/cursor-agent    puts the fake on PATH
  fake-cursor-agent.ts     stub that prints recorded JSON
  fixtures/models.txt      recorded `cursor-agent models` output
  *.test.ts
```

The code is TypeScript. Node 22.18 or later runs it directly, so there is no build step and no runtime dependency. `tsc --noEmit` type checks it, and the tests use `node:test`.

## How a run works

1. The slash command calls `node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.ts" <subcommand> ...`.
2. The companion script builds the `cursor-agent -p --output-format stream-json --trust --model <id> ...` argv from the flags.
3. It writes the prompt to `<stateDir>/<jobId>.prompt.md` and starts cursor-agent as a detached process. Cursor reads the prompt on stdin and writes its event stream to `<stateDir>/<jobId>.jsonl`.
4. The script prints the job id, waits for Cursor to exit, and prints the final `result` text with the job id and session id.
5. With `--background`, the slash command runs the script through Claude Code's background Bash. If a timeout stops the script, Cursor keeps running, and `status` and `result` still find the job.
6. `status` reads the latest events from the log, `result` reads the `result` event, and `cancel` stops the whole process tree. Stopping the process group is not enough, because cursor-agent starts each shell command in a new group.
7. `--resume` takes the session id of the newest task in the repository and passes it to `--resume`.

For a review, the script collects the diff with `git`, puts it into the review prompt, and runs Cursor in `--mode ask`. The Codex plugin can call Codex's built-in review. Cursor has no built-in review, so the plugin writes its own prompt.

## Model selection

Claude has no way to know which models a Cursor account can use. The list depends on the plan and team, and it changes often. My account shows about 250 ids. So the plugin asks the CLI and parses its answer.

`cursor-agent models` prints a header, one line per model, and a tip at the end:

```
Available models

auto - Auto (default)
composer-2.5 - Composer 2.5 (current)
gpt-5.3-codex-high - Codex 5.3 High
...

Tip: use --model <id> (or /model <id> in interactive mode) to switch. ...
```

`lib/models.ts` keeps only the lines that match `^(\S+) - (.+)$`. For each match it returns `{ id, label, isDefault, isCurrent }`. The two flags come from the ` (default)` and ` (current)` suffixes on the label. The header, blank lines and tip don't match, so the parser drops them. `cursor-companion.ts models [words]` prints the models whose id or label contains every word.

The plugin uses the list in three places:

1. `/cursor:models` shows the list to the user.
2. When the user names a model loosely, such as "use opus" or "the fast codex one", the `cursor-rescue` subagent runs `models <words>` and picks the matching id. If several ids match and the request doesn't settle it, the subagent returns the matches and `/cursor:rescue` asks the user to choose. The subagent never passes an id that the list does not contain.
3. Before a run starts, the companion script checks the `--model` value against the list. If the list doesn't contain it, the script fails and names up to ten ids that contain the value. For a bracket override such as `claude-opus-4-8[effort=high]`, only the part before `[` must match.

The CLI prints plain text with no stable format, so a Cursor release could change it. The unit tests run the parser against a recorded copy in `tests/fixtures/models.txt`. If the parser finds no models, the script says so and prints the raw output. The script doesn't cache the list. Fetching it takes about a second, and a cache would go stale when the account changes.

## Steps

1. Add the marketplace, the plugin manifest and `/cursor:setup`. Check by loading the plugin locally and running `/cursor:setup`.
2. Add `lib/models.ts` and `/cursor:models`. Check with parser tests against the fixture and one real `/cursor:models` run.
3. Add `lib/cursor.ts`, `/cursor:rescue` and the subagent, with model lookup and the model check. Check with tests against the fake binary, one real rescue in a scratch repo, and one rescue that names a model loosely.
4. Add `status`, `result` and `cancel`. Check by starting a long task, polling its status, cancelling it, and confirming that no Cursor process is left.
5. Add `review` and `adversarial-review`. Check on a scratch repo with a known bug in the diff.
6. Add resume support. Check that a second run with `--resume` sees the first run's context.
7. Write the README and add CI that type checks and runs `npm test`.

## Decisions

- Cursor edits the same checkout that Claude works in. Claude orchestrates and Cursor implements, so a separate worktree would only add a merge step.
- The default model is `auto`. Every command accepts `--model <id>`, and the companion script checks the id against the parsed model list.
- The repo will be public, so the README and code must not assume a specific Cursor team or account.
