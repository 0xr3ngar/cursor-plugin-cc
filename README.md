# cursor-plugin-cc

Use the Cursor Agent CLI from inside Claude Code. Claude stays the main agent and hands implementation, fixes, investigations and reviews to Cursor as a subagent.

It is modeled on [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc).

## Requirements

- Node.js 22.18 or later. The plugin is written in TypeScript and Node runs it directly, so there is no build step.
- The Cursor Agent CLI (`cursor-agent`), logged in to a Cursor account. Runs count toward that account's usage.
- macOS or Linux.

## Install

In Claude Code:

```
/plugin marketplace add 0xr3ngar/cursor-plugin-cc
/plugin install cursor@cursor-plugin-cc
/reload-plugins
/cursor:setup
```

If `/cursor:setup` says the CLI is missing, install it with `curl https://cursor.com/install -fsS | bash`. If it says you are not logged in, run `!cursor-agent login`.

## Commands

### `/cursor:rescue [--background] [--model <id or name>] [--read-only] [--resume] <task>`

Hands a task to Cursor through the `cursor:cursor-rescue` subagent and returns Cursor's report. By default Cursor can edit files and run commands in your working tree. Use `--read-only` for investigations, and `--resume` to continue the last Cursor task in this repository.

```
/cursor:rescue fix the failing test in src/parser
/cursor:rescue --read-only find out why the build is slow
/cursor:rescue use opus 5.5 high to refactor the retry logic
/cursor:rescue --resume apply the fix you suggested
```

Claude can also use the subagent on its own. Ask something like "have Cursor implement this, then check its work", and Claude delegates the change to Cursor and then reviews the result.

### `/cursor:review [--background] [--base <ref>] [--model <id>]`

Runs a read-only Cursor review of your uncommitted changes, or of your branch against `--base`.

### `/cursor:adversarial-review [--background] [--base <ref>] [--model <id>] [focus text]`

Runs a review that questions the design and looks for reasons the change should not ship. Focus text steers it, for example `look for race conditions in the job queue`.

### `/cursor:models [words]`

Lists the models your Cursor account can use. Words filter the list, for example `/cursor:models codex fast`.

### `/cursor:status [job]`, `/cursor:result [job]`, `/cursor:cancel [job]`

Show running and recent jobs, print the final output of a job, or cancel a running job. Cancelling stops Cursor and every command it started.

## Models

Without `--model`, Cursor uses `auto`. The plugin gets the model list from `cursor-agent models`, because it differs between accounts and changes often. Loose names like "opus" or "the fast codex one" are resolved against that list, and an id that is not in it is rejected before Cursor starts.

## How it works

Each command runs `plugins/cursor/scripts/cursor-companion.ts`, which starts `cursor-agent -p --output-format stream-json`. The prompt goes to Cursor on stdin, and Cursor's event stream is written to a log file in the plugin's data directory. Each job is tracked per repository.

Cursor runs as a separate process. If Claude Code's command timeout stops the companion script, Cursor keeps working, and `/cursor:status` and `/cursor:result` still find the job.

## Development

```
npm install
npm run typecheck
npm test
```

The tests use a fake `cursor-agent` in `tests/fake-bin`, so they need no Cursor account. To try the plugin from a checkout, start Claude Code with `claude --plugin-dir ./plugins/cursor`.
