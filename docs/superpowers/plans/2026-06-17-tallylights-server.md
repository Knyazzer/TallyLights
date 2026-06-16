# TallyLights Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Node.js-сервер, который зажигает лампы AVMATRIX TS3019-6 по COM-порту через протокол Firmata, получая tally из ATEM (по сети) или из ручного управления (HTTP/Companion), с переключением режимов и веб-админкой.

**Architecture:** Один Node-процесс. `TallyController` — ядро: хранит активный режим и состояние, мапит вход→лампу→пины. Источники (`AtemSource`, `HttpSource`) пишут в контроллер, но рендерится только активный режим. `FirmataOutput` транслирует состояние ламп в Firmata-команды на COM-порт. Express отдаёт REST, SSE и статическую админку.

**Tech Stack:** Node.js (ESM), `atem-connection`, `serialport`, `firmata`, `express`, `vitest` + `supertest` (тесты).

## Global Constraints

- Node.js ≥ 18, проект в режиме ESM (`"type": "module"`, синтаксис `import`/`export`).
- Firmata по умолчанию: `baudRate = 57600`.
- Состояния лампы: `program` (ActivePIN HIGH), `preview` (PreviewPIN HIGH), `off` (оба LOW). При совпадении приоритет у `program`.
- Контроллер применяет обновление источника, только если его режим активен (`atem` или `manual`).
- Все идентификаторы входов/ламп/пинов — числа. Пины уникальны по всем лампам.
- Никаких секретов в репозитории; `config.json` в `.gitignore`, в репозитории только `config.example.json`.
- TDD: сначала падающий тест, затем минимальная реализация. Команда тестов: `npm test`.

---

### Task 1: Скелет проекта + загрузка/валидация конфига

**Files:**
- Create: `package.json`
- Create: `config.example.json`
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `validateConfig(cfg) -> string[]` — массив ошибок (пустой = валидно).
  - `loadConfig(configPath, examplePath) -> cfg` — копирует example при отсутствии файла, парсит, валидирует, бросает `Error` при ошибках.
  - `saveConfig(configPath, cfg) -> cfg` — валидирует и пишет JSON (отступ 2), бросает `Error` при ошибках.
  - Форма `cfg`: `{ comPort:string, baudRate:number, atem:{ip:string,enabled:boolean}, http:{port:number,enabled:boolean}, defaultMode:'atem'|'manual', onAtemDisconnect:'hold'|'clear', lamps: Array<{id:number,atemInput:number,previewPin:number,activePin:number}> }`.

- [ ] **Step 1: Создать `package.json`**

```json
{
  "name": "tallylights",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "ATEM/Companion -> AVMATRIX TS3019-6 tally bridge over COM (Firmata)",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "atem-connection": "^3.9.0",
    "express": "^4.19.2",
    "firmata": "^2.3.0",
    "serialport": "^12.0.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Установить зависимости**

Run: `npm install`
Expected: создаётся `node_modules/`, `package-lock.json`; ошибок нет.

- [ ] **Step 3: Создать `config.example.json`**

```json
{
  "comPort": "COM5",
  "baudRate": 57600,
  "atem": { "ip": "192.168.10.240", "enabled": true },
  "http": { "port": 8080, "enabled": true },
  "defaultMode": "atem",
  "onAtemDisconnect": "hold",
  "lamps": [
    { "id": 1, "atemInput": 1, "previewPin": 2, "activePin": 3 },
    { "id": 2, "atemInput": 2, "previewPin": 4, "activePin": 5 },
    { "id": 3, "atemInput": 3, "previewPin": 6, "activePin": 7 },
    { "id": 4, "atemInput": 4, "previewPin": 8, "activePin": 9 },
    { "id": 5, "atemInput": 5, "previewPin": 10, "activePin": 11 },
    { "id": 6, "atemInput": 6, "previewPin": 12, "activePin": 13 }
  ]
}
```

- [ ] **Step 4: Написать падающие тесты `test/config.test.js`**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, loadConfig, saveConfig } from '../src/config.js'

const valid = {
  comPort: 'COM5', baudRate: 57600,
  atem: { ip: '192.168.10.240', enabled: true },
  http: { port: 8080, enabled: true },
  defaultMode: 'atem', onAtemDisconnect: 'hold',
  lamps: [
    { id: 1, atemInput: 1, previewPin: 2, activePin: 3 },
    { id: 2, atemInput: 2, previewPin: 4, activePin: 5 }
  ]
}

describe('validateConfig', () => {
  it('accepts a valid config', () => {
    expect(validateConfig(valid)).toEqual([])
  })
  it('requires comPort', () => {
    const cfg = { ...valid, comPort: '' }
    expect(validateConfig(cfg).some(e => e.includes('comPort'))).toBe(true)
  })
  it('rejects invalid defaultMode', () => {
    const cfg = { ...valid, defaultMode: 'bogus' }
    expect(validateConfig(cfg).some(e => e.includes('defaultMode'))).toBe(true)
  })
  it('rejects duplicate pins across lamps', () => {
    const cfg = { ...valid, lamps: [
      { id: 1, atemInput: 1, previewPin: 2, activePin: 3 },
      { id: 2, atemInput: 2, previewPin: 3, activePin: 5 }
    ] }
    expect(validateConfig(cfg).some(e => e.includes('pin'))).toBe(true)
  })
  it('rejects duplicate lamp ids', () => {
    const cfg = { ...valid, lamps: [
      { id: 1, atemInput: 1, previewPin: 2, activePin: 3 },
      { id: 1, atemInput: 2, previewPin: 4, activePin: 5 }
    ] }
    expect(validateConfig(cfg).some(e => e.includes('id'))).toBe(true)
  })
})

describe('loadConfig / saveConfig', () => {
  let dir
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('copies example when config missing, then loads it', () => {
    const example = path.join(dir, 'config.example.json')
    const target = path.join(dir, 'config.json')
    fs.writeFileSync(example, JSON.stringify(valid))
    const cfg = loadConfig(target, example)
    expect(cfg.comPort).toBe('COM5')
    expect(fs.existsSync(target)).toBe(true)
  })
  it('saveConfig throws on invalid config', () => {
    const target = path.join(dir, 'config.json')
    expect(() => saveConfig(target, { ...valid, defaultMode: 'x' })).toThrow()
  })
  it('saveConfig writes valid config', () => {
    const target = path.join(dir, 'config.json')
    saveConfig(target, valid)
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).comPort).toBe('COM5')
  })
})
```

- [ ] **Step 5: Запустить тесты — убедиться, что падают**

Run: `npm test`
Expected: FAIL (модуль `../src/config.js` не найден / функции не определены).

- [ ] **Step 6: Реализовать `src/config.js`**

```js
import fs from 'node:fs'

const VALID_MODES = ['atem', 'manual']
const VALID_DISCONNECT = ['hold', 'clear']

export function validateConfig(cfg) {
  const errors = []
  if (!cfg || typeof cfg !== 'object') return ['config must be an object']
  if (!cfg.comPort || typeof cfg.comPort !== 'string') errors.push('comPort is required')
  if (typeof cfg.baudRate !== 'number') errors.push('baudRate must be a number')
  if (!VALID_MODES.includes(cfg.defaultMode)) errors.push(`defaultMode must be one of: ${VALID_MODES.join(', ')}`)
  if (cfg.onAtemDisconnect && !VALID_DISCONNECT.includes(cfg.onAtemDisconnect)) {
    errors.push(`onAtemDisconnect must be one of: ${VALID_DISCONNECT.join(', ')}`)
  }
  if (!Array.isArray(cfg.lamps) || cfg.lamps.length === 0) {
    errors.push('lamps must be a non-empty array')
    return errors
  }
  const ids = new Set(), inputs = new Set(), pins = new Set()
  cfg.lamps.forEach((l, i) => {
    for (const f of ['id', 'atemInput', 'previewPin', 'activePin']) {
      if (typeof l[f] !== 'number') errors.push(`lamp[${i}].${f} must be a number`)
    }
    if (ids.has(l.id)) errors.push(`duplicate lamp id ${l.id}`)
    ids.add(l.id)
    if (inputs.has(l.atemInput)) errors.push(`duplicate atemInput ${l.atemInput}`)
    inputs.add(l.atemInput)
    for (const p of [l.previewPin, l.activePin]) {
      if (pins.has(p)) errors.push(`duplicate pin ${p}`)
      pins.add(p)
    }
  })
  return errors
}

export function loadConfig(configPath, examplePath) {
  if (!fs.existsSync(configPath)) fs.copyFileSync(examplePath, configPath)
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const errors = validateConfig(cfg)
  if (errors.length) throw new Error('Invalid config:\n' + errors.join('\n'))
  return cfg
}

export function saveConfig(configPath, cfg) {
  const errors = validateConfig(cfg)
  if (errors.length) throw new Error('Invalid config:\n' + errors.join('\n'))
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
  return cfg
}
```

- [ ] **Step 7: Запустить тесты — убедиться, что проходят**

Run: `npm test`
Expected: PASS (все тесты config зелёные).

- [ ] **Step 8: Коммит**

```bash
git add package.json package-lock.json config.example.json src/config.js test/config.test.js
git commit -m "feat: project scaffold and config load/validate"
```

---

### Task 2: TallyController (ядро — режим, состояние, маппинг)

**Files:**
- Create: `src/tallyController.js`
- Test: `test/tallyController.test.js`

**Interfaces:**
- Consumes: `cfg.lamps`, `cfg.defaultMode`, `cfg.onAtemDisconnect`.
- Produces (класс `TallyController extends EventEmitter`):
  - `getMode() -> 'atem'|'manual'`
  - `setMode(mode)` — меняет режим, ре-рендерит, эмитит `'mode'`.
  - `updateAtem({program:number[], preview:number[]})` — обновляет ATEM-состояние; рендерит если режим `atem`.
  - `atemDisconnected()` — при `onAtemDisconnect==='clear'` чистит ATEM-состояние.
  - `manualSet(input:number, state:'program'|'preview'|'off')` — мутирует ручное состояние; рендерит если режим `manual`.
  - `manualClear()` — чистит ручное состояние.
  - `computeLampStates() -> Array<{id,activePin,previewPin,program:boolean,preview:boolean}>`
  - События: `'render'(lampStates)` для `FirmataOutput`, `'change'({mode,lamps})` для SSE.

- [ ] **Step 1: Написать падающие тесты `test/tallyController.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import { TallyController } from '../src/tallyController.js'

const lamps = [
  { id: 1, atemInput: 1, previewPin: 2, activePin: 3 },
  { id: 2, atemInput: 2, previewPin: 4, activePin: 5 }
]
const make = (over = {}) => new TallyController({ lamps, defaultMode: 'atem', onAtemDisconnect: 'hold', ...over })

describe('TallyController', () => {
  it('maps atem program/preview to lamp pin states', () => {
    const c = make()
    c.updateAtem({ program: [1], preview: [2] })
    const s = c.computeLampStates()
    expect(s.find(l => l.id === 1)).toMatchObject({ program: true, preview: false })
    expect(s.find(l => l.id === 2)).toMatchObject({ program: false, preview: true })
  })

  it('gives program priority when input is both program and preview', () => {
    const c = make()
    c.updateAtem({ program: [1], preview: [1] })
    expect(c.computeLampStates().find(l => l.id === 1)).toMatchObject({ program: true, preview: false })
  })

  it('ignores atem updates when in manual mode', () => {
    const c = make({ defaultMode: 'manual' })
    const render = vi.fn()
    c.on('render', render)
    c.updateAtem({ program: [1], preview: [] })
    expect(render).not.toHaveBeenCalled()
    expect(c.computeLampStates().every(l => !l.program && !l.preview)).toBe(true)
  })

  it('ignores manual updates when in atem mode', () => {
    const c = make({ defaultMode: 'atem' })
    c.manualSet(1, 'program')
    expect(c.computeLampStates().find(l => l.id === 1).program).toBe(false)
  })

  it('renders from manual state in manual mode', () => {
    const c = make({ defaultMode: 'manual' })
    c.manualSet(2, 'preview')
    expect(c.computeLampStates().find(l => l.id === 2)).toMatchObject({ preview: true })
  })

  it('re-renders active state when mode switches', () => {
    const c = make({ defaultMode: 'manual' })
    c.updateAtem({ program: [1], preview: [] }) // stored but not shown
    expect(c.computeLampStates().find(l => l.id === 1).program).toBe(false)
    const render = vi.fn()
    c.on('render', render)
    c.setMode('atem')
    expect(render).toHaveBeenCalled()
    expect(c.computeLampStates().find(l => l.id === 1).program).toBe(true)
  })

  it('clears atem state on disconnect when configured to clear', () => {
    const c = make({ defaultMode: 'atem', onAtemDisconnect: 'clear' })
    c.updateAtem({ program: [1], preview: [] })
    c.atemDisconnected()
    expect(c.computeLampStates().find(l => l.id === 1).program).toBe(false)
  })

  it('holds atem state on disconnect when configured to hold', () => {
    const c = make({ defaultMode: 'atem', onAtemDisconnect: 'hold' })
    c.updateAtem({ program: [1], preview: [] })
    c.atemDisconnected()
    expect(c.computeLampStates().find(l => l.id === 1).program).toBe(true)
  })

  it('manualSet off removes an input', () => {
    const c = make({ defaultMode: 'manual' })
    c.manualSet(1, 'program')
    c.manualSet(1, 'off')
    expect(c.computeLampStates().find(l => l.id === 1).program).toBe(false)
  })

  it('setMode rejects invalid mode', () => {
    const c = make()
    expect(() => c.setMode('bogus')).toThrow()
  })
})
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npm test`
Expected: FAIL (`../src/tallyController.js` не найден).

- [ ] **Step 3: Реализовать `src/tallyController.js`**

```js
import { EventEmitter } from 'node:events'

export class TallyController extends EventEmitter {
  constructor({ lamps, defaultMode = 'atem', onAtemDisconnect = 'hold' }) {
    super()
    this.lamps = lamps
    this.mode = defaultMode
    this.onAtemDisconnect = onAtemDisconnect
    this.atemState = { program: new Set(), preview: new Set() }
    this.manualState = { program: new Set(), preview: new Set() }
  }

  getMode() { return this.mode }

  setMode(mode) {
    if (mode !== 'atem' && mode !== 'manual') throw new Error(`invalid mode: ${mode}`)
    this.mode = mode
    this._render()
    this.emit('mode', mode)
  }

  _active() { return this.mode === 'atem' ? this.atemState : this.manualState }

  updateAtem({ program = [], preview = [] } = {}) {
    this.atemState = { program: new Set(program), preview: new Set(preview) }
    if (this.mode === 'atem') this._render()
  }

  atemDisconnected() {
    if (this.onAtemDisconnect === 'clear') {
      this.atemState = { program: new Set(), preview: new Set() }
      if (this.mode === 'atem') this._render()
    }
  }

  manualSet(input, state) {
    this.manualState.program.delete(input)
    this.manualState.preview.delete(input)
    if (state === 'program') this.manualState.program.add(input)
    else if (state === 'preview') this.manualState.preview.add(input)
    if (this.mode === 'manual') this._render()
  }

  manualClear() {
    this.manualState = { program: new Set(), preview: new Set() }
    if (this.mode === 'manual') this._render()
  }

  computeLampStates() {
    const { program, preview } = this._active()
    return this.lamps.map(l => {
      const isProgram = program.has(l.atemInput)
      const isPreview = !isProgram && preview.has(l.atemInput)
      return { id: l.id, activePin: l.activePin, previewPin: l.previewPin, program: isProgram, preview: isPreview }
    })
  }

  _render() {
    const states = this.computeLampStates()
    this.emit('render', states)
    this.emit('change', { mode: this.mode, lamps: states })
  }
}
```

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/tallyController.js test/tallyController.test.js
git commit -m "feat: TallyController core with mode gating and input->lamp mapping"
```

---

### Task 3: FirmataOutput (вывод в COM через Firmata)

**Files:**
- Create: `src/output/firmataOutput.js`
- Test: `test/firmataOutput.test.js`

**Interfaces:**
- Consumes: `cfg.comPort`, `cfg.baudRate`, `cfg.lamps`; `lampStates` из `TallyController` (`computeLampStates()`).
- Produces (класс `FirmataOutput`):
  - `new FirmataOutput({ comPort, baudRate, lamps, boardFactory })` — `boardFactory(port, opts, readyCb) -> board` (для тестов); по умолчанию реальный `firmata`.
  - `connect() -> Promise<void>` — открывает порт, переводит все пины в OUTPUT/LOW.
  - `render(lampStates)` — пишет только изменившиеся пины (`activePin=HIGH` если program, иначе `previewPin=HIGH` если preview, иначе оба LOW).
  - `allOff()` — гасит все пины.
  - `close() -> Promise<void>` — гасит пины и закрывает транспорт.
  - Свойство `ready:boolean`.
- Контракт `board`: методы `pinMode(pin, mode)`, `digitalWrite(pin, value)`, `on(event, cb)`, `transport.close()`. Константы: `OUTPUT=1`, `HIGH=1`, `LOW=0`.

- [ ] **Step 1: Написать падающие тесты `test/firmataOutput.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import { FirmataOutput } from '../src/output/firmataOutput.js'

const lamps = [
  { id: 1, atemInput: 1, previewPin: 2, activePin: 3 },
  { id: 2, atemInput: 2, previewPin: 4, activePin: 5 }
]

function fakeBoard() {
  const calls = []
  return {
    calls,
    pinMode: (pin, mode) => calls.push(['mode', pin, mode]),
    digitalWrite: (pin, value) => calls.push(['write', pin, value]),
    on: () => {},
    transport: { close: () => calls.push(['close']) }
  }
}

function makeOutput(board) {
  return new FirmataOutput({
    comPort: 'COMX', baudRate: 57600, lamps,
    boardFactory: (port, opts, cb) => { setTimeout(() => cb(null), 0); return board }
  })
}

describe('FirmataOutput', () => {
  it('sets all pins to OUTPUT and LOW on connect', async () => {
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    expect(board.calls.filter(c => c[0] === 'mode').map(c => c[1]).sort()).toEqual([2, 3, 4, 5])
    expect(board.calls.filter(c => c[0] === 'write').every(c => c[2] === 0)).toBe(true)
    expect(out.ready).toBe(true)
  })

  it('writes activePin HIGH for program, previewPin LOW', async () => {
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    board.calls.length = 0
    out.render([{ id: 1, activePin: 3, previewPin: 2, program: true, preview: false }])
    expect(board.calls).toContainEqual(['write', 3, 1])
  })

  it('writes previewPin HIGH for preview', async () => {
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    board.calls.length = 0
    out.render([{ id: 1, activePin: 3, previewPin: 2, program: false, preview: true }])
    expect(board.calls).toContainEqual(['write', 2, 1])
  })

  it('only writes pins that changed (diff)', async () => {
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    out.render([{ id: 1, activePin: 3, previewPin: 2, program: true, preview: false }])
    board.calls.length = 0
    out.render([{ id: 1, activePin: 3, previewPin: 2, program: true, preview: false }])
    expect(board.calls.filter(c => c[0] === 'write')).toEqual([])
  })

  it('allOff drives every pin LOW', async () => {
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    out.render([{ id: 1, activePin: 3, previewPin: 2, program: true, preview: false }])
    board.calls.length = 0
    out.allOff()
    expect(board.calls).toContainEqual(['write', 3, 0])
  })
})
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npm test`
Expected: FAIL (`../src/output/firmataOutput.js` не найден).

- [ ] **Step 3: Реализовать `src/output/firmataOutput.js`**

```js
import Firmata from 'firmata'

const HIGH = 1
const LOW = 0
const OUTPUT = 1

export class FirmataOutput {
  constructor({ comPort, baudRate = 57600, lamps, boardFactory } = {}) {
    this.comPort = comPort
    this.baudRate = baudRate
    this.lamps = lamps
    this.boardFactory = boardFactory || ((port, opts, cb) => new Firmata(port, opts, cb))
    this.board = null
    this.ready = false
    this.pinValues = new Map()
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.board = this.boardFactory(this.comPort, { baudRate: this.baudRate }, (err) => {
          if (err) return reject(err)
          this._init()
          this.ready = true
          resolve()
        })
        this.board.on('error', () => { this.ready = false })
      } catch (e) { reject(e) }
    })
  }

  _init() {
    const pins = new Set()
    for (const l of this.lamps) { pins.add(l.activePin); pins.add(l.previewPin) }
    for (const p of pins) { this.board.pinMode(p, OUTPUT); this._write(p, LOW) }
  }

  _write(pin, value) {
    if (this.pinValues.get(pin) === value) return
    this.board.digitalWrite(pin, value)
    this.pinValues.set(pin, value)
  }

  render(lampStates) {
    if (!this.ready) return
    for (const s of lampStates) {
      this._write(s.activePin, s.program ? HIGH : LOW)
      this._write(s.previewPin, s.preview ? HIGH : LOW)
    }
  }

  allOff() {
    for (const l of this.lamps) { this._write(l.activePin, LOW); this._write(l.previewPin, LOW) }
  }

  async close() {
    if (!this.board) return
    this.allOff()
    if (this.board.transport && this.board.transport.close) this.board.transport.close()
    this.ready = false
  }
}
```

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/output/firmataOutput.js test/firmataOutput.test.js
git commit -m "feat: FirmataOutput with diffed digital writes and all-off"
```

---

### Task 4: AtemSource (чтение tally из ATEM)

**Files:**
- Create: `src/sources/atemSource.js`
- Test: `test/atemSource.test.js`

**Interfaces:**
- Consumes: `cfg.atem.ip`; объект `atem-connection` `Atem`.
- Produces:
  - `extractTally(state) -> {program:number[], preview:number[]}` — из ME0 (`state.video.mixEffects[0].programInput/previewInput`).
  - Класс `AtemSource extends EventEmitter`: `new AtemSource({ ip, atemFactory })`, `start()`, `stop()`.
  - События: `'tally'({program,preview})`, `'status'('connected'|'disconnected')`, `'error'(err)`.

> Примечание: v1 берёт program/preview основного M/E — это покрывает стандартный tally. Учёт кейеров/DSK (TlIn) — будущее расширение; интерфейс `'tally'` от этого не меняется.

- [ ] **Step 1: Написать падающие тесты `test/atemSource.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { AtemSource, extractTally } from '../src/sources/atemSource.js'

describe('extractTally', () => {
  it('reads program and preview from ME 0', () => {
    const state = { video: { mixEffects: [{ programInput: 1, previewInput: 2 }] } }
    expect(extractTally(state)).toEqual({ program: [1], preview: [2] })
  })
  it('returns empty arrays when state is incomplete', () => {
    expect(extractTally({})).toEqual({ program: [], preview: [] })
  })
})

function fakeAtem() {
  const a = new EventEmitter()
  a.state = { video: { mixEffects: [{ programInput: 3, previewInput: 4 }] } }
  a.connect = vi.fn()
  a.disconnect = vi.fn(async () => {})
  return a
}

describe('AtemSource', () => {
  it('emits tally on connect and stateChanged', () => {
    const atem = fakeAtem()
    const src = new AtemSource({ ip: '1.2.3.4', atemFactory: () => atem })
    const tally = vi.fn()
    src.on('tally', tally)
    src.start()
    atem.emit('connected')
    expect(tally).toHaveBeenCalledWith({ program: [3], preview: [4] })
    atem.state.video.mixEffects[0].programInput = 5
    atem.emit('stateChanged')
    expect(tally).toHaveBeenLastCalledWith({ program: [5], preview: [4] })
  })

  it('emits status on disconnect', () => {
    const atem = fakeAtem()
    const src = new AtemSource({ ip: '1.2.3.4', atemFactory: () => atem })
    const status = vi.fn()
    src.on('status', status)
    src.start()
    atem.emit('disconnected')
    expect(status).toHaveBeenCalledWith('disconnected')
  })

  it('connects to the configured ip', () => {
    const atem = fakeAtem()
    const src = new AtemSource({ ip: '9.9.9.9', atemFactory: () => atem })
    src.start()
    expect(atem.connect).toHaveBeenCalledWith('9.9.9.9')
  })
})
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npm test`
Expected: FAIL (`../src/sources/atemSource.js` не найден).

- [ ] **Step 3: Реализовать `src/sources/atemSource.js`**

```js
import { EventEmitter } from 'node:events'
import { Atem } from 'atem-connection'

export function extractTally(state) {
  const me = state?.video?.mixEffects?.[0]
  if (!me) return { program: [], preview: [] }
  const program = me.programInput != null ? [me.programInput] : []
  const preview = me.previewInput != null ? [me.previewInput] : []
  return { program, preview }
}

export class AtemSource extends EventEmitter {
  constructor({ ip, atemFactory } = {}) {
    super()
    this.ip = ip
    this.atem = atemFactory ? atemFactory() : new Atem()
    this.connected = false
  }

  start() {
    this.atem.on('connected', () => { this.connected = true; this.emit('status', 'connected'); this._emitTally() })
    this.atem.on('disconnected', () => { this.connected = false; this.emit('status', 'disconnected') })
    this.atem.on('stateChanged', () => this._emitTally())
    this.atem.on('error', (e) => this.emit('error', e))
    this.atem.connect(this.ip)
  }

  _emitTally() {
    this.emit('tally', extractTally(this.atem.state))
  }

  async stop() {
    if (this.atem.disconnect) await this.atem.disconnect()
  }
}
```

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/sources/atemSource.js test/atemSource.test.js
git commit -m "feat: AtemSource emits program/preview tally from ATEM state"
```

---

### Task 5: AtemDiscovery (поиск ATEM в подсети)

**Files:**
- Create: `src/sources/atemDiscovery.js`
- Test: `test/atemDiscovery.test.js`

**Interfaces:**
- Produces:
  - `listInterfaces() -> Array<{name,address,netmask}>` — внешние IPv4-интерфейсы.
  - `hostsForSubnet(address, netmask) -> string[]` — для /24 возвращает `.1`–`.254`.
  - `scan({ hosts, timeoutMs, socketFactory }) -> Promise<Array<{ip}>>` — рассылает ATEM-hello на UDP 9910, собирает ответивших.

- [ ] **Step 1: Написать падающие тесты `test/atemDiscovery.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { hostsForSubnet, scan } from '../src/sources/atemDiscovery.js'

describe('hostsForSubnet', () => {
  it('returns 254 hosts for a /24', () => {
    const hosts = hostsForSubnet('192.168.10.50', '255.255.255.0')
    expect(hosts.length).toBe(254)
    expect(hosts[0]).toBe('192.168.10.1')
    expect(hosts[253]).toBe('192.168.10.254')
  })
})

function fakeSocket() {
  const s = new EventEmitter()
  s.sent = []
  s.bind = (cb) => cb && cb()
  s.send = (buf, off, len, port, ip) => s.sent.push({ ip, port })
  s.close = () => {}
  return s
}

describe('scan', () => {
  it('collects IPs that respond on port 9910', async () => {
    const socket = fakeSocket()
    const p = scan({ hosts: ['192.168.10.240', '192.168.10.5'], timeoutMs: 20, socketFactory: () => socket })
    socket.emit('message', Buffer.from([0x10]), { address: '192.168.10.240', port: 9910 })
    const found = await p
    expect(found).toEqual([{ ip: '192.168.10.240' }])
    expect(socket.sent.map(s => s.port)).toEqual([9910, 9910])
  })

  it('returns empty when nobody responds', async () => {
    const socket = fakeSocket()
    const found = await scan({ hosts: ['192.168.10.5'], timeoutMs: 20, socketFactory: () => socket })
    expect(found).toEqual([])
  })
})
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npm test`
Expected: FAIL (`../src/sources/atemDiscovery.js` не найден).

- [ ] **Step 3: Реализовать `src/sources/atemDiscovery.js`**

```js
import dgram from 'node:dgram'
import os from 'node:os'

const ATEM_PORT = 9910
// Стандартный ATEM "hello/connect" пакет (20 байт), на который пульт отвечает.
const HELLO = Buffer.from([
  0x10, 0x14, 0x53, 0xab, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x3a, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00
])

export function listInterfaces() {
  const out = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address, netmask: i.netmask })
    }
  }
  return out
}

export function hostsForSubnet(address, netmask) {
  const a = address.split('.').map(Number)
  const base = `${a[0]}.${a[1]}.${a[2]}.`
  const hosts = []
  for (let h = 1; h <= 254; h++) hosts.push(base + h)
  return hosts
}

export function scan({ hosts, timeoutMs = 1500, socketFactory } = {}) {
  return new Promise((resolve) => {
    const found = new Map()
    const socket = (socketFactory || (() => dgram.createSocket('udp4')))()
    socket.on('message', (msg, rinfo) => {
      if (!found.has(rinfo.address)) found.set(rinfo.address, { ip: rinfo.address })
    })
    socket.on('error', () => {})
    socket.bind(() => {
      for (const ip of hosts) socket.send(HELLO, 0, HELLO.length, ATEM_PORT, ip)
    })
    setTimeout(() => {
      try { socket.close() } catch { /* ignore */ }
      resolve([...found.values()])
    }, timeoutMs)
  })
}
```

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/sources/atemDiscovery.js test/atemDiscovery.test.js
git commit -m "feat: ATEM network discovery via subnet UDP scan"
```

---

### Task 6: HttpSource (REST + SSE + admin API)

**Files:**
- Create: `src/sources/httpSource.js`
- Test: `test/httpSource.test.js`

**Interfaces:**
- Consumes: `TallyController` (`getMode/setMode/manualSet/manualClear/computeLampStates`, событие `'change'`); функции-зависимости.
- Produces:
  - `createApp({ controller, getConfig, saveConfigFn, listPorts, scanAtem, testLamp, getStatus }) -> express app`
    - `getConfig() -> cfg`
    - `saveConfigFn(cfg) -> cfg` (бросает на ошибке валидации)
    - `listPorts() -> Promise<Array>`
    - `scanAtem() -> Promise<Array<{ip}>>`
    - `testLamp(id, color) -> Promise<void>`
    - `getStatus() -> { atem:boolean, com:boolean }`
  - Маршруты: `POST /mode/:mode`, `GET /mode`, `POST /program|preview|off/:input`, `POST /clear`, `GET /status`, `GET /events` (SSE), `GET /api/config`, `PUT /api/config`, `GET /api/ports`, `GET /api/atem/scan`, `POST /api/test/lamp/:id`, статика `public/`.

- [ ] **Step 1: Написать падающие тесты `test/httpSource.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { TallyController } from '../src/tallyController.js'
import { createApp } from '../src/sources/httpSource.js'

const lamps = [{ id: 1, atemInput: 1, previewPin: 2, activePin: 3 }]
function makeApp(over = {}) {
  const controller = new TallyController({ lamps, defaultMode: 'atem', onAtemDisconnect: 'hold' })
  const deps = {
    controller,
    getConfig: () => ({ comPort: 'COM5', lamps }),
    saveConfigFn: vi.fn((cfg) => cfg),
    listPorts: vi.fn(async () => [{ path: 'COM5' }]),
    scanAtem: vi.fn(async () => [{ ip: '192.168.10.240' }]),
    testLamp: vi.fn(async () => {}),
    getStatus: () => ({ atem: false, com: false }),
    ...over
  }
  return { app: createApp(deps), controller, deps }
}

describe('httpSource', () => {
  it('switches mode', async () => {
    const { app, controller } = makeApp()
    await request(app).post('/mode/manual').expect(200)
    expect(controller.getMode()).toBe('manual')
  })

  it('rejects tally commands when not in manual mode (409)', async () => {
    const { app } = makeApp()
    await request(app).post('/program/1').expect(409)
  })

  it('accepts tally commands in manual mode', async () => {
    const { app, controller } = makeApp()
    controller.setMode('manual')
    await request(app).post('/program/1').expect(200)
    expect(controller.computeLampStates().find(l => l.id === 1).program).toBe(true)
  })

  it('400 on non-numeric input', async () => {
    const { app, controller } = makeApp()
    controller.setMode('manual')
    await request(app).post('/program/abc').expect(400)
  })

  it('returns status JSON', async () => {
    const { app } = makeApp()
    const res = await request(app).get('/status').expect(200)
    expect(res.body).toHaveProperty('mode')
    expect(res.body).toHaveProperty('lamps')
  })

  it('lists serial ports', async () => {
    const { app } = makeApp()
    const res = await request(app).get('/api/ports').expect(200)
    expect(res.body).toEqual([{ path: 'COM5' }])
  })

  it('scans for ATEM', async () => {
    const { app } = makeApp()
    const res = await request(app).get('/api/atem/scan').expect(200)
    expect(res.body).toEqual([{ ip: '192.168.10.240' }])
  })

  it('saves config (200) and rejects invalid (422)', async () => {
    const saveConfigFn = vi.fn((cfg) => { if (!cfg.ok) throw new Error('bad'); return cfg })
    const { app } = makeApp({ saveConfigFn })
    await request(app).put('/api/config').send({ ok: true }).expect(200)
    await request(app).put('/api/config').send({ ok: false }).expect(422)
  })
})
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `npm test`
Expected: FAIL (`../src/sources/httpSource.js` не найден).

- [ ] **Step 3: Реализовать `src/sources/httpSource.js`**

```js
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public')

export function createApp({ controller, getConfig, saveConfigFn, listPorts, scanAtem, testLamp, getStatus }) {
  const app = express()
  app.use(express.json())

  app.post('/mode/:mode', (req, res) => {
    try { controller.setMode(req.params.mode); res.json({ mode: controller.getMode() }) }
    catch (e) { res.status(400).json({ error: e.message }) }
  })
  app.get('/mode', (req, res) => res.json({ mode: controller.getMode() }))

  const manual = (state) => (req, res) => {
    if (controller.getMode() !== 'manual') return res.status(409).json({ error: 'server not in manual mode' })
    const input = Number(req.params.input)
    if (!Number.isInteger(input)) return res.status(400).json({ error: 'invalid input' })
    controller.manualSet(input, state)
    res.json({ ok: true })
  }
  app.post('/program/:input', manual('program'))
  app.post('/preview/:input', manual('preview'))
  app.post('/off/:input', manual('off'))
  app.post('/clear', (req, res) => {
    if (controller.getMode() !== 'manual') return res.status(409).json({ error: 'server not in manual mode' })
    controller.manualClear()
    res.json({ ok: true })
  })

  app.get('/status', (req, res) => {
    res.json({ mode: controller.getMode(), lamps: controller.computeLampStates(), connections: getStatus() })
  })

  app.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.flushHeaders()
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
    send({ mode: controller.getMode(), lamps: controller.computeLampStates(), connections: getStatus() })
    const onChange = (d) => send({ ...d, connections: getStatus() })
    controller.on('change', onChange)
    req.on('close', () => controller.off('change', onChange))
  })

  app.get('/api/config', (req, res) => res.json(getConfig()))
  app.put('/api/config', (req, res) => {
    try { res.json(saveConfigFn(req.body)) }
    catch (e) { res.status(422).json({ error: e.message }) }
  })
  app.get('/api/ports', async (req, res) => res.json(await listPorts()))
  app.get('/api/atem/scan', async (req, res) => res.json(await scanAtem()))
  app.post('/api/test/lamp/:id', async (req, res) => {
    await testLamp(Number(req.params.id), req.query.color || 'program')
    res.json({ ok: true })
  })

  app.use(express.static(PUBLIC_DIR))
  return app
}
```

- [ ] **Step 4: Запустить тесты — убедиться, что проходят**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/sources/httpSource.js test/httpSource.test.js
git commit -m "feat: HTTP source with tally, mode, status/SSE and admin API"
```

---

### Task 7: Веб-админка (public/)

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Test: `test/staticUi.test.js`

**Interfaces:**
- Consumes: маршруты из Task 6 (`/api/config`, `/api/ports`, `/api/atem/scan`, `/mode/:mode`, `/program|preview|off/:input`, `/api/test/lamp/:id`, `/events`).
- Produces: статическая SPA-страница. Автотест — только smoke (страница отдаётся).

- [ ] **Step 1: Написать падающий smoke-тест `test/staticUi.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { TallyController } from '../src/tallyController.js'
import { createApp } from '../src/sources/httpSource.js'

describe('static admin UI', () => {
  it('serves index.html at /', async () => {
    const controller = new TallyController({ lamps: [{ id: 1, atemInput: 1, previewPin: 2, activePin: 3 }], defaultMode: 'atem' })
    const app = createApp({
      controller,
      getConfig: () => ({}), saveConfigFn: (c) => c,
      listPorts: async () => [], scanAtem: async () => [],
      testLamp: async () => {}, getStatus: () => ({ atem: false, com: false })
    })
    const res = await request(app).get('/').expect(200)
    expect(res.text).toContain('TallyLights')
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test`
Expected: FAIL (нет `public/index.html`, статика отдаёт 404).

- [ ] **Step 3: Создать `public/index.html`**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TallyLights — Admin</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header>
    <h1>TallyLights</h1>
    <div class="modes">
      <span>Режим управления:</span>
      <button data-mode="atem" class="mode-btn">ATEM</button>
      <button data-mode="manual" class="mode-btn">Ручной</button>
      <span id="mode-current" class="badge"></span>
    </div>
    <div class="status">
      ATEM: <span id="st-atem" class="dot"></span>
      COM: <span id="st-com" class="dot"></span>
    </div>
  </header>

  <main>
    <section>
      <h2>Лампы</h2>
      <div id="lamps" class="lamps"></div>
    </section>

    <section>
      <h2>ATEM в сети</h2>
      <button id="scan">Сканировать сеть</button>
      <ul id="atem-list"></ul>
    </section>

    <section>
      <h2>Настройки</h2>
      <form id="settings">
        <label>COM-порт
          <select id="comPort"></select>
        </label>
        <label>Baud <input id="baudRate" type="number" /></label>
        <label>ATEM IP <input id="atemIp" type="text" /></label>
        <label>HTTP-порт <input id="httpPort" type="number" /></label>
        <label>Режим по умолчанию
          <select id="defaultMode"><option value="atem">atem</option><option value="manual">manual</option></select>
        </label>
        <label>При потере ATEM
          <select id="onAtemDisconnect"><option value="hold">hold</option><option value="clear">clear</option></select>
        </label>
        <h3>Карта ламп</h3>
        <table id="lamp-table">
          <thead><tr><th>id</th><th>вход</th><th>previewPin</th><th>activePin</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
        <button type="button" id="add-lamp">+ лампа</button>
        <button type="submit">Сохранить</button>
      </form>
    </section>
  </main>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Создать `public/styles.css`**

```css
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; margin: 0; background: #14161a; color: #e6e6e6; }
header { padding: 16px; background: #1d2026; display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
h1 { font-size: 18px; margin: 0; }
main { padding: 16px; display: grid; gap: 24px; max-width: 920px; }
section { background: #1d2026; border-radius: 8px; padding: 16px; }
.lamps { display: flex; gap: 12px; flex-wrap: wrap; }
.lamp { width: 90px; height: 90px; border-radius: 8px; display: flex; align-items: center;
  justify-content: center; font-weight: bold; background: #2a2e36; border: 2px solid #3a3f49; }
.lamp.program { background: #c0392b; border-color: #e74c3c; }
.lamp.preview { background: #1e7e34; border-color: #2ecc71; }
.dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #777; }
.dot.on { background: #2ecc71; }
.badge { padding: 2px 8px; border-radius: 4px; background: #3a3f49; }
button { background: #2d6cdf; color: #fff; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
button.mode-btn.active { background: #2ecc71; }
label { display: block; margin: 8px 0; }
input, select { background: #14161a; color: #e6e6e6; border: 1px solid #3a3f49; border-radius: 4px; padding: 6px; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #3a3f49; padding: 4px; text-align: center; }
```

- [ ] **Step 5: Создать `public/app.js`**

```js
const $ = (sel) => document.querySelector(sel)
const api = (url, opts) => fetch(url, opts).then(r => r.ok ? r.json() : Promise.reject(r))

let config = null

async function loadConfig() {
  config = await api('/api/config')
  $('#baudRate').value = config.baudRate ?? 57600
  $('#atemIp').value = config.atem?.ip ?? ''
  $('#httpPort').value = config.http?.port ?? 8080
  $('#defaultMode').value = config.defaultMode ?? 'atem'
  $('#onAtemDisconnect').value = config.onAtemDisconnect ?? 'hold'
  await loadPorts()
  renderLampTable()
}

async function loadPorts() {
  const ports = await api('/api/ports')
  const sel = $('#comPort')
  sel.innerHTML = ''
  for (const p of ports) {
    const o = document.createElement('option')
    o.value = p.path; o.textContent = p.path
    sel.appendChild(o)
  }
  if (config.comPort) sel.value = config.comPort
}

function renderLampTable() {
  const tbody = $('#lamp-table tbody')
  tbody.innerHTML = ''
  for (const l of (config.lamps || [])) addLampRow(l)
}

function addLampRow(l = { id: '', atemInput: '', previewPin: '', activePin: '' }) {
  const tr = document.createElement('tr')
  for (const f of ['id', 'atemInput', 'previewPin', 'activePin']) {
    const td = document.createElement('td')
    const inp = document.createElement('input')
    inp.type = 'number'; inp.dataset.field = f; inp.value = l[f]
    td.appendChild(inp); tr.appendChild(td)
  }
  const td = document.createElement('td')
  const del = document.createElement('button')
  del.type = 'button'; del.textContent = '×'
  del.onclick = () => tr.remove()
  td.appendChild(del); tr.appendChild(td)
  $('#lamp-table tbody').appendChild(tr)
}

function collectConfig() {
  const lamps = [...document.querySelectorAll('#lamp-table tbody tr')].map(tr => {
    const o = {}
    tr.querySelectorAll('input').forEach(i => { o[i.dataset.field] = Number(i.value) })
    return o
  })
  return {
    comPort: $('#comPort').value,
    baudRate: Number($('#baudRate').value),
    atem: { ip: $('#atemIp').value, enabled: true },
    http: { port: Number($('#httpPort').value), enabled: true },
    defaultMode: $('#defaultMode').value,
    onAtemDisconnect: $('#onAtemDisconnect').value,
    lamps
  }
}

function renderLamps(lamps) {
  const box = $('#lamps')
  box.innerHTML = ''
  for (const l of lamps) {
    const d = document.createElement('div')
    d.className = 'lamp' + (l.program ? ' program' : l.preview ? ' preview' : '')
    d.textContent = l.id
    box.appendChild(d)
  }
}

function setMode(mode) {
  $('#mode-current').textContent = mode
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode))
}

function setStatus(conn) {
  $('#st-atem').classList.toggle('on', !!conn?.atem)
  $('#st-com').classList.toggle('on', !!conn?.com)
}

function connectEvents() {
  const es = new EventSource('/events')
  es.onmessage = (e) => {
    const data = JSON.parse(e.data)
    if (data.mode) setMode(data.mode)
    if (data.lamps) renderLamps(data.lamps)
    if (data.connections) setStatus(data.connections)
  }
}

document.querySelectorAll('.mode-btn').forEach(b => {
  b.onclick = () => api('/mode/' + b.dataset.mode, { method: 'POST' })
})
$('#scan').onclick = async () => {
  const list = $('#atem-list'); list.innerHTML = '<li>сканирование…</li>'
  const found = await api('/api/atem/scan')
  list.innerHTML = ''
  for (const a of found) {
    const li = document.createElement('li')
    li.textContent = a.ip + (a.model ? ` (${a.model})` : '')
    const pick = document.createElement('button')
    pick.textContent = 'выбрать'; pick.onclick = () => { $('#atemIp').value = a.ip }
    li.appendChild(pick); list.appendChild(li)
  }
  if (!found.length) list.innerHTML = '<li>не найдено</li>'
}
$('#add-lamp').onclick = () => addLampRow()
$('#settings').onsubmit = async (e) => {
  e.preventDefault()
  try { await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectConfig()) }); alert('Сохранено') }
  catch { alert('Ошибка валидации конфига') }
}

loadConfig().then(connectEvents)
```

- [ ] **Step 6: Запустить тесты — убедиться, что проходят**

Run: `npm test`
Expected: PASS (smoke-тест видит «TallyLights» в `/`).

- [ ] **Step 7: Коммит**

```bash
git add public/ test/staticUi.test.js
git commit -m "feat: web admin UI (status, mode, settings, lamp map, ATEM scan)"
```

---

### Task 8: Сборка приложения (index.js) + грейсфул-шатдаун + ручной E2E

**Files:**
- Create: `src/index.js`
- Create: `src/logger.js`
- Test: `test/index.smoke.test.js`

**Interfaces:**
- Consumes: все модули Task 1–7.
- Produces:
  - `src/logger.js`: `export const log = { info, warn, error }` (обёртка над `console`).
  - `src/index.js`: `export async function createServer(cfg, { configPath } = {})` — собирает контроллер, источники, выход, express-app; возвращает `{ app, controller, output, atemSource, start(), stop() }`. Файл также запускается как entrypoint (`node src/index.js`).

- [ ] **Step 1: Написать падающий smoke-тест `test/index.smoke.test.js`**

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createServer } from '../src/index.js'

const cfg = {
  comPort: 'COMX', baudRate: 57600,
  atem: { ip: '1.2.3.4', enabled: false },
  http: { port: 0, enabled: true },
  defaultMode: 'atem', onAtemDisconnect: 'hold',
  lamps: [{ id: 1, atemInput: 1, previewPin: 2, activePin: 3 }]
}

describe('createServer', () => {
  it('wires modules and serves /status without opening real hardware', async () => {
    const srv = await createServer(cfg, {
      // инъекции, чтобы не трогать реальное железо
      outputFactory: () => ({ connect: async () => {}, render: () => {}, allOff: () => {}, close: async () => {}, ready: true }),
      atemFactory: () => ({ on: () => {}, connect: () => {}, disconnect: async () => {}, state: {} })
    })
    const res = await request(srv.app).get('/status').expect(200)
    expect(res.body.mode).toBe('atem')
    await srv.stop()
  })
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test`
Expected: FAIL (`../src/index.js` не найден).

- [ ] **Step 3: Реализовать `src/logger.js`**

```js
export const log = {
  info: (...a) => console.log('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a)
}
```

- [ ] **Step 4: Реализовать `src/index.js`**

```js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SerialPort } from 'serialport'
import { loadConfig, saveConfig } from './config.js'
import { TallyController } from './tallyController.js'
import { FirmataOutput } from './output/firmataOutput.js'
import { AtemSource } from './sources/atemSource.js'
import { listInterfaces, hostsForSubnet, scan } from './sources/atemDiscovery.js'
import { createApp } from './sources/httpSource.js'
import { log } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const CONFIG_PATH = path.join(ROOT, 'config.json')
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json')

export async function createServer(cfg, opts = {}) {
  const { outputFactory, atemFactory, configPath = CONFIG_PATH } = opts

  const controller = new TallyController({
    lamps: cfg.lamps, defaultMode: cfg.defaultMode, onAtemDisconnect: cfg.onAtemDisconnect
  })

  const output = outputFactory
    ? outputFactory()
    : new FirmataOutput({ comPort: cfg.comPort, baudRate: cfg.baudRate, lamps: cfg.lamps })
  controller.on('render', (states) => output.render(states))

  const atemSource = new AtemSource({ ip: cfg.atem.ip, atemFactory })
  atemSource.on('tally', (t) => controller.updateAtem(t))
  atemSource.on('status', (s) => { if (s === 'disconnected') controller.atemDisconnected() })
  atemSource.on('error', (e) => log.warn('atem error:', e?.message || e))

  const status = { atem: false, com: false }
  atemSource.on('status', (s) => { status.atem = s === 'connected' })

  const app = createApp({
    controller,
    getConfig: () => cfg,
    saveConfigFn: (next) => { const saved = saveConfig(configPath, next); return saved },
    listPorts: () => SerialPort.list(),
    scanAtem: async () => {
      const ifaces = listInterfaces()
      const all = []
      for (const i of ifaces) all.push(...await scan({ hosts: hostsForSubnet(i.address, i.netmask) }))
      return all
    },
    testLamp: async (id, color) => {
      const lamp = cfg.lamps.find(l => l.id === id)
      if (!lamp) return
      output.render([{ id, activePin: lamp.activePin, previewPin: lamp.previewPin, program: color === 'program', preview: color === 'preview' }])
    },
    getStatus: () => ({ atem: status.atem, com: !!output.ready })
  })

  let server = null
  return {
    app, controller, output, atemSource,
    async start() {
      try { await output.connect(); status.com = true } catch (e) { log.error('COM connect failed:', e?.message || e) }
      if (cfg.atem.enabled) atemSource.start()
      if (cfg.http.enabled) {
        await new Promise((resolve) => { server = app.listen(cfg.http.port, resolve) })
        log.info(`HTTP on :${cfg.http.port}`)
      }
    },
    async stop() {
      if (server) await new Promise((r) => server.close(r))
      await atemSource.stop().catch(() => {})
      await output.close().catch(() => {})
    }
  }
}

// Entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig(CONFIG_PATH, EXAMPLE_PATH)
  const srv = await createServer(cfg)
  await srv.start()
  const shutdown = async () => { log.info('shutting down…'); await srv.stop(); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
```

- [ ] **Step 5: Запустить тесты — убедиться, что проходят**

Run: `npm test`
Expected: PASS (весь набор зелёный).

- [ ] **Step 6: Коммит**

```bash
git add src/index.js src/logger.js test/index.smoke.test.js
git commit -m "feat: wire modules into server with graceful shutdown"
```

- [ ] **Step 7: Ручной E2E чек-лист (на реальном железе)**

Документировать в `README.md` и проверить вручную:
1. Подключить AVMATRIX по USB-C, узнать COM-порт (Device Manager), вписать в админке/конфиге.
2. `npm start` → открыть `http://localhost:8080`.
3. Настройки: выбрать COM-порт, baud 57600, карта ламп = как в текущем vMix (PreviewPIN/ActivePIN). Сохранить.
4. «Тест лампы» по каждой лампе → загорается красный (program) и зелёный (preview).
5. Режим `atem`: «Сканировать сеть» → выбрать ATEM → переключать входы на пульте → лампы повторяют tally.
6. Режим `manual`: из Companion (Generic HTTP) повесить кнопки `POST /program/:input`, `/preview/:input`, `/off/:input`, `/mode/manual`, `/mode/atem` → проверить.
7. Закрыть сервер (Ctrl+C) → все лампы гаснут.

- [ ] **Step 8: Создать `README.md` и закоммитить**

Кратко: назначение, установка (`npm install`), запуск (`npm start`), настройка через админку, эндпоинты для Companion, E2E чек-лист из Step 7.

```bash
git add README.md
git commit -m "docs: README with setup, Companion endpoints and E2E checklist"
```

---

## Self-Review (выполнено при написании плана)

**Spec coverage:**
- Firmata-вывод по COM (раздел 2, 5.6) → Task 3. ✓
- ATEM-источник tally (3, 5.2) → Task 4. ✓
- Обнаружение ATEM в сети (5.3) → Task 5. ✓
- HTTP/Companion + режимы + статус/SSE + admin API (5.4) → Task 6. ✓
- Ядро/маппинг/приоритет/режимы (5.5) → Task 2. ✓
- Веб-админка (5.7) → Task 7. ✓
- Сборка/шатдаун/гашение пинов (5.8, 7) → Task 8 + FirmataOutput.close/allOff. ✓
- Конфиг + валидация + первый запуск (5.1) → Task 1. ✓
- Обработка ошибок (7): 409/400/422 (Task 6), COM-сбой не валит процесс (Task 8 start), гашение на выходе (Task 3/8). ✓
- Тестирование (8): юнит + интеграция (supertest) + ручной E2E. ✓

**Placeholder scan:** плейсхолдеров нет; во всех шагах реальный код и команды.

**Type consistency:** имена согласованы между задачами — `computeLampStates()`, `updateAtem()`, `manualSet()`, `setMode()`, `render(lampStates)` с полями `{id,activePin,previewPin,program,preview}`, `extractTally()`, `scan()/hostsForSubnet()`, `createApp({...})`, `createServer()`.

**Известное сужение относительно спеки:** ATEM-tally в v1 берётся из program/preview основного M/E (Task 4), а не из вычисленного пультом TlIn (кейеры/DSK). Интерфейс события `'tally'` это допускает; апгрейд до TlIn — отдельная задача без изменения контрактов.
