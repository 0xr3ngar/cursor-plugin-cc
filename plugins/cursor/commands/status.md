---
description: Show running and recent Cursor jobs in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.ts" status "$ARGUMENTS"`

Show the output above to the user as it is.
