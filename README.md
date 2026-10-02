# telegram-mtproto-bot skill

Agent skill for acting as a Telegram bot over MTProto ([mtcute](https://mtcute.dev)) via one-off TypeScript scripts: send/edit/delete messages, read updates and incoming `/start`s, read available history, reactions, pins, chat members, full user/chat/channel info, media upload/download, channel administration, forum topics, stickers, payments, and raw TL methods.

Uses the [Agent Skills format](https://agentskills.io/specification). Requires an agent that can read local skill files and run shell commands. Instructions are in Russian; you can talk to the agent in another language.

## Requirements

- [Bun](https://bun.sh/docs/installation), Bash, and Git on the machine where the agent runs. The shell workflow targets macOS/Linux; on Windows use a Linux environment such as WSL.
- Network access to GitHub, the package registry, and Telegram.
- A Telegram bot token from [@BotFather](https://t.me/BotFather), needed during bot setup, not skill installation.

## Install the skill

With the [skills CLI](https://github.com/vercel-labs/skills):

```bash
bunx --bun skills add toolittlecakes/telegram-mtproto-bot-skill --skill telegram-mtproto-bot --global
```

Select the agents to install for, or specify them with `--agent codex claude-code` (choose the agents you use). `--global` installs for your user across projects; omit it to install only in the current project. The installer handles the agent-specific paths. Use your agent's skill reload mechanism or start a new session if the skill is not visible yet.

Check the installation:

```bash
bunx --bun skills list --global
```

The repository contains one skill at its root. Install the **whole directory**, including `bootstrap.sh`, `lib/`, `scripts/`, and `references/`; copying only `SKILL.md` is insufficient. If using another installer, give it the repository URL and select the root skill named `telegram-mtproto-bot`.

For a manual Git installation, clone the repository into a folder named `telegram-mtproto-bot` inside your agent's skill directory. Personal directories include [`~/.agents/skills` for Codex](https://developers.openai.com/codex/skills) and [`~/.claude/skills` for Claude Code](https://code.claude.com/docs/en/skills). Avoid installing a second copy if the skill is already managed by an installer.

## Set up the bot

After installation, ask the agent to use `telegram-mtproto-bot` and run its bootstrap. Alternatively, run this in your own terminal, replacing `<installed-skill-dir>` with the directory containing the installed `SKILL.md`:

```bash
bash "<installed-skill-dir>/bootstrap.sh"
```

Bootstrap creates `~/.tg-agent-bot`, installs missing mtcute/type-check dependencies, and copies the bundled `lib/*.ts` modules there. On first setup it prompts for the bot token with hidden terminal input. The default Telegram application ID/hash are supplied; your own `TG_API_ID` and `TG_API_HASH` are optional. For non-interactive setup, supply `TG_BOT_TOKEN` through the process environment from your secret manager, not in a prompt or a command containing its literal value.

Credentials, session files, and the address book stay in `~/.tg-agent-bot`, outside the installed skill. Re-running bootstrap refreshes the bundled modules while preserving existing config, sessions, and the address book; installed dependency versions are not automatically upgraded. The runtime currently uses one bot configuration and one shared session per home directory. Do not run bot scripts concurrently.

The [skill instructions](SKILL.md) cover script execution and verification. [History documentation](references/history.md) explains the reusable modules and limits on retrieving messages.

## Update

For an installation managed by the skills CLI:

```bash
bunx --bun skills update telegram-mtproto-bot --global
```

For a project installation, run the command from that project and replace `--global` with `--project`. For a manual Git clone, use `git -C "<installed-skill-dir>" pull --ff-only` instead; use the update mechanism belonging to your installation.

After updating, re-run `bash "<installed-skill-dir>/bootstrap.sh"` to refresh the runtime modules, then reload the skill in your agent. Updating the installed skill alone does not update the copied modules in `~/.tg-agent-bot/lib`.

## Contributing

PRs welcome — this repo is the source of truth for the skill. With bot runtime dependencies installed, run `bash scripts/test.sh` for type-checking and offline tests. The tests do not connect to Telegram or read real credentials.
