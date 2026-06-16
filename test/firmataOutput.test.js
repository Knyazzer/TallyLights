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
})
