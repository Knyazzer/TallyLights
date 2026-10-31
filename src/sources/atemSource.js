import { EventEmitter } from 'node:events'
import { Atem } from 'atem-connection'

export function extractTally(state, me = 1) {
  const bank = state?.video?.mixEffects?.[me - 1]
  if (!bank) return { program: [], preview: [] }
  return { program: bank.programInput != null ? [bank.programInput] : [],
    preview: bank.previewInput != null ? [bank.previewInput] : [] }
}
export class AtemSource extends EventEmitter {
  constructor({ ip, me = 1, atemFactory } = {}) {
    super()
    this.ip = ip
    this.me = me
    this.atem = atemFactory ? atemFactory() : new Atem()
    this.connected = false
    this.started = false
    this.operation = Promise.resolve()
  }
  attach() {
    if (this.started) return
    this.started = true
    this.atem.on('connected', () => {
      this.connected = true; this.error = null
      this.emit('status', 'connected'); this._emitTally()
    })
    this.atem.on('disconnected', () => { this.connected = false; this.emit('status', 'disconnected') })
    this.atem.on('stateChanged', () => { if (this.connected) this._emitTally() })
    this.atem.on('error', e => { this.error = e?.message || String(e); this.emit('error', e) })
  }
  start() { this.attach(); if (this.ip) this.connect(this.ip) }
  connect(ip) {
    const failed = e => {
      this.error = e.message; this.emit('error', e); this.emit('status', 'disconnected')
    }
    try { Promise.resolve(this.atem.connect(ip)).catch(failed) } catch (e) { failed(e) }
  }
  getMixEffects() {
    const reported = this.atem.state?.info?.capabilities?.mixEffects
    const count = Number.isInteger(reported) ? reported : this.atem.state?.video?.mixEffects?.length || 0
    return Array.from({ length: Math.max(0, Math.min(count, 64)) }, (_, index) => ({ id: index + 1, name: `M/E ${index + 1}` }))
  }
  setMe(me) { this.me = me; if (this.connected) this._emitTally() }
  _emitTally() {
    const available = this.getMixEffects()
    this.emit('tally', available.some(bank => bank.id === this.me) ? extractTally(this.atem.state, this.me) : { program: [], preview: [] })
  }
  getInputs() {
    return Object.entries(this.atem?.state?.inputs || {})
      .map(([id, i]) => ({ id: Number(id), name: i?.longName || i?.shortName || `Вход ${id}` }))
      .filter(x => Number.isFinite(x.id) && x.id >= 1 && x.id < 1000).sort((a, b) => a.id - b.id)
  }
  getInfo() { return { connected: this.connected, ip: this.ip, name: this.atem?.state?.info?.productIdentifier || null } }
  reconnect(ip) {
    this.attach()
    const task = this.operation.then(async () => {
      try { await this.atem.disconnect?.() } catch {}
      this.ip = ip
      this.connected = false
      this.emit('status', 'disconnected')
      if (ip) this.connect(ip)
    })
    this.operation = task.catch(() => {})
    return task
  }
  async stop() { await this.reconnect(null) }
}
