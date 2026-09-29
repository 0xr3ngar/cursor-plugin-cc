---
description: Check whether the Cursor Agent CLI is installed and logged in
allowed-tools: Bash(node:*)
---

!`node --experimental-strip-types --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.ts" setup`

Show the output above to the user. If cursor-agent is missing, show the install command. If it is not logged in, tell the user to run `!cursor-agent login`. Do not install or log in on the user's behalf.
