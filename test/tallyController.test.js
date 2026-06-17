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
    const render = vi.fn()
    c.on('render', render)
    c.manualSet(1, 'program')
    expect(render).not.toHaveBeenCalled()
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

  it('manualSet rejects invalid state', () => {
    const c = make()
    expect(() => c.manualSet(1, 'typo')).toThrow(/typo/)
  })

  it('emits mode event on setMode', () => {
    const c = make()
    const modeHandler = vi.fn()
    c.on('mode', modeHandler)
    c.setMode('manual')
    expect(modeHandler).toHaveBeenCalledWith('manual')
  })

  it('emits change event on render with mode and lamps', () => {
    const c = make()
    const changeHandler = vi.fn()
    c.on('change', changeHandler)
    c.updateAtem({ program: [1], preview: [] })
    expect(changeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'atem', lamps: expect.any(Array) })
    )
  })

  it('manualClear removes all manual state', () => {
    const c = make({ defaultMode: 'manual' })
    c.manualSet(1, 'program')
    c.manualSet(2, 'preview')
    c.manualClear()
    expect(c.computeLampStates().every(l => !l.program && !l.preview)).toBe(true)
  })

  it('getMode returns current mode', () => {
    const c = make({ defaultMode: 'atem' })
    expect(c.getMode()).toBe('atem')
    c.setMode('manual')
    expect(c.getMode()).toBe('manual')
  })

  it('computeLampStates includes pin fields', () => {
    const c = make()
    const states = c.computeLampStates()
    const lamp1 = states.find(l => l.id === 1)
    expect(lamp1).toMatchObject({ id: 1, activePin: 3, previewPin: 2 })
  })

  it('setLamps replaces lamp map and fires render', () => {
    const c = make()                              // lamps: ids 1 & 2
    const newLamps = [
      { id: 3, atemInput: 3, previewPin: 6, activePin: 7 }
    ]
    const renderFired = vi.fn()
    c.on('render', renderFired)
    c.updateAtem({ program: [3], preview: [] })   // pre-seed atem state
    c.setLamps(newLamps)
    expect(renderFired).toHaveBeenCalled()
    const states = c.computeLampStates()
    expect(states).toHaveLength(1)
    expect(states[0]).toMatchObject({ id: 3, program: true })
  })
})
