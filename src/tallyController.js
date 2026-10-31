import { EventEmitter } from 'node:events'

// ATEM keeps updating beneath temporary test overrides.
export class TallyController extends EventEmitter {
  constructor({ lamps, onAtemDisconnect = 'clear' }) {
    super()
    this.lamps = lamps
    this.onAtemDisconnect = onAtemDisconnect
    this.atemState = { program: new Set(), preview: new Set() }
    this.tests = new Map()
  }
  updateAtem({ program = [], preview = [] } = {}) {
    this.atemState = { program: new Set(program), preview: new Set(preview) }
    this.refresh()
  }
  atemDisconnected() {
    if (this.onAtemDisconnect === 'clear') this.updateAtem()
  }
  setLamps(lamps) { this.lamps = lamps; this.refresh() }
  testLamp(id, color) { this.tests.set(id, color); this.refresh() }
  endTest(id) { this.tests.delete(id); this.refresh() }
  clearTests() { this.tests.clear(); this.refresh() }
  computeLampStates() {
    return this.lamps.map(l => {
      const test = this.tests.get(l.id)
      const program = test ? test === 'program' : l.atemInput !== 0 && this.atemState.program.has(l.atemInput)
      const preview = !program && (test ? test === 'preview' : l.atemInput !== 0 && this.atemState.preview.has(l.atemInput))
      return { ...l, program, preview, testing: !!test }
    })
  }
  refresh() {
    const lamps = this.computeLampStates()
    this.emit('render', lamps)
    this.emit('change', { lamps })
  }
}
