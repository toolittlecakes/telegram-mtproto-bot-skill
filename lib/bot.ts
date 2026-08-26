import { TelegramClient } from '@mtcute/bun'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

export const ROOT = `${homedir()}/.tg-agent-bot`

/**
 * Открывает клиент, отдаёт его в fn, гарантированно закрывает.
 * Поверх API не надстраивает ничего: fn получает сырой TelegramClient,
 * доступны все 326 методов. Модуль снимает только неизменную церемонию
 * жизненного цикла - её забытый destroy вешает процесс и лочит сессию.
 */
export async function withBot<T>(fn: (tg: TelegramClient) => Promise<T>): Promise<T> {
  const cfg = JSON.parse(readFileSync(`${ROOT}/config.json`, 'utf8'))
  const tg = new TelegramClient({
    apiId: cfg.apiId,
    apiHash: cfg.apiHash,
    storage: `${ROOT}/session/bot`,
  })
  try {
    await tg.start({ botToken: cfg.botToken })
    return await fn(tg)
  } finally {
    await tg.destroy()
  }
}
