#!/usr/bin/env bash
# Разворачивает ~/.tg-agent-bot: папки, mtcute, config.json.
# Значения спрашиваются интерактивно. Для неинтерактивного запуска можно
# передать их через окружение: TG_BOT_TOKEN, TG_API_HASH, TG_API_ID.
# Ничего не печатает на экран, кроме подсказок и итогового статуса.
set -euo pipefail

ROOT="$HOME/.tg-agent-bot"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Публично известная пара Telegram Desktop. Это идентификатор приложения, а не
# секрет аккаунта: бот в любом случае авторизуется собственным токеном, и на его
# права эта пара не влияет. Зашита, чтобы разворачивание на свежей машине не
# требовало искать значения вручную. Своё приложение регистрируется на
# https://my.telegram.org/apps и передаётся через TG_API_ID / TG_API_HASH.
API_ID_DEFAULT=2040
API_HASH_DEFAULT='b18441a1ff607e10a989891a5462e627'

mkdir -p "$ROOT/scratch" "$ROOT/session" "$ROOT/lib"
cd "$ROOT"

[ -f package.json ] || echo '{"name":"tg-agent-bot","private":true,"type":"module"}' >package.json
[ -d node_modules/@mtcute/bun ] || bun add @mtcute/bun
[ -x node_modules/.bin/tsc ] && [ -d node_modules/@types/bun ] || bun add --dev typescript @types/bun

# lib перезаписывается всегда: это код скилла, а не данные пользователя,
# и повторный запуск должен обновлять его до версии скилла.
cp "$HERE/lib/bot.ts" "$ROOT/lib/bot.ts"

# Справочник адресатов - данные пользователя, поэтому только создаём пустым.
[ -f known_peers.json ] || echo '{}' >known_peers.json

if [ -f config.json ]; then
  echo "lib обновлён. config.json уже есть — не трогаю, удали его, чтобы пересоздать."
  exit 0
fi

ask_secret() { # $1 - имя env-переменной, $2 - текст подсказки
  local name="$1" text="$2" val="${!1:-}"
  if [ -z "$val" ]; then
    if [ ! -e /dev/tty ]; then
      echo "нет $name в окружении и нет терминала для ввода" >&2
      exit 1
    fi
    printf '%s' "$text" >&2
    read -r -s val </dev/tty
    printf '\n' >&2
  fi
  [ -n "$val" ] || {
    echo "пустое значение" >&2
    exit 1
  }
  printf '%s' "$val"
}

API_ID="${TG_API_ID:-$API_ID_DEFAULT}"
API_HASH="${TG_API_HASH:-$API_HASH_DEFAULT}"
BOT_TOKEN="$(ask_secret TG_BOT_TOKEN 'bot token (от @BotFather): ')"

umask 077
printf '{"apiId":%s,"apiHash":"%s","botToken":"%s"}\n' "$API_ID" "$API_HASH" "$BOT_TOKEN" >config.json
chmod 600 config.json

echo "готово: $ROOT"
