# telegram-mtproto-bot skill

Agent skill for acting as a Telegram bot over MTProto ([mtcute](https://mtcute.dev)) via one-off TypeScript scripts: send/edit/delete messages, read updates and incoming `/start`s, reactions, pins, chat members, full user/chat/channel info, media upload/download, channel administration, forum topics, stickers, payments, and raw TL methods.

Works with any agent harness that supports the [Agent Skills](https://agentskills.io) format (Claude Code, Codex, OpenCode, etc.). Skill instructions are in Russian; the agent handles them regardless of your conversation language.

## Install

```bash
git clone https://github.com/toolittlecakes/telegram-mtproto-bot-skill.git ~/.claude/skills/telegram-mtproto-bot
```

Requires [Bun](https://bun.sh). On first use the skill bootstraps its own working directory and asks for a bot token from [@BotFather](https://t.me/BotFather); credentials stay in a local config outside the repo and are never printed.

## Contributing

PRs welcome — this repo is the source of truth for the skill.
