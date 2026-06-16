# TallyLights Server — Design Spec

**Дата:** 2026-06-17
**Статус:** черновик на согласовании

## 1. Проблема и цель

vMix умеет управлять тэли-боксом **AVMATRIX TS3019-6** по COM-порту. Цель — собственный
Node.js-сервер, который делает то же самое: получает информацию о том, какой вход в эфире
(program) и в превью (preview), и зажигает соответствующие лампы AVMATRIX через COM-порт —
**из источника ATEM Constellation** (напрямую по сети) **или** из ручного управления через
HTTP (Companion), с переключением режимов и веб-админкой.

## 2. Как vMix шлёт tally по COM (результат исследования)

- vMix **не использует собственный простой протокол**. На целевом устройстве работает прошивка
  **StandardFirmata**, и vMix общается с ним по **протоколу Firmata** (MIDI-подобный бинарный
  протокол поверх serial). Скорость по умолчанию — **57600 бод**.
- AVMATRIX TS3019-6 по USB-C создаёт виртуальный COM-порт и **внутри эмулирует Arduino со
  StandardFirmata**. В vMix он настраивается через **Settings → Tally Lights**, где для каждой
  лампы задаются два пина: **ActivePIN** (эфир/красный/program) и **PreviewPIN** (превью/зелёный).
- Состояния tally: `0 = off`, `1 = program`, `2 = preview` (терминология vMix TCP API
  `TALLY OK 0121…`). На пинах это раскладывается в зажигание соответствующих светодиодов.
- Вывод: чтобы быть «как vMix», сервер должен **говорить по Firmata** в COM-порт, переключая
  ActivePIN/PreviewPIN каждой лампы в HIGH/LOW.

## 3. Источники tally

- **ATEM напрямую.** У ATEM есть реверс-инжиниренный бинарный UDP-протокол (порт **9910**).
  Используем библиотеку `atem-connection` (Sofie/NRK) — она читает состояние пульта, включая
  tally (program/preview по входам). ATEM **не** поддерживает mDNS/Bonjour: обнаружение в сети —
  это **скан подсети** с ATEM-рукопожатием по UDP 9910 (как делает MixEffect).
- **HTTP (Companion).** REST-эндпоинты, чтобы вешать на кнопки Companion ручное управление.

## 4. Архитектура

```
ATEM (UDP 9910) ─┐
                 ├─► TallyController (активный режим + состояние + маппинг) ─► FirmataOutput ─► COM ─► AVMATRIX
Companion (HTTP)─┘                         ▲
                                    POST /mode/:mode  ← переключение режима
        Web-админка (статика + SSE) ◄──────┘ (статус, настройки, тест, обнаружение ATEM)
```

Один Node-процесс. Оба источника подключены всегда (ATEM держит сокет, HTTP слушает), но в лампы
рендерится **только активный режим**.

### 4.1. Принципы декомпозиции
Каждый модуль имеет одну зону ответственности и общается через явный интерфейс, тестируется
изолированно. Источники и выход не знают друг о друге — связь только через `TallyController`.

## 5. Компоненты

### 5.1. `src/config.js`
Читает и валидирует `config.json`. При первом запуске создаёт его из `config.example.json`.
Схема:

```jsonc
{
  "comPort": "COM5",              // целевой COM-порт AVMATRIX
  "baudRate": 57600,             // дефолт Firmata/StandardFirmata
  "atem": { "ip": "192.168.10.240", "enabled": true },
  "http": { "port": 8080, "enabled": true },
  "defaultMode": "atem",         // "atem" | "manual"
  "onAtemDisconnect": "hold",    // "hold" (держать последнее) | "clear" (погасить)
  "lamps": [
    { "id": 1, "atemInput": 1, "previewPin": 2, "activePin": 3 },
    { "id": 2, "atemInput": 2, "previewPin": 4, "activePin": 5 }
    // ... до 6 ламп; пины копируются из текущей настройки vMix → Tally Lights
  ]
}
```

Валидация: `comPort` задан; пины уникальны по всем лампам; `atemInput` уникальны; `id` уникальны;
режим из допустимого множества. При ошибке — падение с понятным сообщением на старте.

### 5.2. `src/sources/atemSource.js`
- Коннект к ATEM (`atem-connection`) по `config.atem.ip`. Авто-реконнект средствами библиотеки.
- На `connected` / `stateChanged` извлекает tally: множества входов в program и preview.
  - По умолчанию — из tally-данных пульта (`TlIn`, учитывает кейеры/DSK); fallback — из
    `state.video.mixEffects[0].programInput` / `.previewInput`.
- Эмитит `tallyUpdate({ program: Set<number>, preview: Set<number> })` и события статуса
  (`connected` / `disconnected` / `reconnecting`).
- Слушает `error` (библиотека требует обработки, иначе процесс падает).

### 5.3. `src/sources/atemDiscovery.js`
- `listInterfaces()` — определяет локальные IPv4-подсети из сетевых интерфейсов.
- `scan(subnet, { timeoutMs })` — рассылает ATEM-handshake (минимальный «hello» UDP-пакет) на
  порт 9910 каждому хосту диапазона параллельно; собирает ответивших по сигнатуре ответного
  пакета. Возвращает `[{ ip, model? }]` (модель — если удаётся вытащить из ответа handshake).
- Используется только для админки (кнопка «Сканировать сеть»). Не на горячем пути tally.

### 5.4. `src/sources/httpSource.js` (express)
Эндпоинты под Companion и админку.

**Управление tally (работают только в режиме `manual`; иначе `409` с пояснением):**
- `POST /program/:input` — вход N в эфир
- `POST /preview/:input` — вход N в превью
- `POST /off/:input` — погасить вход N
- `POST /clear` — погасить всё

**Режим:**
- `POST /mode/:mode` (`atem` | `manual`) — переключение активного режима
- `GET /mode` — текущий режим

**Статус и события:**
- `GET /status` — JSON: режим, связь ATEM, связь COM, текущее состояние ламп
- `GET /events` — SSE-поток live-обновлений статуса/состояния для админки

**Admin API:**
- `GET /api/config` / `PUT /api/config` — чтение/сохранение конфига (валидация + горячее
  переподключение затронутых модулей)
- `GET /api/ports` — список доступных COM-портов (`serialport.list()`)
- `GET /api/atem/scan` — запуск обнаружения ATEM в сети (см. 5.3)
- `POST /api/test/lamp/:id?color=program|preview` — тест лампы

**Статика:** `GET /` — веб-админка из `public/`.

### 5.5. `src/tallyController.js` (ядро)
- Хранит `activeMode` и текущее состояние tally (`program`/`preview` множества входов).
- Подписан на `AtemSource` и `HttpSource`; **применяет обновления только от активного источника**.
- На изменение состояния: мапит `atemInput`/вход → лампу (через `config.lamps`) → вычисляет для
  каждой лампы желаемые пины и зовёт `FirmataOutput.render(lampStates)`.
- **Приоритет:** если вход одновременно в program и preview — горит program (как в vMix).
- Переключение режима: на `atem` — немедленно подтягивает свежее состояние пульта и рендерит;
  на `manual` — сохраняет текущее состояние и начинает принимать HTTP-команды.
- Эмитит изменения для SSE (админка видит live).

### 5.6. `src/output/firmataOutput.js`
- Открывает `config.comPort` через `firmata` (поверх `serialport`), `baudRate` из конфига.
- На `ready` (Firmata-рукопожатие/версия): все preview/active пины → `OUTPUT`, значение `LOW`.
- `render(lampStates)`: для каждой лампы `activePin = HIGH` если program, иначе `previewPin = HIGH`
  если preview, иначе оба `LOW`. **Пишет только изменившиеся пины** (diff), чтобы не флудить порт.
- Реконнект при обрыве порта; статус `connected`/`disconnected`.
- **На завершении процесса (SIGINT/SIGTERM) гасит все пины**, чтобы лампа не залипла в эфире.

### 5.7. `public/` — веб-админка (HTML/CSS/JS без сборки)
- **Тип управления (режим):** переключатель `atem` / `manual`.
- **ATEM:** кнопка «Сканировать сеть» → список найденных пультов (IP + модель) → выбор; плюс ручной
  ввод IP (fallback, дефолт `192.168.10.240`).
- **Настройки:** выбор COM-порта из списка доступных, baud, HTTP-порт, режим по умолчанию,
  поведение при потере ATEM (`hold`/`clear`).
- **Карта ламп:** таблица строк `{ id, atemInput, previewPin, activePin }`, добавление/удаление.
  Сохранение → `PUT /api/config`.
- **Статус (live через SSE):** режим, связь ATEM/COM, индикаторы ламп (красный/зелёный/выкл).
- **Тест:** кнопки «тест лампы» (program/preview) по каждой лампе.

### 5.8. `src/index.js`
Старт: загрузка конфига → создание `FirmataOutput`, `AtemSource`, `HttpSource`, `TallyController` →
связывание → запуск HTTP-сервера. Грейсфул-шатдаун с гашением пинов.

## 6. Поток данных

1. **ATEM-режим:** ATEM (UDP 9910) → `AtemSource` → (режим=atem) → `TallyController` → маппинг
   вход→лампа → `FirmataOutput` → Firmata-байты → COM → AVMATRIX.
2. **Manual-режим:** Companion → HTTP POST → `HttpSource` → (режим=manual) → `TallyController` → … → COM.
3. **Переключение режима:** Companion/админка → `POST /mode/:mode` → `TallyController` меняет активный
   источник и пере-рендерит.

## 7. Обработка ошибок

- **COM не найден/отвалился:** лог, ретрай открытия каждые несколько секунд, `unhealthy` в `/status`,
  без падения процесса.
- **ATEM недоступен в режиме `atem`:** поведение по `onAtemDisconnect` (`hold` по умолчанию).
- **Невалидный вход в HTTP:** `400`; команда tally не в режиме `manual`: `409` с пояснением.
- **Невалидный конфиг на старте:** падение с понятным сообщением.
- **Сохранение конфига с ошибкой валидации:** `422`, конфиг не применяется.
- **Завершение процесса:** гасим все пины.

## 8. Тестирование (TDD)

- **Юнит:**
  - `TallyController`: апдейты неактивного источника игнорируются; маппинг вход→лампа→пины;
    приоритет program над preview; пере-рендер при смене режима.
  - `FirmataOutput`: diff-логика (пишутся только изменившиеся пины), гашение на shutdown — на mock `firmata`.
  - `config`: валидация (дубли пинов/входов/id, отсутствующий порт, неверный режим).
- **Интеграция:**
  - Фейковый serial: проверяем точные Firmata-байты для заданных состояний.
  - Mock `AtemSource`: подаём tally, проверяем состояние ламп.
  - HTTP-эндпоинты через `supertest` (tally, режим, 409/400/422, admin API).
- **Ручной чек-лист (E2E):** реальный ATEM + AVMATRIX — переключение входов, оба режима,
  обнаружение ATEM, сохранение конфига, тест ламп.

## 9. Структура проекта

```
TallyLights/
  package.json
  config.example.json
  src/
    index.js
    config.js
    tallyController.js
    sources/
      atemSource.js
      atemDiscovery.js
      httpSource.js
    output/
      firmataOutput.js
    logger.js
  public/
    index.html
    app.js
    styles.css
  test/
    ...
```

## 10. Зависимости

- `atem-connection` — ATEM по сети + tally
- `serialport` — COM-порт и перечисление портов
- `firmata` — протокол Firmata поверх serialport
- `express` — HTTP/REST + статика + SSE
- dev: тест-раннер (`vitest`/`jest`), `supertest`

## 11. Вне рамок (YAGNI на v1)

- Аутентификация админки (локальная сеть, доверенное окружение).
- Запуск как Windows-служба / трей (можно добавить позже).
- Несколько ME / сложные топологии ATEM сверх program/preview по входам.
- Беспроводные лампы AVMATRIX (433 МГц) — это внутренняя функция бокса, нас не касается.
```
