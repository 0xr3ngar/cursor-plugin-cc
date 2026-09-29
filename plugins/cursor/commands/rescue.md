---
description: Hand a task to Cursor through the cursor-rescue subagent
argument-hint: '[--background] [--model <id or name>] [--read-only] [--resume] <task>'
allowed-tools: Agent, AskUserQuestion
---

Hand the request below to the `cursor:cursor-rescue` subagent with the `Agent` tool (`subagent_type: "cursor:cursor-rescue"`). It is a subagent, not a skill, so do not call it through the `Skill` tool.

Request:
$ARGUMENTS

Rules:
- If the request is empty, ask the user what Cursor should do.
- Remove `--background` from the request. If it was there, run the subagent in the background. Otherwise run it in the foreground.
- Pass everything else, including `--model`, `--read-only` and `--resume`, to the subagent unchanged.
- If the subagent answers with a list of matching models instead of a result, ask the user to pick one with `AskUserQuestion` (at most four options, the closest match first), then run the subagent again with `--model <chosen id>`.
- Show the subagent's output to the user as it is. Do not summarize it.
