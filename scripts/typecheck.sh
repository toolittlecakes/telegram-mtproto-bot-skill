#!/usr/bin/env bash
set -euo pipefail

ROOT="${TG_AGENT_BOT_ROOT:-$HOME/.tg-agent-bot}"
TSC="$ROOT/node_modules/.bin/tsc"

if [ ! -x "$TSC" ] || [ ! -d "$ROOT/node_modules/@types/bun" ]; then
  echo 'type-check dependencies are missing; rerun the skill bootstrap' >&2
  exit 1
fi

temporary=''
cleanup() {
  if [ -n "$temporary" ]; then
    rm -f "$temporary"
  fi
}
trap cleanup EXIT

if [ "${1:-}" = '--probe-message-api' ]; then
  [ "$#" -eq 1 ] || {
    echo 'usage: typecheck.sh --probe-message-api | <scratch-script.ts>' >&2
    exit 2
  }
  temporary="$(mktemp "$ROOT/scratch/typecheck-message-api.XXXXXX.ts")"
  printf '%s\n' \
    "import type { Message } from '@mtcute/bun'" \
    'declare const message: Message' \
    'const outgoing: boolean = message.isOutgoing' \
    "type HasObsoleteOutgoing = 'outgoing' extends keyof Message ? true : false" \
    'const hasObsoleteOutgoing: HasObsoleteOutgoing = false' \
    'void outgoing' \
    'void hasObsoleteOutgoing' >"$temporary"
  source_path="$temporary"
else
  [ "$#" -eq 1 ] || {
    echo 'usage: typecheck.sh --probe-message-api | <scratch-script.ts>' >&2
    exit 2
  }
  source_path="$1"
  if [[ "$source_path" != /* ]]; then
    source_path="$ROOT/$source_path"
  fi
  [ -f "$source_path" ] || {
    echo "TypeScript file not found: $source_path" >&2
    exit 1
  }
fi

cd "$ROOT"
"$TSC" \
  --noEmit \
  --strict \
  --target ESNext \
  --module Preserve \
  --moduleResolution Bundler \
  --allowImportingTsExtensions \
  --skipLibCheck \
  --types bun \
  "$source_path"
