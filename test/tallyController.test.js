import { describe, it, expect, vi } from 'vitest'
import { TallyController } from '../src/tallyController.js'
const lamps = [{ id: 1, atemInput: 1, activePin: 3, previewPin: 2 }, { id: 2, atemInput: 2, activePin: 5, previewPin: 4 }]
describe('live tally and test overrides', () => {
  it('keeps an unassigned lamp off even when ATEM is on Black (input 0)', () => {
    const c = new TallyController({ lamps: [{ ...lamps[0], atemInput: 0 }] })
    c.updateAtem({ program: [0], preview: [0] })
    expect(c.computeLampStates()[0]).toMatchObject({ program: false, preview: false })
    c.testLamp(1, 'preview')
    expect(c.computeLampStates()[0].preview).toBe(true)
  })
  it('maps ATEM inputs and gives program priority', () => {
    const c = new TallyController({ lamps })
    c.updateAtem({ program: [1], preview: [1, 2] })
    expect(c.computeLampStates().map(l => [l.program, l.preview])).toEqual([[true, false], [false, true]])
  })
  it('defaults to clearing lamps on disconnect', () => {
    const c = new TallyController({ lamps }); c.updateAtem({ program: [1] }); c.atemDisconnected()
    expect(c.computeLampStates()[0].program).toBe(false)
  })
  it('holds last state only when explicitly configured', () => {
    const c = new TallyController({ lamps, onAtemDisconnect: 'hold' }); c.updateAtem({ program: [1] }); c.atemDisconnected()
    expect(c.computeLampStates()[0].program).toBe(true)
  })
  it('keeps a test visible during ATEM updates then restores latest live state', () => {
    const c = new TallyController({ lamps })
    c.testLamp(1, 'program'); c.updateAtem({ preview: [1], program: [2] })
    expect(c.computeLampStates()[0]).toMatchObject({ program: true, preview: false, testing: true })
    expect(c.computeLampStates()[1].program).toBe(true)
    c.endTest(1)
    expect(c.computeLampStates()[0]).toMatchObject({ program: false, preview: true, testing: false })
  })
  it('restores clear state after a test if ATEM disconnects', () => {
    const c = new TallyController({ lamps }); c.updateAtem({ program: [1] }); c.testLamp(1, 'preview')
    c.atemDisconnected(); c.clearTests()
    expect(c.computeLampStates()[0]).toMatchObject({ program: false, preview: false, testing: false })
  })
  it('applies mapping immediately and emits an updated snapshot', () => {
    const c = new TallyController({ lamps }); const changed = vi.fn(); c.on('change', changed)
    c.updateAtem({ program: [5] }); c.setLamps([{ ...lamps[0], atemInput: 5 }])
    expect(changed.mock.lastCall[0].lamps[0].program).toBe(true)
  })
})
