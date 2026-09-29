---
description: Cancel a running Cursor job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node --experimental-strip-types --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.ts" cancel "$ARGUMENTS"`
