import { EventEmitter } from 'node:events'

// CH340 is a candidate, not proof of an AVMATRIX box. Never probe arbitrary
// serial devices. Multiple candidates require an explicit operator selection.
export function tallyCandidates(ports) {
  return ports.filter(p => /avmatrix|ts3019/i.test(`${p.manufacturer} ${p.friendlyName}`) ||
    (p.vendorId?.toLowerCase() === '1a86' && ['7523', '5523'].includes(p.productId?.toLowerCase())))
}
export class SerialConnection extends EventEmitter {
  constructor({ output, listPorts, getStates, retryMs = 2000 }) {
    super()
    Object.assign(this, { output, listPorts, getStates, retryMs })
    this.state = { state: 'disconnected', port: null, error: null, candidates: [] }
    this.running = false
    this.queue = Promise.resolve()
    output.on?.('disconnected', e => {
      this.publish({ state: 'disconnected', error: e?.message || null })
      if (this.running) this.schedule(0)
    })
  }
  publish(update) { Object.assign(this.state, update); this.emit('change', this.state) }
  schedule(ms = this.retryMs) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.enqueue(() => this.tick()).catch(() => {}), ms)
    this.timer.unref?.()
  }
  enqueue(fn) {
    const task = this.queue.then(fn)
    this.queue = task.catch(() => {})
    return task
  }
  start(config) { this.running = true; return this.configure(config) }
  configure(config) {
    this.config = { comPort: config.comPort, baudRate: config.baudRate }
    clearTimeout(this.timer)
    return this.enqueue(async () => {
      await this.output.close()
      if (this.running) await this.tick()
    })
  }
  async tick() {
    if (!this.running) return
    try {
      if (this.output.ready) return
      const ports = await this.listPorts()
      if (!this.running) return
      const candidates = tallyCandidates(ports)
      const port = this.config.comPort === 'auto'
        ? (candidates.length === 1 ? candidates[0].path : null)
        : ports.find(p => p.path === this.config.comPort)?.path
      this.publish({ candidates, port, error: null,
        state: port ? 'connecting' : candidates.length > 1 && this.config.comPort === 'auto' ? 'selection-required' : 'searching' })
      if (!port) return
      await this.output.close()
      this.output.comPort = port
      this.output.baudRate = this.config.baudRate
      await this.output.connect()
      if (!this.running) { await this.output.close(); return }
      this.output.render(this.getStates())
      this.publish({ state: 'port-open', port, error: null })
    } catch (e) {
      await this.output.close().catch(() => {})
      this.publish({ state: 'error', error: e.message })
    } finally {
      if (this.running) this.schedule()
    }
  }
  async stop() {
    this.running = false
    clearTimeout(this.timer)
    await this.queue
    await this.output.close()
    this.publish({ state: 'disconnected', port: null })
  }
}
