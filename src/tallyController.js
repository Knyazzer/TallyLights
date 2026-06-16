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
