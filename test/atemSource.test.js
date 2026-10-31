import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { AtemSource, extractTally } from '../src/sources/atemSource.js'

describe('extractTally', () => {
  it('reads the selected one-based M/E without falling back to another bus', () => {
    const state = { video: { mixEffects: [{ programInput: 1, previewInput: 2 }, { programInput: 5, previewInput: 6 }] } }
    expect(extractTally(state, 2)).toEqual({ program: [5], preview: [6] })
    expect(extractTally(state, 3)).toEqual({ program: [], preview: [] })
  })
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
  it('uses device capabilities to list available M/E banks', () => {
    const atem = fakeAtem()
    atem.state.info = { capabilities: { mixEffects: 2 } }
    const src = new AtemSource({ atemFactory: () => atem })
    expect(src.getMixEffects()).toEqual([{ id: 1, name: 'M/E 1' }, { id: 2, name: 'M/E 2' }])
    atem.state.info.capabilities.mixEffects = 1
    expect(src.getMixEffects()).toEqual([{ id: 1, name: 'M/E 1' }])
  })
  it('switches tally to another M/E live without reconnecting', () => {
    const atem = fakeAtem()
    atem.state.info = { capabilities: { mixEffects: 2 } }
    atem.state.video.mixEffects.push({ programInput: 7, previewInput: 8 })
    const src = new AtemSource({ ip: '10.0.0.1', atemFactory: () => atem })
    const tally = vi.fn(); src.on('tally', tally); src.start(); atem.emit('connected')
    src.setMe(2)
    expect(tally).toHaveBeenLastCalledWith({ program: [7], preview: [8] })
    expect(atem.connect).toHaveBeenCalledTimes(1)
    atem.state.info.capabilities.mixEffects = 1
    atem.emit('stateChanged')
    expect(tally).toHaveBeenLastCalledWith({ program: [], preview: [] })
  })
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

  it('getInputs returns camera inputs (id<1000) with names, sorted', () => {
    const atem = fakeAtem()
    atem.state.inputs = {
      1: { longName: 'CAM Left' },
      2: { shortName: 'C2' },
      3: {},
      1000: { longName: 'Black' },
      2001: { longName: 'Bars' }
    }
    const src = new AtemSource({ ip: '1.2.3.4', atemFactory: () => atem })
    expect(src.getInputs()).toEqual([
      { id: 1, name: 'CAM Left' },
      { id: 2, name: 'C2' },
      { id: 3, name: 'Вход 3' }
    ])
  })

  it('getInputs returns [] when no inputs in state', () => {
    const atem = fakeAtem()
    const src = new AtemSource({ ip: '1.2.3.4', atemFactory: () => atem })
    expect(src.getInputs()).toEqual([])
  })

  it('getInfo reports connection, ip and switcher name', () => {
    const atem = fakeAtem()
    atem.state.info = { productIdentifier: 'ATEM Constellation' }
    const src = new AtemSource({ ip: '1.2.3.4', atemFactory: () => atem })
    expect(src.getInfo()).toEqual({ connected: false, ip: '1.2.3.4', name: 'ATEM Constellation' })
  })

  it('reconnect disconnects, updates ip, and connects to the new ip', async () => {
    const atem = fakeAtem()
    const src = new AtemSource({ ip: '1.1.1.1', atemFactory: () => atem })
    src.start()
    await src.reconnect('2.2.2.2')
    expect(src.ip).toBe('2.2.2.2')
    expect(atem.disconnect).toHaveBeenCalled()
    expect(atem.connect).toHaveBeenCalledWith('2.2.2.2')
  })

  it('reconnect with empty ip disconnects without reconnecting', async () => {
    const atem = fakeAtem()
    const src = new AtemSource({ ip: '1.1.1.1', atemFactory: () => atem })
    src.start()
    atem.connect.mockClear()
    await src.reconnect(null)
    expect(atem.disconnect).toHaveBeenCalled()
    expect(atem.connect).not.toHaveBeenCalled()
  })
})
