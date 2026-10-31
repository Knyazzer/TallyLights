import { describe, it, expect, vi } from 'vitest'
import { FirmataOutput, RawFirmataBoard } from '../src/output/firmataOutput.js'

function fakeTransport() {
  return { writes: [], write(b) { this.writes.push([...b]) }, on() {} }
}

describe('RawFirmataBoard', () => {
  it('pinMode emits SET_PIN_MODE (0xF4 pin mode)', () => {
    const t = fakeTransport()
    new RawFirmataBoard(t).pinMode(3, 1)
    expect(t.writes).toContainEqual([0xF4, 3, 1])
  })

  it('digitalWrite emits port-based DIGITAL_MESSAGE preserving other pins in the port', () => {
    const t = fakeTransport()
    const b = new RawFirmataBoard(t)
    b.digitalWrite(3, 1) // port 0, bit 3 -> mask 0x08
    expect(t.writes).toContainEqual([0x90, 0x08, 0x00])
    b.digitalWrite(2, 1) // port 0, bit 2 added -> mask 0x0C (bit 3 preserved)
    expect(t.writes).toContainEqual([0x90, 0x0C, 0x00])
    b.digitalWrite(3, 0) // clear bit 3 -> mask 0x04
    expect(t.writes).toContainEqual([0x90, 0x04, 0x00])
  })

  it('digitalWrite on pins 8-15 targets port 1', () => {
    const t = fakeTransport()
    new RawFirmataBoard(t).digitalWrite(13, 1) // 13>>3 = port 1, bit 5 -> mask 0x20
    expect(t.writes).toContainEqual([0x91, 0x20, 0x00])
  })
})

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

  // Fix 1: assert ALL 4 pins are driven LOW
  it('allOff drives every pin LOW', async () => {
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    // Drive all 4 pins HIGH via internal _write so diff cache sees them as HIGH
    out._write(2, 1); out._write(3, 1); out._write(4, 1); out._write(5, 1)
    board.calls.length = 0
    out.allOff()
    expect(board.calls).toContainEqual(['write', 2, 0])
    expect(board.calls).toContainEqual(['write', 3, 0])
    expect(board.calls).toContainEqual(['write', 4, 0])
    expect(board.calls).toContainEqual(['write', 5, 0])
  })

  // Fix 2: no dangling promise — just construct without connect()
  it('does not write if not ready', () => {
    const board = fakeBoard()
    const out = new FirmataOutput({ comPort: 'COMX', baudRate: 57600, lamps })
    out.render([{ id: 1, activePin: 3, previewPin: 2, program: true, preview: false }])
    expect(board.calls.filter(c => c[0] === 'write')).toEqual([])
  })

  // connect() must settle (not hang) when the port opens but no Firmata
  // firmware ever reports ready — otherwise server start would block forever.
  it('connect rejects after readyTimeoutMs when board never becomes ready', async () => {
    const board = fakeBoard()
    const out = new FirmataOutput({
      comPort: 'COMX', baudRate: 57600, lamps, readyTimeoutMs: 20,
      boardFactory: () => board // factory never invokes cb → never ready
    })
    await expect(out.connect()).rejects.toThrow(/serial connection/)
    expect(out.ready).toBe(false)
    expect(board.calls).toContainEqual(['close']) // port closed on timeout
  })

  // Fix 1: close() asserts all 4 pins LOW
  it('close calls allOff and transport.close', async () => {
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    // Drive all 4 pins HIGH via internal _write so diff cache sees them as HIGH
    out._write(2, 1); out._write(3, 1); out._write(4, 1); out._write(5, 1)
    board.calls.length = 0
    await out.close()
    // All 4 configured pins driven LOW
    expect(board.calls).toContainEqual(['write', 2, 0])
    expect(board.calls).toContainEqual(['write', 3, 0])
    expect(board.calls).toContainEqual(['write', 4, 0])
    expect(board.calls).toContainEqual(['write', 5, 0])
    expect(board.calls).toContainEqual(['close'])
    expect(out.ready).toBe(false)
  })

  it('program wins: activePin HIGH, previewPin stays LOW (no redundant write)', async () => {
    // After connect(), previewPin 2 is already LOW. Rendering with program=true, preview=true
    // should write activePin HIGH, but previewPin is already LOW so the diff suppresses it.
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    board.calls.length = 0
    out.render([{ id: 1, activePin: 3, previewPin: 2, program: true, preview: true }])
    const writes = board.calls.filter(c => c[0] === 'write')
    expect(writes).toContainEqual(['write', 3, 1])
    // previewPin 2 was already LOW from init — diff correctly suppresses redundant write
    expect(writes.find(w => w[1] === 2)).toBeUndefined()
  })

  it('both pins LOW when neither program nor preview (only changed pins written)', async () => {
    // After rendering program=true: activePin=3 is HIGH, previewPin=2 is still LOW.
    // Re-rendering with all off: only activePin 3 (HIGH→LOW) needs a write; previewPin 2 unchanged.
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    out.render([{ id: 1, activePin: 3, previewPin: 2, program: true, preview: false }])
    board.calls.length = 0
    out.render([{ id: 1, activePin: 3, previewPin: 2, program: false, preview: false }])
    expect(board.calls).toContainEqual(['write', 3, 0])
    // previewPin 2 was already LOW — not re-written
    expect(board.calls.find(c => c[0] === 'write' && c[1] === 2)).toBeUndefined()
  })

  it('allOff only writes pins that are currently HIGH (diff applies)', async () => {
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    // All pins start LOW from _init; allOff should produce no writes (everything already LOW)
    board.calls.length = 0
    out.allOff()
    expect(board.calls.filter(c => c[0] === 'write')).toEqual([])
  })

  // Fix 3: reconnect with a new board initializes all pins
  it('reconnect with new board initializes all pins to OUTPUT and LOW', async () => {
    const board1 = fakeBoard()
    const board2 = fakeBoard()
    const boards = [board1, board2]
    let callIdx = 0
    const out = new FirmataOutput({
      comPort: 'COMX', baudRate: 57600, lamps,
      boardFactory: (port, opts, cb) => {
        const b = boards[callIdx++]
        setTimeout(() => cb(null), 0)
        return b
      }
    })
    await out.connect()
    // Drive some pins HIGH to dirty the pin cache
    out.render([
      { id: 1, activePin: 3, previewPin: 2, program: true, preview: true },
      { id: 2, activePin: 5, previewPin: 4, program: true, preview: true }
    ])
    // Reconnect with fresh board — cache must be reset
    await out.connect()
    expect(board2.calls.filter(c => c[0] === 'mode').map(c => c[1]).sort()).toEqual([2, 3, 4, 5])
    expect(board2.calls.filter(c => c[0] === 'write').every(c => c[2] === 0)).toBe(true)
  })

  // Fix 3: double-close does not throw
  it('calling close() twice does not throw', async () => {
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    await expect(out.close()).resolves.toBeUndefined()
    await expect(out.close()).resolves.toBeUndefined()
  })

  it('setLamps after connect initializes new pins to OUTPUT and clears diff cache', async () => {
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()
    board.calls.length = 0   // clear connect-time calls

    const newLamps = [
      { id: 3, atemInput: 3, previewPin: 8, activePin: 9 }
    ]
    out.setLamps(newLamps)

    // New pins must have been set to OUTPUT mode
    const modeCalls = board.calls.filter(c => c[0] === 'mode').map(c => c[1])
    expect(modeCalls).toContain(8)
    expect(modeCalls).toContain(9)

    // diff cache cleared: a render for the new lamp must actually write
    board.calls.length = 0
    out.render([{ id: 3, activePin: 9, previewPin: 8, program: true, preview: false }])
    expect(board.calls).toContainEqual(['write', 9, 1])
  })

  it('setLamps is a safe no-op when not connected', () => {
    const out = new FirmataOutput({ comPort: 'COMX', baudRate: 57600, lamps })
    expect(() => out.setLamps([{ id: 3, atemInput: 3, previewPin: 8, activePin: 9 }])).not.toThrow()
  })

  it('setLamps drives old pins LOW before swapping to new map', async () => {
    // Fix 1: a pin driven HIGH under the OLD lamp map must be LOW-ed before the swap
    const board = fakeBoard()
    const out = makeOutput(board)
    await out.connect()

    // Drive lamp 1's activePin (3) HIGH via render
    out.render([{ id: 1, activePin: 3, previewPin: 2, program: true, preview: false }])
    board.calls.length = 0  // clear history; only care about setLamps calls

    // Swap to a new map that does NOT include lamp 1's pins
    const newLamps = [{ id: 3, atemInput: 3, previewPin: 8, activePin: 9 }]
    out.setLamps(newLamps)

    // OLD activePin 3 must have been driven LOW during setLamps
    expect(board.calls).toContainEqual(['write', 3, 0])
  })
})

it('drains LOW commands before closing a real serial transport', async () => {
  const calls = []
  const board = { pinMode() {}, digitalWrite() {}, on() {}, transport: {
    isOpen: true, drain(cb) { calls.push('drain'); setTimeout(() => { calls.push('drained'); cb() }, 1) },
    close(cb) { calls.push('close'); cb() }
  } }
  const out = new FirmataOutput({ comPort: 'COMX', lamps: [], boardFactory: (_p, _o, cb) => { queueMicrotask(cb); return board } })
  await out.connect(); await out.close()
  expect(calls).toEqual(['drain', 'drained', 'close'])
})
