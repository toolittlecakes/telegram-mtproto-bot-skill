---
name: telegram-mtproto-bot
description: Действия Telegram-ботом через MTProto (mtcute) одноразовыми TypeScript-скриптами. Использовать для любой работы ботом - отправить, отредактировать, удалить сообщение, проверить новые апдейты и входящие /start, реакции, пины, прочитать сообщения включая старые и всю историю чата (запрет getHistory для ботов обходится перебором ID - рецепт внутри), участников чата, полные данные о юзере/чате/канале, загрузить или скачать медиа из любых доступных сообщений, администрировать каналы, работать с форум-топиками, стикерами, платежами и raw TL-методами. Это единый путь для действий ботом, отдельного CLI нет.
---

# Telegram bot через MTProto

Инструмент - не CLI, а папка `~/.tg-agent-bot` с установленной библиотекой. Каждая задача решается одноразовым скриптом в `scratch/`, который запускается из этой папки. Библиотека там же служит источником документации по API.

## 1. Bootstrap

Если папки `~/.tg-agent-bot` нет или в ней не установлен mtcute - запустить скрипт, лежащий рядом с этим файлом:

```bash
bash "$SKILL_DIR/bootstrap.sh"
```

`$SKILL_DIR` - директория, из которой прочитан этот SKILL.md. Если переменная не подставлена окружением, взять путь того файла, который читался, и не хардкодить абсолютный - скилл может быть установлен в разные места.

Скрипт создаёт папку, ставит `@mtcute/bun` и инструменты проверки типов, раскладывает `lib/` и собирает `config.json`, спрашивая bot token с клавиатуры. Идемпотентен: существующий `config.json` не трогает, установленные пакеты не переставляет. `lib/` при этом перезаписывается всегда - это код скилла, а не данные, и повторный запуск обновляет его. Проверка готовности идёт по реальным файлам пакетов, а не по наличию папки - иначе полусобранное состояние считалось бы готовым.

Спрашивается только токен: бот может быть любым, зашивать конкретный нельзя. Для неинтерактивного запуска значения передаются окружением - `TG_BOT_TOKEN`, `TG_API_HASH`, `TG_API_ID`.

`api_id` и `api_hash` по умолчанию - публично известная пара Telegram Desktop, зашитая в скрипт. Это идентификатор приложения, а не секрет аккаунта, и на права бота он не влияет. Своё приложение регистрируется на https://my.telegram.org/apps; смена `api_id` создаёт новую auth-сессию, поэтому старый `session/bot` придётся удалить.

Никогда не печатать содержимое `config.json`, токен, `apiHash` и файлы сессии. Сессия содержит MTProto auth key и равна по чувствительности токену.

**`known_peers.json` - справочник адресатов.** Переводит человеческие формулировки в пиры: «отправь мне», «в рабочий чат», «в канал по проекту X». Без него такую просьбу выполнить нельзя - выяснять ID у пользователя каждый раз глупо, а угадывать нельзя тем более.

```json
{
  "me": {
    "peer": 373021550,
    "kind": "private",
    "title": "Nikolay Sheyko",
    "access": "write",
    "note": "личка. «отправь мне», «напиши мне», «скинь в личку»",
    "checked": "2026-08-17"
  }
}
```

`peer` подставляется в методы как есть. `access` - `write` или `read`: у бота может не быть прав на публикацию, и это надо знать до отправки, а не из ошибки. `note` описывает, по каким формулировкам сюда попадают. `checked` - когда запись последний раз сверялась с сервером: пиры мигрируют молча (см. раздел 6), так что старая дата - повод перепроверить, а не доверять.

Порядок работы: сопоставить просьбу с `note`, взять `peer`, свериться с `access`. Если подходящей записи нет - спросить пользователя и дописать её, а не подставлять первое похожее.

Хранить `peer` лучше в форме `@username`, если он есть: имена переживают миграцию чата, числовые ID - нет. Файл создаётся bootstrap'ом пустым и им не перезаписывается: это данные, а не код. Секретов в нём нет, но и печатать целиком незачем.

## 2. Как писать скрипт

Церемонию жизненного цикла - чтение конфига, конструктор, `start`, `destroy` - берёт на себя `~/.tg-agent-bot/lib/bot.ts`, который раскладывает bootstrap. Единственный экспорт `withBot` отдаёт в колбэк сырой `TelegramClient`: доступны все методы, никаких обёрток поверх API нет и заводить их не нужно.

Разовая задача пишется прямо в heredoc, без файла:

```bash
MTCUTE_LOG_LEVEL=1 bun run - <<TS
import { withBot } from '$HOME/.tg-agent-bot/lib/bot.ts'

await withBot(async tg => {
  const m = await tg.sendText({ _: 'inputPeerChat', chatId: 5127221342 }, 'текст')
  console.log('sent', m.id)
})
TS
```

Делимитер `TS` **не в кавычках** - иначе `$HOME` не подставится и импорт не разрешится. Обратная сторона: шелл лезет и в остальной текст, поэтому шаблонные строки TypeScript (`${...}`) надо экранировать как `\${...}`. Экранировать сам `$HOME` при этом нельзя - импорт сломается. Если шаблонных строк много, дешевле положить файл.

Файл кладётся в `~/.tg-agent-bot/scratch/<имя>.ts` и импортирует модуль относительным путём:

```ts
import { withBot } from '../lib/bot'

await withBot(async tg => {
  // работа
})
```

```bash
cd ~/.tg-agent-bot && MTCUTE_LOG_LEVEL=1 bun scratch/<имя>.ts
```

Запускать строго из корня папки - иначе не разрешится `@mtcute/bun`.

Исключение внутри колбэка пробрасывается наружу, клиент при этом закрывается, процесс отдаёт `exit 1`. Ошибку не глушить: падение с трейсом - штатный исход.

`MTCUTE_LOG_LEVEL=1` оставляет только ошибки. По умолчанию уровень 2 (warn), и рабочий вывод легко тонет в штатном шуме вида `[WRN] Telegram is having internal issues: 500:MSGID_DECREASE_RETRY, retrying in 1s` - это транзиентное, mtcute ретраит сам, вмешательства не требует.

Правила запуска:

- Сессия одна и общая, `session/bot`. Не заводить вторую и не запускать два скрипта одновременно.
- Не вызывать `startUpdatesLoop()` и не поднимать `Dispatcher`. Скрипты одноразовые, апдейты им не нужны, а без них не копится расхождение состояния.
- Не конструировать `TelegramClient` руками - только через `withBot`. Забытый `destroy()` вешает процесс и лочит общую сессию, и это единственная причина, по которой модуль вообще существует.
- Не наращивать `lib/` обёртками над методами API (`sendMessage(chat, text)` и подобным). Это воссоздаёт CLI со всеми его болезнями: обёртки отстают от библиотеки и прячут остальные 326 методов. Модуль отвечает за жизненный цикл, работа с API живёт в скрипте.
- `lib/bot.ts` перезаписывается bootstrap'ом. Правки вносить в скилл и запускать bootstrap заново, а не редактировать копию.
- Отработавший скрипт удалять, если он не нужен для повторного использования.

### Проверка типов

Bun исполняет TypeScript без type-check: обращение к несуществующему полю становится `undefined` и может молча выключить проверку. Поэтому каждый новый или изменённый сохраняемый скрипт и каждый рецепт перед коммитом сначала проверять компилятором, затем запускать:

```bash
bash "$SKILL_DIR/scripts/typecheck.sh" scratch/<имя>.ts
cd ~/.tg-agent-bot && MTCUTE_LOG_LEVEL=1 bun --install=force run scratch/<имя>.ts
```

Для быстрой проверки ключевого различия между raw TL и high-level API запускать `bash "$SKILL_DIR/scripts/typecheck.sh" --probe-message-api`: у raw `tl.message` исходящее определяется через `message.out`, а у high-level `Message`, который возвращает `getMessages`, через `message.isOutgoing`. Незнакомые поля дополнительно сверять с установленными `.d.ts` по разделу 3; успешный `bun run` не является проверкой типов.

## 3. Поиск по API

Документация берётся из установленного пакета, а не из памяти и не из интернета. Она всегда соответствует той версии, которой пользуется скрипт. Все команды выполняются из `~/.tg-agent-bot`.

Найти высокоуровневый метод по смыслу (326 методов):

```bash
grep -oE '^    [a-zA-Z]+\(' node_modules/@mtcute/core/highlevel/client.d.ts | tr -d ' (' | sort -u | grep -i 'member'
```

Посмотреть сигнатуру метода вместе с пометкой доступности:

```bash
awk -v m="getChatMembers" '/\/\*\*/{buf=""} {buf=buf"\n"$0} $0 ~ "^    "m"\\(" {print buf; exit}' node_modules/@mtcute/core/highlevel/client.d.ts
```

В JSDoc каждого метода стоит одна из пометок, и это первое, что нужно проверить:

```
**Available**: ✅ both users and bots    - боту можно
**Available**: 🤖 bots only              - боту можно
**Available**: 👤 users only             - боту нельзя, не пытаться
```

Проверить сырой TL-метод, если высокоуровневого нет (808 методов, поле `available`):

```bash
bun -e 'const s=require("./node_modules/@mtcute/core/tl/api-schema.json"); for (const e of s.e) if (e.kind==="method" && /getParticipants/.test(e.name)) console.log(String(e.available).padEnd(5), e.name)'
```

Порядок действий при незнакомой задаче: искать высокоуровневый метод, проверить его `**Available**`, при отсутствии метода искать сырой в схеме, при `available: both` или `bot` звать через `tg.call({ _: 'namespace.method', ... })` с типизированными аргументами.

Метод, помеченный `users only`, всё равно существует в типах и вызывается из TypeScript без ошибок компиляции - запрет живёт на сервере. Компилятор здесь не защищает, пометку надо читать глазами.

## 4. Чего бот не может

Стабильный список, проверять не нужно:

- произвольная история чата - `messages.getHistory` только для юзеров, сообщения достаются лишь по известным ID. Ни права, ни настройки чата не помогают: `BOT_METHOD_INVALID` прилетает и админу собственного канала, и админу супергруппы с явно включённой видимой историей. Это ограничение уровня «ты бот», а не вопрос доступа;
- глобальный поиск сообщений - `messages.search`;
- вступить куда-либо самостоятельно - `channels.joinChannel` и `messages.importChatInvite` помечены `user`. Ни по публичному `@username`, ни по инвайт-ссылке. Проверено: `joinChat` отдаёт `BOT_METHOD_INVALID`, `checkChatInvite` тоже - бот не может даже посмотреть, что за ссылка. Добавить бота в чат может только человек. Асимметрия: **выйти** бот может сам (`leaveChannel` и `deleteChatUser` помечены `both`), и создать инвайт-ссылку для других тоже (`exportChatInvite`, при наличии прав);
- список своих чатов - см. ниже, перечисления для бота не существует;
- контакты, приватность, звонки, большинство методов аккаунта;
- отметка «прочитано» - `messages.readHistory`;
- прочитать реакции - через `getMessages` поле `reactions` приходит `null`. Проверено на собственном посте сразу после собственного `sendReaction`, то есть ставить реакции можно, а читать их обратно этим путём нельзя. `views` и `forwards` при этом отдаются нормально;
- нативные отложенные сообщения - `schedule_date` вернёт `SCHEDULE_BOT_NOT_ALLOWED`;
- удаление сообщений старше 48 часов - `MessageDeleteForbiddenError`.

Всё остальное не угадывать, а проверять командами из раздела 3. MTProto не превращает бота в юзера и не обходит права в чате: если у бота нет прав админа, сервер откажет.

**Списка доступных чатов не существует.** Все методы перечисления помечены `user`: `messages.getDialogs`, `getPeerDialogs`, `getCommonChats`, `channels.getAdminedPublicChannels`, `getGroupsForDiscussion`, `getInactiveChannels`. Высокоуровневого `getDialogs` в клиенте нет вообще, есть только `iterDialogs` поверх user-only метода. `messages.getChats` и `channels.getChannels` помечены `both`, но принимают список ID - это выборка по известным, а не обход.

Таблица `peers` в SQLite сессии - тоже не каталог: это история того, что скрипты уже трогали. Полагаться на неё как на список чатов нельзя.

Что боту доступно вместо этого: резолв по публичному `@username`. Адресовать можно что угодно публичное, но узнать «где я состою» нельзя. Если нужен список - его ведёт вызывающая сторона, а не бот.

Объём доступа без вступления зависит от типа чата, и разница существенная. Проверено на чужих публичных пирах:

| | канал (broadcast) | супергруппа |
|---|---|---|
| `resolvePeer`, `getChat` | да | да |
| `getFullChat` (описание, счётчики) | да | да, включая `membersCount` и `onlineCount` |
| `getChatMembers` | **только админы** | **только админы** |
| `getMessages` по ID | посты читаются | **только ранние сервисные**, контент недоступен |
| `sendText` | нет прав | `CHAT_WRITE_FORBIDDEN` |

То есть у чужого канала контент реально вычитывается, а у чужой супергруппы - нет: приходят только первые служебные сообщения о её создании.

`getChatMembers` в чужом чате отдаёт **исключительно админский состав**: в супергруппе на 4220 участников вернулось 10, все со статусом `admin` или `creator`. Параметр `filter` при этом молча игнорируется - `all`, `recent`, `bots` и даже `kicked` дают один и тот же список. Полный состав виден только там, где у бота есть права: в своём канале вернулись и обычные участники. Ещё один случай раздела 5 - ответ успешный, длина непустая, а содержимое не то, что просили.

## 5. Проверка результата

Обязательный шаг, без него задача не считается выполненной. Отсутствие исключения ничего не доказывает: Telegram принимает запрос и возвращает объект, семантически не тот, который просили.

Реальный случай: бот «отправил suggested post», сервер ответил успехом, а на деле ушло обычное сообщение - в ответе не было `suggested_post_info`. Ошибка вскрылась только на следующем шаге.

Поэтому результат подтверждается смысловым признаком в ответе либо повторным чтением состояния:

```ts
const msg = await tg.sendText(peer, 'текст')
console.log('sent:', msg.id, 'chat:', msg.chat.id)
```

Если признака в ответе нет, состояние перечитывается отдельным вызовом. В отчёте пользователю писать наблюдаемый факт - ID сообщения, ID чата, - а не «готово».

## 6. Грабли

**Резолв пира - главный источник боли.** Голое число от человека неоднозначно: положительное `5127221342` может быть ID юзера, а может быть bare-ID старой группы, у которой marked-форма `-5127221342`. Проверено на практике: именно так и оказалось.

Что делает mtcute для числового ID: смотрит кеш сессии, затем для user и channel пробует серверный резолв с `access_hash = 0`. Это срабатывает, только если сервер согласился вернуть пир с настоящим хешем. Для старой группы (`inputPeerChat`) хеш не нужен вообще, резолв тривиален.

Если ничего не вышло, прилетит **клиентская** ошибка `MtPeerNotFoundError: Peer <id> is not found in local cache`. Это не отказ сервера и не отсутствие прав - до сервера дело могло вообще не дойти. Не путать с серверными `PEER_ID_INVALID` и `CHANNEL_INVALID`, которые означают «форма пира не та».

Когда формат ID неизвестен, не гадать по знаку, а перебрать три формы явно и передать сырой объект напрямую - высокоуровневые методы принимают `inputPeer*` наравне с числом:

```ts
import { tl } from '@mtcute/bun'
import Long from 'long'

const id = 5127221342
const forms: tl.TypeInputPeer[] = [
  { _: 'inputPeerChat', chatId: id },
  { _: 'inputPeerUser', userId: id, accessHash: Long.ZERO },
  { _: 'inputPeerChannel', channelId: id, accessHash: Long.ZERO },
]

for (const peer of forms) {
  try {
    const p = await tg.getPeer(peer)
    console.log('OK', peer._, p.id, p.displayName)
    break
  } catch (e) {
    console.log('FAIL', peer._, String(e).slice(0, 90))
  }
}
```

Пробник делается через `getPeer`, а не `getChat`: `getChat` отбраковывает user-пир по типу ещё на клиенте и маскирует настоящий ответ сервера. Реальный вывод на этом ID:

```
OK   inputPeerChat -5127221342 group Codex
FAIL inputPeerUser    Error: User ... not found
FAIL inputPeerChannel Telegram API error 400: CHANNEL_INVALID
```

Этот же чат позже мигрировал в супергруппу, и вывод пробника не изменился ни на строку - см. следующий пункт.

**В сыром TL-объекте `username` пуст, если юзернеймов несколько.** У современных пиров имена лежат в массиве `usernames`, а старое одиночное поле остаётся `undefined`. Прочитав его, легко решить, что канал непубличный, - реальная ошибка, допущенная на публичном канале с двумя именами:

```
username  : undefined
usernames : [{ username: 'oestick',   editable: true,  active: true },
             { username: 'ai_grably', editable: false, active: true }]
```

`editable: true` - имя, заданное владельцем в настройках; `editable: false` - коллекционное, купленное через Fragment. Резолвятся оба одинаково.

Высокоуровневый `Chat.username` это нормализует и подставляет первое активное имя. Мораль шире одного поля: спускаясь в `tg.call()`, теряешь нормализацию mtcute вместе с ней. Сырой вызов нужен там, где обёртки нет, а не вместо неё.

**Пир может мигрировать, и высокоуровневый API это прячет.** Старая группа превращается в супергруппу от почти любой «взрослой» настройки - например от включения видимой истории для новых участников. У неё появляется новый ID в форме канала, а прежний остаётся жить как надгробие: `inputPeerChat` продолжает резолвиться и отдавать прежнее название, старые сообщения по старым ID продолжают читаться. Ничего не падает, и заметить подмену не на чем.

`getFullChat` на старом пире после миграции по-прежнему рапортует `chatType: 'group'` и `migratedFrom: null` - mtcute поля `migratedTo` не выставляет вообще. Единственный способ увидеть переезд - сырой вызов:

```ts
const raw = await tg.call({ _: 'messages.getFullChat', chatId: bareId })
const moved = raw.chats.find(c => c._ === 'chat')?.migratedTo
// { _: 'inputChannel', channelId: 3985421992, accessHash: ... }
```

Marked-ID новой супергруппы считается как `-1000000000000 - channelId`. Обратной связи нет: с новой стороны `migratedFromChatId` пуст даже в сыром ответе, так что восстановить историю переезда можно только от старого пира.

Признаки, что работаешь с надгробием, а не с живым чатом: `membersCount` равен нулю, `channels.getParticipants` отвечает `CHANNEL_INVALID`, новые сообщения в чате не появляются под ожидаемыми ID. Если ID чата достался из заметок или прошлой сессии - перепроверять `migratedTo` перед работой.

**`getFullChat().membersCount` врёт на старой группе.** Возвращает `0`, хотя участники есть - проверено: `0` против двух реальных из `getChatMembers`. В канале то же поле заполнено верно. Ноль означает «поле не заполнено для этого типа чата», а не «пусто». Считать участников только через `getChatMembers`.

**Права админа не предсказывают отказ.** В канале у бота стояло `pinMessages: false`, а `pinMessage` отработал и пин реально применился - проверено перечиткой `pinnedMsgId`. В каналах пин управляется правом `editMessages`, поле `pinMessages` относится к группам. Не решать заранее по флагам из `getChatMembers`, что метод не пройдёт: пробовать и смотреть ответ сервера.

Оба случая - общий случай раздела 5: вызов вернул объект без исключения, поле на месте, значение семантически не то, что кажется.

**Форум-топики в threaded-режиме.** ID сообщений у сторон разные. `.id` возвращённого сервисного сообщения не является валидным topic ID - брать `.replyToMessage.threadId`.

**FLOOD_WAIT.** Короткие ожидания mtcute держит сам. Если прилетело большое - падать с явной ошибкой и сообщить пользователю, не уходить в бесконечные ретраи.

**Версия библиотеки.** Обновлять `bun add @mtcute/bun` только осознанно. После обновления команды из раздела 3 покажут актуальный API автоматически.

## 7. Рецепты

### Входящие `/start` и другие пропущенные апдейты

`withBot()` внутри `tg.start()` запускает update manager. По умолчанию он берёт текущий `updates.getState`, поэтому старый апдейт может исчезнуть из локальной точки отсчёта ещё до входа в колбэк. Если задача — проверить сообщения, пришедшие между одноразовыми запусками, сначала считать сохранённые `pts/qts/date` из SQLite, закрыть базу и только потом вызвать `withBot`. Внутри запросить `updates.getDifference` от заранее снятого cursor.

В private-чате у входящего raw `message` поле `fromId` может отсутствовать: Telegram кладёт пользователя в `peerId`. Проверено на реальном `/start`: `fromId = undefined`, `peerId = { _: 'peerUser', userId: ... }`. Поэтому отправитель входящего сообщения — `message.fromId ?? message.peerId`; проверка только `fromId` молча теряет валидный апдейт. Одновременно отбрасывать `message.out`, иначе исходящее сообщение бота будет ошибочно приписано собеседнику из `peerId`.

Одноразовый `scratch/check-start.ts`:

```ts
import { Database } from 'bun:sqlite'
import { withBot, ROOT } from '../lib/bot'

const db = new Database(`${ROOT}/session/bot`, { readonly: true })

const readState = (key: string): number => {
  const row = db.query('select value from key_value where key = ?').get(key) as { value: Uint8Array } | null
  if (!row) throw new Error(`Missing update state: ${key}`)
  return Buffer.from(row.value).readInt32LE(0)
}

let cursor = {
  pts: readState('updates_pts'),
  qts: readState('updates_qts'),
  date: readState('updates_date'),
}
db.close()

await withBot(async tg => {
  for (;;) {
    const diff = await tg.call({ _: 'updates.getDifference', ...cursor })

    if (diff._ === 'updates.differenceTooLong') {
      throw new Error(`Telegram update difference is too long: pts=${diff.pts}`)
    }
    if (diff._ === 'updates.differenceEmpty') return

    for (const message of diff.newMessages) {
      if (message._ !== 'message' || message.out || !message.message.trim().startsWith('/start')) continue

      const sender = message.fromId ?? message.peerId
      if (sender._ !== 'peerUser') continue

      const peer = await tg.getPeer(sender.userId)
      const [reread] = await tg.getMessages(peer.id, [message.id])
      if (!reread || reread.text !== message.message || reread.isOutgoing) {
        throw new Error(`Failed to verify incoming /start message ${message.id}`)
      }

      console.log(JSON.stringify({
        messageId: message.id,
        date: message.date,
        userId: peer.id,
        displayName: peer.displayName,
        username: peer.username,
        text: message.message,
      }))
    }

    if (diff._ === 'updates.difference') return
    cursor = {
      pts: diff.intermediateState.pts,
      qts: diff.intermediateState.qts,
      date: diff.intermediateState.date,
    }
  }
})
```

Запускать из `~/.tg-agent-bot` с `MTCUTE_LOG_LEVEL=1 bun scratch/check-start.ts`, затем удалить скрипт. `updates.differenceSlice` обрабатывается циклом до финального `updates.difference`; `updates.differenceTooLong` — явный отказ, а не повод молча переключаться на кеш `peers`. Таблица `peers` годится только как диагностический след уже встреченного пользователя, не как доказательство конкретного сообщения.

Всё ниже прогнано на реальном Telegram в старой группе: `sendText` обычный и с `html`, `replyTo`, `editMessage`, `sendReaction`, `pinMessage`, `unpinMessage`, `getMessages` с перечиткой текста, `getFullChat`, `getChatMembers`, `getFullUser`, `sendMedia`, `downloadToFile`, `deleteMessagesById`, сырой `tg.call`, резолв по публичному `@username`. Отдельно подтверждены отказы сервера: `BOT_METHOD_INVALID` на `getHistory` и `SCHEDULE_BOT_NOT_ALLOWED` на `schedule`.

Отдельно прогнано в канале, где бот админ: `resolvePeer`/`getChat` по `@username`, `getFullChat`, `getChatMembers` со статусами и правами, `sendText`, `editMessage`, `sendReaction`, `pinMessage` с перечиткой `pinnedMsgId`, `unpinMessage`, `sendMedia`, `downloadToFile` чужого медиа, `deleteMessagesById`. В публичном канале, где бота нет, работают чтение по ID и резолв.

Не проверено вызовом: форум-топики, стикеры, платежи, бан и приглашения. Сигнатуру перед использованием сверять командой из раздела 3, результат проверять по разделу 5.

Отправка с форматированием:

```ts
import { html } from '@mtcute/bun'
const msg = await tg.sendText(chatId, html`Привет, <b>${name}</b>`)
```

Ответ, правка, реакция, пин, удаление:

```ts
await tg.sendText(chatId, 'ответ', { replyTo: msgId })
await tg.editMessage({ chatId, message: msgId, text: 'новый текст' })
await tg.sendReaction({ chatId, message: msgId, emoji: '👍' })
const service = await tg.pinMessage({ chatId, message: msgId, notify: false })
await tg.unpinMessage({ chatId, message: msgId })
await tg.deleteMessagesById(chatId, [msgId])
```

Две ловушки в именах. `pinMessage` берёт объект `{ chatId, message }`, а не два аргумента - это `InputMessageId`, та же форма, что у `editMessage`, `sendReaction`, `unpinMessage`. И `deleteMessages` принимает массив объектов `Message`, а не ID; по числовым ID удаляет `deleteMessagesById`.

Пин порождает **сервисное сообщение**, его ID возвращается из `pinMessage`, и его тоже надо убрать за собой. Возвращаемое значение легко потерять, прогнав вызов через обёртку-хелпер - так в чате останется мусор, который никто не удалял осознанно. У сервисного сообщения пустой `text` и заполнен `action`, но в разобранном виде у `action` нет поля `_`, поэтому отличать его надо по самому наличию `action`.

Единственное исключение из запрета на историю - `messages.getPersonalChannelHistory`, помеченный `bot` (юзерам он как раз недоступен). Берёт не канал, а **user_id**, и отдаёт посты личного канала из профиля этого пользователя. Высокоуровневой обёртки нет.

```ts
const r = await tg.call({
  _: 'messages.getPersonalChannelHistory',
  userId: await tg.resolveUser(userId),
  limit: 20, maxId: 0, minId: 0, hash: Long.ZERO,
})
```

Потолок - **последние 20 постов**, глубже не пускает: `count` показывает реальный размер канала (проверено: 501), но `maxId` за пределами последней двадцатки возвращает пустой список. `limit` работает только внутри этого окна. То есть это свежая выжимка, а не архив.

Обход отсутствия истории: последний ID ищется бинарным поиском, дальше читается всё подряд. Работает, потому что `getMessages` на несуществующий ID возвращает `null`, а не ошибку.

```ts
let lo = 1, hi = 4096
while ((await tg.getMessages(chatId, [hi]))[0]) { lo = hi; hi *= 2 }
while (lo + 1 < hi) {
  const mid = (lo + hi) >> 1
  if ((await tg.getMessages(chatId, [mid]))[0]) lo = mid; else hi = mid
}
const all = (await tg.getMessages(chatId, Array.from({ length: lo }, (_, i) => i + 1))).filter(Boolean)
```

Оценка снизу, а не точный ответ: если хвост удалён, поиск остановится на последнем живом. Для чата с тысячами сообщений так вычитывать всё не стоит.

Дальше диапазон читается пачками по 100 ID за вызов. На реальном канале это сработало полностью: 13 запросов на поиск границы (последний ID 546), 6 пачек на выгрузку, на выходе 501 живое сообщение - остальные 45 ID удалены. Полнота проверяется бесплатно: `count` из `messages.getPersonalChannelHistory` для того же канала показал ровно 501. Всегда, когда есть независимый счётчик, сверяться с ним - это и есть проверка по разделу 5.

Что доезжает в такой выгрузке: `id`, `date`, `editDate`, `text`, тип медиа, `views`, `forwards`, `groupedId` для альбомов. Что не доезжает: реакции.

Сообщения по известным ID и полные объекты:

```ts
const msgs = await tg.getMessages(chatId, [1, 2, 3])
const full = await tg.getFullChat(chatId)
const user = await tg.getFullUser(userId)
```

Участники и медиа:

```ts
const members = await tg.getChatMembers(chatId, { limit: 200 })
const sent = await tg.sendMedia(chatId, { type: 'photo', file: `file:${root}/scratch/pic.png`, caption: 'подпись' })
await tg.downloadToFile(`${root}/scratch/out.jpg`, sent.media)
```

Путь к файлу в `file:` давать абсолютным. Относительный резолвится от cwd процесса, и скрипт молча промахнётся мимо файла.

Голый строковый путь без префикса `file:` не работает: строка парсится как Telegram file ID и падает с «Unsupported file ID version: N». Локальный файл — либо `` `file:${abs}` ``, либо `Bun.file(abs)`:

```ts
await tg.sendMedia(chatId, { type: 'voice', file: Bun.file(`${root}/scratch/msg.ogg`), duration: 231 }, { caption: 'подпись' })
```

Сырой TL-вызов, когда высокоуровневого метода нет:

```ts
const res = await tg.call({ _: 'messages.getFullChat', chatId: bareId })
```

`channels.getParticipants` из очевидных кандидатов работает только для каналов и супергрупп. На старой группе он отвечает `CHANNEL_INVALID` - проверено. Для неё участники берутся через `getChatMembers` или `messages.getFullChat`.
