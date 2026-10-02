import { Database } from 'bun:sqlite'
import type { TelegramClient, tl } from '@mtcute/bun'

export type UpdateCursor = { pts: number; qts: number; date: number }
export type UpdatePage = tl.updates.RawDifference | tl.updates.RawDifferenceSlice
export type UpdateGap = { code: 'history.update_gap'; context: { pts: number } }
export type UpdateReadResult =
  | { ok: true; value: { pages: UpdatePage[]; cursor: UpdateCursor } }
  | { ok: false; error: UpdateGap }

export function readUpdateCursor(sessionPath: string): UpdateCursor {
  const db = new Database(sessionPath, { readonly: true })
  try {
    const query = db.query<{ value: Uint8Array }, [string]>('select value from key_value where key = ?')
    const read = (key: string): number => {
      const row = query.get(key)
      if (!row || !(row.value instanceof Uint8Array) || row.value.byteLength !== 4) {
        throw new Error(`Missing or invalid update cursor: ${key}`)
      }
      return Buffer.from(row.value).readInt32LE()
    }
    return { pts: read('updates_pts'), qts: read('updates_qts'), date: read('updates_date') }
  } finally {
    db.close()
  }
}

export async function collectUpdatePages(
  fetchPage: (cursor: UpdateCursor) => Promise<tl.updates.TypeDifference>,
  initial: UpdateCursor,
): Promise<UpdateReadResult> {
  const pages: UpdatePage[] = []
  let cursor = { ...initial }
  for (;;) {
    const page = await fetchPage(cursor)
    if (page._ === 'updates.differenceTooLong') {
      return { ok: false, error: { code: 'history.update_gap', context: { pts: page.pts } } }
    }
    if (page._ === 'updates.differenceEmpty') {
      return { ok: true, value: { pages, cursor: { ...cursor, date: page.date } } }
    }
    pages.push(page)
    const state = page._ === 'updates.difference' ? page.state : page.intermediateState
    const next = { pts: state.pts, qts: state.qts, date: state.date }
    if (page._ === 'updates.difference') return { ok: true, value: { pages, cursor: next } }
    if (next.pts < cursor.pts || next.qts < cursor.qts || (next.pts === cursor.pts && next.qts === cursor.qts && next.date <= cursor.date)) {
      throw new Error('Telegram update pagination did not advance')
    }
    cursor = next
  }
}

export function readUpdates(tg: Pick<TelegramClient, 'call'>, cursor: UpdateCursor): Promise<UpdateReadResult> {
  return collectUpdatePages(
    next => tg.call({ _: 'updates.getDifference', ...next }, { timeout: 30_000 }),
    cursor,
  )
}
