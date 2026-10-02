import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import type { tl } from '@mtcute/bun'
import '../lib/bot'
import { writeOutput } from '../lib/output'
import { collectUpdatePages, readUpdateCursor, type UpdateCursor, type UpdatePage } from '../lib/updates'
import { channelLastMessageId, collectMessageRange, commonMessagesFromUpdates } from '../lib/messages'

const user: tl.TypePeer = { _: 'peerUser', userId: 42 }
const group: tl.TypePeer = { _: 'peerChat', chatId: 99 }
const initial: UpdateCursor = { pts: 1, qts: 10, date: 1 }
const state = (pts: number): tl.updates.RawState => ({ _: 'updates.state', pts, qts: 10, date: 2, seq: 1, unreadCount: 0 })
const message = (id: number, peerId: tl.TypePeer = user): tl.RawMessage => ({ _: 'message', id, peerId, date: 1, message: `message ${id}` })
const page = (pts: number, newMessages: tl.TypeMessage[] = [], otherUpdates: tl.TypeUpdate[] = []): tl.updates.RawDifferenceSlice => ({
  _: 'updates.differenceSlice', newMessages, newEncryptedMessages: [], otherUpdates, users: [], chats: [], intermediateState: state(pts),
})
const finalPage = (pts: number): tl.updates.RawDifference => ({
  _: 'updates.difference', newMessages: [], newEncryptedMessages: [], otherUpdates: [], users: [], chats: [], state: state(pts),
})

test('pagination follows returned cursors until final, without mutating the initial cursor', async () => {
  const seen: UpdateCursor[] = []
  const pages: tl.updates.TypeDifference[] = [page(10), page(20), finalPage(30)]
  const result = await collectUpdatePages(async cursor => {
    seen.push(cursor)
    const next = pages.shift()
    if (!next) throw new Error('unexpected request after final')
    return next
  }, initial)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.code)
  expect(result.value.pages).toHaveLength(3)
  expect(result.value.cursor.pts).toBe(30)
  expect(seen.map(c => c.pts)).toEqual([1, 10, 20])
  expect(initial.pts).toBe(1)
})

test('a history gap discards accumulated pages instead of claiming a partial archive is complete', async () => {
  let count = 0
  const result = await collectUpdatePages(async () => ++count === 1 ? page(10, [message(1)]) : { _: 'updates.differenceTooLong', pts: 500 }, initial)
  expect(result).toEqual({ ok: false, error: { code: 'history.update_gap', context: { pts: 500 } } })
})

test('empty difference finishes and preserves pts/qts', async () => {
  const result = await collectUpdatePages(async () => ({ _: 'updates.differenceEmpty', date: 50, seq: 1 }), initial)
  expect(result).toEqual({ ok: true, value: { pages: [], cursor: { ...initial, date: 50 } } })
})

test('pagination refuses a stuck cursor and propagates transport failure', async () => {
  await expect(collectUpdatePages(async () => ({ ...page(1), intermediateState: { ...state(1), date: 1 } }), initial)).rejects.toThrow('did not advance')
  await expect(collectUpdatePages(async () => { throw new Error('transport timeout') }, initial)).rejects.toThrow('transport timeout')
})

test('common history applies edits and later deletes, preserves service messages, excludes channels', () => {
  const service: tl.RawMessageService = { _: 'messageService', id: 8, peerId: group, date: 1, action: { _: 'messageActionEmpty' } }
  const pages: UpdatePage[] = [
    page(10, [message(1), message(2), message(4, group), service, message(99, { _: 'peerChannel', channelId: 9 })]),
    page(20, [message(12)], [{ _: 'updateEditMessage', message: { ...message(2), message: 'edited' }, pts: 15, ptsCount: 1 }]),
    page(30, [], [{ _: 'updateDeleteMessages', messages: [1, 12], pts: 30, ptsCount: 2 }]),
  ]
  const result = commonMessagesFromUpdates(pages)
  expect(result.map(m => m.id)).toEqual([2, 4, 8])
  expect(result[0]).toMatchObject({ message: 'edited' })
  expect(result[2]._).toBe('messageService')
})

test('range scan crosses holes and empty batches, never leaks another chat', async () => {
  const requested: number[][] = []
  const result = await collectMessageRange(async ids => {
    requested.push(ids)
    return ids.map(id => id === 205 ? message(id) : id === 3 ? message(id, group) : { _: 'messageEmpty', id })
  }, 42, { minId: 1, maxId: 205 })
  expect(requested.map(ids => ids.length)).toEqual([100, 100, 5])
  expect(result.map(m => m.id)).toEqual([205])
})

test('range validation happens before any request', async () => {
  let calls = 0
  for (const range of [{ minId: 0, maxId: 2 }, { minId: 5, maxId: 4 }, { minId: 1, maxId: 2.5 }]) {
    await expect(collectMessageRange(async () => { calls++; return [] }, 42, range)).rejects.toThrow(RangeError)
  }
  expect(calls).toBe(0)
})

const channelSnapshot = (id: number): tl.updates.RawChannelDifferenceTooLong => ({
  _: 'updates.channelDifferenceTooLong', final: true, messages: [], chats: [], users: [],
  dialog: { _: 'dialog', peer: { _: 'peerChannel', channelId: 9 }, topMessage: id, readInboxMaxId: 0, readOutboxMaxId: 0, unreadCount: 0, unreadMentionsCount: 0, unreadReactionsCount: 0, unreadPollVotesCount: 0, notifySettings: { _: 'peerNotifySettings' } },
})

test('channel boundary comes only from dialog, never pts or a partial message sample', () => {
  expect(channelLastMessageId(channelSnapshot(577))).toEqual({ ok: true, value: 577 })
  expect(channelLastMessageId(channelSnapshot(0))).toEqual({ ok: true, value: null })
  const diff: tl.updates.RawChannelDifference = { _: 'updates.channelDifference', final: true, pts: 900, newMessages: [message(100)], otherUpdates: [], chats: [], users: [] }
  expect(channelLastMessageId(diff)).toMatchObject({ ok: false, error: { code: 'history.bound_unavailable' } })
  expect(channelLastMessageId({ _: 'updates.channelDifferenceEmpty', pts: 900, final: true }).ok).toBe(false)
})

test('cursor is a snapshot of SQLite state, missing state fails explicitly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-cursor-'))
  const path = join(dir, 'session')
  const db = new Database(path)
  try {
    db.run('create table key_value (key text primary key, value blob)')
    for (const [key, number] of Object.entries(initial)) {
      const value = Buffer.alloc(4)
      value.writeInt32LE(number)
      db.run('insert into key_value values (?, ?)', [`updates_${key}`, value])
    }
    const snapshot = readUpdateCursor(path)
    db.run("delete from key_value where key = 'updates_pts'")
    expect(snapshot).toEqual(initial)
    expect(() => readUpdateCursor(path)).toThrow('Missing or invalid update cursor')
  } finally {
    db.close()
    rmSync(dir, { recursive: true })
  }
})

test('output resolves only after the actual write callback', async () => {
  let complete: (() => void) | undefined
  let captured = ''
  const stream = new Writable({ write(chunk, _encoding, callback) { captured += chunk.toString(); complete = callback } })
  let done = false
  const writing = writeOutput('payload', stream).then(() => { done = true })
  await Promise.resolve()
  expect(done).toBe(false)
  expect(captured).toBe('payload')
  if (!complete) throw new Error('write was not started')
  complete()
  await writing
  expect(done).toBe(true)
})

test('output rejects failed writes', async () => {
  const stream = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('broken pipe')) } })
  stream.on('error', () => {})
  await expect(writeOutput('payload', stream)).rejects.toThrow('broken pipe')
})
