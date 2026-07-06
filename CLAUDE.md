# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

Сервер tally-индикации: мост от пульта **Blackmagic ATEM** (или ручного HTTP-управления из
Bitfocus Companion) к тэли-боксу **AVMATRIX TS3019-6** по COM-порту через сырой **Firmata**.
Node.js (ESM), Express-админка, целевая платформа — Windows. Подробности предметной области
и HTTP API — в [README.md](README.md).

## Команды

```bash
npm start                  # запуск сервера (node src/index.js)
npm run dev                # запуск с --watch (перезапуск при изменениях)
npm test                   # все тесты (vitest run)
npx vitest run test/tallyController.test.js   # один файл тестов
npx vitest                 # watch-режим тестов
npm run build:installer    # собрать dist\TallyLightsSetup.exe (нужен Inno Setup)
```

Управляющие переменные окружения: `TALLY_NO_TRAY=1` (без трея), `TALLY_NO_OPEN=1` (не
открывать браузер), `TALLY_DATA_DIR=...` (где лежит писабельный `config.json`).

## Архитектура

Поток данных однонаправленный, всё связывается событиями в [src/index.js](src/index.js)
(`createServer`), который — единственная точка сборки модулей:

```
AtemSource ─tally─┐
                  ├─→ TallyController ─render─→ FirmataOutput ─→ COM (Firmata байты)
HTTP (manual) ────┘        │
                           └─change─→ SSE /events → админка
```

- **[TallyController](src/tallyController.js)** — ядро, без I/O. Хранит ДВА независимых
  состояния: `atemState` и `manualState`. Активен всегда ровно один (`this.mode`), только
  оно рендерится. Источники всегда пишут в своё состояние, но `_render()` срабатывает только
  если их режим активен. `computeLampStates()` маппит вход ATEM → пины лампы (program
  приоритетнее preview). Эмитит `render` (→ железо) и `change` (→ SSE).
- **[AtemSource](src/sources/atemSource.js)** — обёртка `atem-connection` (UDP 9910). Tally
  берётся только из `mixEffects[0]` (один M/E). `reconnect(ip)` меняет пульт на лету.
- **[FirmataOutput](src/output/firmataOutput.js)** — пишет в COM **сырые Firmata-команды**
  (`SET_PIN_MODE` + port-based `DIGITAL_MESSAGE`), БЕЗ firmata/firmata-io handshake: прошивка
  TS3019 не отвечает на `REPORT_VERSION`, поэтому "ready" = порт открылся + 1 c на settle
  (как делает vMix). `pinValues`-кэш диффит записи, чтобы не дёргать порт зря.
- **[atemDiscovery](src/sources/atemDiscovery.js)** — рассылает hello-пакет по всем /24
  локальных интерфейсов, собирает ответивших. `index.js` авто-подключается к найденному
  пульту и ретраит каждые ~15 c, пока ATEM не подключён.
- **[httpSource](src/sources/httpSource.js)** — `createApp(deps)`: чистая фабрика Express,
  все зависимости инжектируются, без `listen` (его делает `index.js`). Ручные tally-команды
  возвращают `409` вне режима `manual`.

## Ключевые инварианты (не сломать)

- **Пины ламп зашиты в коде** ([src/lampPins.js](src/lampPins.js)), НЕ в конфиге. Конфиг
  хранит только `{id, atemInput}` на лампу; `withPins()` навешивает пины по id при загрузке.
  `saveConfig` срезает пины обратно перед записью на диск.
- **Hot-apply vs restart.** `PUT /api/config` применяет на лету карту ламп, `onAtemDisconnect`
  и переподключение ATEM. Перезапуска требуют только `comPort`, `baudRate`, `http.port` —
  список считает [diffRestartFields.js](src/diffRestartFields.js) (правь его при добавлении
  restart-полей).
- **Никаких top-level импортов нативных модулей.** `serialport` и `atem-connection` (в
  index.js) импортируются лениво (`await import(...)`), чтобы тесты и любой импортёр грузили
  модули без нативных биндингов и реального железа. Не поднимай эти импорты наверх.
- **Старт не должен падать от железа.** HTTP поднимается первым; ошибки COM/ATEM логируются,
  но никогда не фатальны и не блокируют — оператор чинит порт/IP из браузера.
- **Конфиг писабелен не всегда.** В установленной версии (Program Files) `config.json`
  уезжает в `%APPDATA%\TallyLights` — см. `resolveDataDir()` в index.js.

## Тесты

`vitest`, тесты в [test/](test/), по файлу на модуль. Всё железо (serial, ATEM, UDP-сокет)
инжектируется через фабрики (`outputFactory`, `atemFactory`, `boardFactory`, `socketFactory`,
`saveConfigImpl`) — тесты идут без нативных биндингов. При добавлении логики, трогающей I/O,
сохраняй инъекцию фабрики, а не хардкодь зависимость.

## Сборка установщика

[build/build-installer.ps1](build/build-installer.ps1) стейджит self-contained payload
(node.exe + src + public + прод-`node_modules`) и компилит [build/installer.iss](build/installer.iss)
через Inno Setup. Установленный ярлык запускает через [launch-hidden.vbs](launch-hidden.vbs)
(без консольного окна; UI — только трей).

## Документация проекта

- `docs/superpowers/plans/`: [2026-06-17-tallylights-server.md](docs/superpowers/plans/2026-06-17-tallylights-server.md)
- `docs/superpowers/specs/`: [2026-06-17-tally-lights-server-design.md](docs/superpowers/specs/2026-06-17-tally-lights-server-design.md)
