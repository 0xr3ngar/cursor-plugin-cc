---
description: Show the final output of a finished Cursor job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.ts" result "$ARGUMENTS"`

Show the output above to the user in full. Do not summarize it or drop file paths and line numbers.
