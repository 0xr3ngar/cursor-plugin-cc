# cursor-plugin-cc

Use Cursor as a subagent in Claude Code. Claude plans the work, Cursor writes the code, and Claude checks the result.

Based on [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc).

> [!WARNING]
> I made this for myself with a few Claude Code prompts. I've only tested it on macOS. Read the code before you use it.

## Install

You need Node 22.6 or later and the Cursor CLI, logged in.

```
/plugin marketplace add 0xr3ngar/cursor-plugin-cc
/plugin install cursor@cursor-plugin-cc
/cursor:setup
```

## Commands

| Command | What it does |
| --- | --- |
| `/cursor:rescue <task>` | Gives the task to Cursor |
| `/cursor:review` | Cursor reviews your changes |
| `/cursor:adversarial-review [focus]` | Cursor looks for reasons not to ship |
| `/cursor:models [words]` | Lists the models you can use |
| `/cursor:status`, `/cursor:result`, `/cursor:cancel` | Manage running jobs |

Useful flags:

- `--model <name>` picks the model. Loose names like "opus" work. The default is `auto`.
  `cursor-agent models` leaves out some models, such as `glm-5p3-flash`. Pass those as an exact id.
- `--read-only` stops Cursor from editing files.
- `--resume` continues the last Cursor task.
- `--base <branch>` reviews your branch instead of uncommitted changes.
- `--background` runs the command without blocking Claude.

You can also ask in plain words, like "have Cursor add a subtract function, then check it".

## Development

```
npm install
npm run typecheck
npm test
```

The tests use a fake `cursor-agent`, so you don't need a Cursor account to run them.

## License

MIT
