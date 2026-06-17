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
    this.atem.on('connected', () => {
      this.connected = true
      this.emit('status', 'connected')
      this._emitTally()
    })
    this.atem.on('disconnected', () => {
      this.connected = false
      this.emit('status', 'disconnected')
    })
    this.atem.on('stateChanged', () => this._emitTally())
    this.atem.on('error', (e) => this.emit('error', e))
    this.atem.connect(this.ip)
  }

  _emitTally() {
    this.emit('tally', extractTally(this.atem.state))
  }

  // Real ATEM inputs as [{id, name}], cameras only (ids 1..999, excluding
  // internal sources like Black/Bars/Color). Empty if the pult isn't connected.
  getInputs() {
    const inputs = this.atem?.state?.inputs || {}
    return Object.entries(inputs)
      .map(([k, i]) => ({ id: Number(k), name: (i && (i.longName || i.shortName)) || `Вход ${k}` }))
      .filter(x => Number.isFinite(x.id) && x.id >= 1 && x.id < 1000)
      .sort((a, b) => a.id - b.id)
  }

  async stop() {
    if (this.atem.disconnect) await this.atem.disconnect()
  }
}
