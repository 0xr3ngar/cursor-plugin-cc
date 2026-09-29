---
description: Run a read-only Cursor review of local changes or of a branch
argument-hint: '[--background] [--base <ref>] [--model <id>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run a Cursor review. This command only reviews. Do not fix anything the review finds unless the user asks afterwards.

Arguments: `$ARGUMENTS`

1. Remove `--background` from the arguments if it is there. Keep the other arguments as they are. This command takes no focus text; for that the user wants `/cursor:adversarial-review`.
2. Build the command:
   ```bash
   node --experimental-strip-types --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.ts" review <remaining arguments>
   ```
3. If `--background` was given, run it with `Bash` and `run_in_background: true`, then tell the user the review started and that `/cursor:status` shows its progress. Do not wait for it in this turn.
4. Otherwise run it in the foreground with a timeout of 600000 ms.
5. Show the output to the user as it is, without commentary.
