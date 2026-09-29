---
description: Run a Cursor review that questions the design and looks for reasons not to ship
argument-hint: '[--background] [--base <ref>] [--model <id>] [focus text]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run an adversarial Cursor review. It questions the approach, assumptions and failure modes of the change, not only its details. This command only reviews. Do not fix anything the review finds unless the user asks afterwards.

Arguments: `$ARGUMENTS`

1. Remove `--background` from the arguments if it is there. Keep `--base` and `--model` as they are. Everything else is focus text; pass it as one quoted argument after the flags.
2. Build the command:
   ```bash
   node --experimental-strip-types --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.ts" adversarial-review [--base <ref>] [--model <id>] "<focus text>"
   ```
3. If `--background` was given, run it with `Bash` and `run_in_background: true`, then tell the user the review started and that `/cursor:status` shows its progress. Do not wait for it in this turn.
4. Otherwise run it in the foreground with a timeout of 600000 ms.
5. Show the output to the user as it is, without commentary.
