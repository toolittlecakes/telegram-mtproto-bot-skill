#!/usr/bin/env bash
set -euo pipefail

ROOT="${TG_AGENT_BOT_ROOT:-$HOME/.tg-agent-bot}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/tg-bot-tests.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
cp -R "$HERE/lib" "$HERE/tests" "$test_root/"
ln -s "$ROOT/node_modules" "$test_root/node_modules"
TG_AGENT_BOT_ROOT="$test_root" bash "$HERE/scripts/typecheck.sh" tests/modules.test.ts
bun test --cwd "$test_root" --no-install tests/modules.test.ts
