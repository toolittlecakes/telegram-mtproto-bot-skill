# История и последний ID

`lib/messages.ts` содержит алгоритмы чтения. Он не отправляет сообщения, не создаёт черновики, не открывает сессию и не завершает процесс. Возвращает raw TL `message` / `messageService`, отсортированные по ID; у обычного сообщения текст в `message`, у служебного — `action`. Это не high-level `Message` из `tg.getMessages`.

## Выбор операции

| Операция | Функция |
| --- | --- |
| Прочитать доступную историю одного чата и найти последнее сообщение | `readChatHistory(tg, chat)` |
| Узнать верхнюю границу канала/супергруппы без выгрузки истории | `getChannelLastMessageId(tg, chat)` |
| Прочитать общий журнал личек и обычных групп один раз для нескольких чатов | `readCommonHistory(tg)` |
| Прочитать известный включительный диапазон ID, пропуская дырки | `readMessageRange(tg, chat, { minId, maxId })` |

`readChatHistory` возвращает `{ ok: true, value: { messages, lastMessageId } }` или `{ ok: false, error: { code, context } }`. `lastMessageId: null` означает отсутствие сообщений в успешно прочитанной истории. Это ID последнего доступного сообщения, включая служебные, а не последний когда-либо выделенный ID и не следующий ID. Ошибка не заменяется пустой историей.

`getChannelLastMessageId` возвращает такой же Result с `value: number | null`; `readCommonHistory` — с `value: HistoryMessage[]`. `readMessageRange` возвращает массив и обещает только чтение заданного диапазона. Для фильтрации raw-сообщений по чату использовать `getMarkedPeerId(message.peerId)` из `@mtcute/bun`.

## Каналы и супергруппы

У каждого собственная последовательность ID. `getChannelLastMessageId` вызывает `updates.getChannelDifference` с `pts: 1` и берёт `dialog.topMessage` только из `updates.channelDifferenceTooLong`. Проверено чтением на канале и супергруппе. Другие варианты ответа дают `history.bound_unavailable`: ни `pts`, ни максимум случайной пачки сообщений не считаются подтверждённой границей. Этот исход не запускает скрытый запасной поиск.

`readChatHistory` затем читает `1…topMessage` пачками по 100 через `channels.getMessages`. Удалённые/недоступные ID пропускаются, пустая пачка не останавливает чтение. Стоимость пропорциональна диапазону ID, а не числу сохранившихся сообщений. Для больших каналов сначала получить границу и выбрать необходимый диапазон вместе с пользователем, если полный перебор окажется большим.

## Лички и обычные группы

Они используют общую последовательность ID аккаунта бота. Один ID может принадлежать личке, следующий — другой личке или обычной группе. Чтение диапазона обязательно фильтрует сообщения по `peerId`.

`readCommonHistory` читает общий `updates.getDifference` от `pts: 1, date: 1` до финального ответа; `qts` берётся текущий, поскольку вторичная очередь бота не является архивом обычных сообщений. Обрабатываются новые сообщения, правки и удаления по порядку страниц; канальные и business-сообщения в общий архив не включаются. `readChatHistory` выбирает из результата нужный чат и его последний ID. При нескольких чатах читать общий журнал один раз, затем фильтровать массив.

Журнал событий ограничен сервером. Если получен `updates.differenceTooLong`, возвращается `history.update_gap`, накопленные страницы не выдаются за полный архив. В этом ответе есть только `pts`, без последнего ID сообщения. `pts` — счётчик событий, его нельзя использовать как message ID. Полноту старой истории при таком исходе этот алгоритм не подтверждает; автоматического переключения на бинарный поиск или кеш нет.

`messages.getPeerDialogs` и `messages.getHistory` недоступны ботам (`BOT_METHOD_INVALID`); `getFullChat` обычной группы последнего ID не содержит. Черновик также не даёт границу: `messages.saveDraft` доступен пользователям, возвращает Bool и не выдаёт ID сообщения.

## Пример одноразового скрипта

```bash
TG_CHAT='@example_channel' bun run --cwd "$HOME/.tg-agent-bot" --no-install - <<'TS'
import { withBot } from './lib/bot.ts'
import { writeOutput } from './lib/output.ts'
import { readChatHistory } from './lib/messages.ts'

const chat = process.env.TG_CHAT
if (!chat) throw new Error('TG_CHAT is required')

await withBot(async tg => {
  const result = await readChatHistory(tg, chat)
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  await writeOutput(JSON.stringify(result.value) + '\n')
})

process.exit(0)
TS
```

Вместо строки можно передать числовой ID из `known_peers.json`. Не смешивать ID аккаунта пользователя и бота для личек/обычных групп. Мигрировавшая группа и новая супергруппа — отдельные истории; модуль не объединяет их неявно.

RPC-ошибки и таймауты пробрасываются наружу. Каждый raw-запрос ограничен 30 секундами; модули не добавляют собственных ретраев поверх mtcute. Застрявшая пагинация даёт явную ошибку. Всё чтение выполняется последовательно. История собирается в памяти; многозапросное чтение не является атомарным снимком — сообщения могут удаляться и появляться в процессе. Успех относится к доступной боту истории, а не к сообщениям, скрытым правами/privacy mode. Независимый счётчик или перечитку найденных сообщений использовать, когда они доступны.

## Источники и проверка

Схему и сигнатуры проверять по установленному mtcute. Семантика: [последовательности ID и восстановление журнала](https://core.telegram.org/api/updates), [getChannelDifference](https://core.telegram.org/method/updates.getChannelDifference), [channelDifferenceTooLong](https://core.telegram.org/constructor/updates.channelDifferenceTooLong), [getDifference](https://core.telegram.org/method/updates.getDifference), [differenceTooLong](https://core.telegram.org/constructor/updates.differenceTooLong).

`bash "$SKILL_DIR/scripts/test.sh"` проверяет типы и офлайн-сценарии с дырками, чужими чатами, пагинацией, правками, удалениями, потерей журнала и записью вывода. Тесты используют временную SQLite и установленные зависимости, не подключаются к Telegram и не читают реальные учётные данные.
