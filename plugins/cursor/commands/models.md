---
description: List the Cursor models this account can use, optionally filtered by words
argument-hint: '[words to filter by]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.ts" models "$ARGUMENTS"`

Show the model list above to the user as it is. Pass any of these ids to `--model` in `/cursor:rescue`, `/cursor:review` or `/cursor:adversarial-review`.
