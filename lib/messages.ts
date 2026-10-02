import { getMarkedPeerId, type InputPeerLike, type TelegramClient, type tl } from '@mtcute/bun'
import { readUpdates, type UpdateGap, type UpdatePage } from './updates'

export type HistoryMessage = tl.RawMessage | tl.RawMessageService
export type HistoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: UpdateGap | { code: 'history.bound_unavailable'; context: { response: string } } }
export type ChatHistory = { messages: HistoryMessage[]; lastMessageId: number | null }
type ResolvedPeer = tl.RawInputPeerUser | tl.RawInputPeerChat | tl.RawInputPeerChannel

function concretePeer(peer: tl.TypeInputPeer): ResolvedPeer {
  if (peer._ !== 'inputPeerUser' && peer._ !== 'inputPeerChat' && peer._ !== 'inputPeerChannel') {
    throw new Error(`Expected a concrete user, basic group or channel; got ${peer._}`)
  }
  return peer
}

export function channelLastMessageId(diff: tl.updates.TypeChannelDifference): HistoryResult<number | null> {
  if (diff._ !== 'updates.channelDifferenceTooLong' || diff.dialog._ !== 'dialog') {
    return { ok: false, error: { code: 'history.bound_unavailable', context: { response: diff._ } } }
  }
  return { ok: true, value: diff.dialog.topMessage || null }
}

export async function getChannelLastMessageId(tg: TelegramClient, chat: InputPeerLike): Promise<HistoryResult<number | null>> {
  const channel = await tg.resolveChannel(chat)
  const diff = await tg.call({
    _: 'updates.getChannelDifference', channel, pts: 1, limit: 1,
    filter: { _: 'channelMessagesFilterEmpty' },
  }, { timeout: 30_000 })
  return channelLastMessageId(diff)
}

export function commonMessagesFromUpdates(pages: readonly UpdatePage[]): HistoryMessage[] {
  const messages = new Map<number, HistoryMessage>()
  const put = (message: tl.TypeMessage) => {
    if (message._ !== 'messageEmpty' && message.peerId._ !== 'peerChannel') messages.set(message.id, message)
  }
  for (const page of pages) {
    for (const message of page.newMessages) put(message)
    for (const update of page.otherUpdates) {
      if (update._ === 'updateEditMessage') put(update.message)
      if (update._ === 'updateDeleteMessages') for (const id of update.messages) messages.delete(id)
    }
  }
  return [...messages.values()].sort((a, b) => a.id - b.id)
}

export async function readCommonHistory(tg: Pick<TelegramClient, 'call'>): Promise<HistoryResult<HistoryMessage[]>> {
  const state = await tg.call({ _: 'updates.getState' }, { timeout: 30_000 })
  const result = await readUpdates(tg, { pts: 1, qts: state.qts, date: 1 })
  if (!result.ok) return result
  return { ok: true, value: commonMessagesFromUpdates(result.value.pages) }
}

export async function collectMessageRange(
  fetchIds: (ids: number[]) => Promise<tl.TypeMessage[]>,
  peerId: number,
  range: { minId: number; maxId: number },
): Promise<HistoryMessage[]> {
  const { minId, maxId } = range
  if (!Number.isInteger(minId) || !Number.isInteger(maxId) || minId < 1 || maxId < minId || maxId > 2_147_483_647) {
    throw new RangeError('Expected 1 <= minId <= maxId <= 2147483647')
  }
  const messages: HistoryMessage[] = []
  for (let start = minId; start <= maxId; start += 100) {
    const ids = Array.from({ length: Math.min(100, maxId - start + 1) }, (_, i) => start + i)
    const batch = await fetchIds(ids)
    for (const message of batch) {
      if (message._ !== 'messageEmpty' && getMarkedPeerId(message.peerId) === peerId && message.id >= start && message.id <= ids[ids.length - 1]) {
        messages.push(message)
      }
    }
  }
  return messages.sort((a, b) => a.id - b.id)
}

export async function readMessageRange(
  tg: TelegramClient,
  chat: InputPeerLike,
  range: { minId: number; maxId: number },
): Promise<HistoryMessage[]> {
  const peer = concretePeer(await tg.resolvePeer(chat))
  return collectMessageRange(async ids => {
    const id: tl.TypeInputMessage[] = ids.map(id => ({ _: 'inputMessageID', id }))
    const result = await tg.call(peer._ === 'inputPeerChannel'
      ? { _: 'channels.getMessages', channel: { _: 'inputChannel', channelId: peer.channelId, accessHash: peer.accessHash }, id }
      : { _: 'messages.getMessages', id }, { timeout: 30_000 })
    if (result._ === 'messages.messagesNotModified') throw new Error('Unexpected messagesNotModified when reading IDs')
    return result.messages
  }, getMarkedPeerId(peer), range)
}

export async function readChatHistory(tg: TelegramClient, chat: InputPeerLike): Promise<HistoryResult<ChatHistory>> {
  const peer = concretePeer(await tg.resolvePeer(chat))
  if (peer._ === 'inputPeerChannel') {
    const bound = await getChannelLastMessageId(tg, peer)
    if (!bound.ok) return bound
    const messages = bound.value === null ? [] : await readMessageRange(tg, peer, { minId: 1, maxId: bound.value })
    return { ok: true, value: { messages, lastMessageId: messages.at(-1)?.id ?? null } }
  }
  const result = await readCommonHistory(tg)
  if (!result.ok) return result
  const peerId = getMarkedPeerId(peer)
  const messages = result.value.filter(message => getMarkedPeerId(message.peerId) === peerId)
  return { ok: true, value: { messages, lastMessageId: messages.at(-1)?.id ?? null } }
}
