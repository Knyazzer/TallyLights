import { EventEmitter } from 'node:events'

export class RawFirmataBoard {
  constructor(transport) { this.transport = transport; this.ports = new Map() }
  pinMode(pin, mode) { this.transport.write(Buffer.from([0xF4, pin & 0x7F, mode & 0x7F])) }
  digitalWrite(pin, value) {
    const port = pin >> 3, bit = 1 << (pin & 7)
    const mask = value ? (this.ports.get(port) || 0) | bit : (this.ports.get(port) || 0) & ~bit
    this.ports.set(port, mask)
    this.transport.write(Buffer.from([0x90 | port, mask & 0x7F, (mask >> 7) & 0x7F]))
  }
  on(event, cb) { this.transport.on(event, cb) }
}
export class FirmataOutput extends EventEmitter {
  constructor({ comPort, baudRate = 57600, lamps, boardFactory, readyTimeoutMs = 5000 } = {}) {
    super()
    Object.assign(this, { comPort, baudRate, lamps, readyTimeoutMs })
    this._boardFactory = boardFactory
    this.board = null
    this.ready = false
    this.pinValues = new Map()
    this.generation = 0
  }
  async _resolveFactory() {
    if (this._boardFactory) return this._boardFactory
    const { SerialPort } = await import('serialport')
    return (port, opts, cb) => {
      const sp = new SerialPort({ path: port, baudRate: opts.baudRate })
      const board = new RawFirmataBoard(sp)
      sp.on('error', () => {}) // connect() owns errors after the board is returned
      sp.once('open', () => setTimeout(() => cb(), 1000))
      return board
    }
  }
  async connect() {
    const generation = ++this.generation
    this.pinValues.clear()
    const factory = await this._resolveFactory()
    if (generation !== this.generation) throw new Error('Connection cancelled')
    return new Promise((resolve, reject) => {
      let settled = false
      let timer
      const finish = error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.cancelConnect = null
        if (error) { this.ready = false; reject(error) } else resolve()
      }
      this.cancelConnect = () => finish(new Error('Connection cancelled'))
      timer = setTimeout(() => { finish(new Error(`No serial connection on ${this.comPort} within ${this.readyTimeoutMs}ms`)); void this.close() }, this.readyTimeoutMs)
      const ready = error => {
        // A synchronous injected factory must also work.
        queueMicrotask(() => {
          if (settled || generation !== this.generation) return
          if (error) return finish(error)
          try { this._init(); this.ready = true; finish() } catch (e) { finish(e) }
        })
      }
      try {
        const board = this.board = factory(this.comPort, { baudRate: this.baudRate }, ready)
        const disconnected = error => {
          if (generation !== this.generation) return
          this.ready = false
          finish(error instanceof Error ? error : new Error('Serial port closed'))
          this.emit('disconnected', error)
        }
        board.on('error', disconnected)
        board.on('close', () => disconnected())
      } catch (e) { finish(e) }
    })
  }
  _init() {
    for (const pin of new Set(this.lamps.flatMap(l => [l.activePin, l.previewPin]))) {
      this.board.pinMode(pin, 1); this._write(pin, 0)
    }
  }
  _write(pin, value) {
    if (!this.board || this.pinValues.get(pin) === value) return
    this.board.digitalWrite(pin, value)
    this.pinValues.set(pin, value)
  }
  render(states) {
    if (!this.ready) return
    try {
      for (const s of states) {
        this._write(s.activePin, s.program ? 1 : 0)
        this._write(s.previewPin, s.preview && !s.program ? 1 : 0)
      }
    } catch (e) { this.ready = false; this.emit('disconnected', e) }
  }
  allOff() { for (const l of this.lamps) { this._write(l.activePin, 0); this._write(l.previewPin, 0) } }
  setLamps(lamps) {
    if (this.ready) this.allOff()
    this.lamps = lamps
    if (this.ready) { this.pinValues.clear(); this._init() }
  }
  async close() {
    ++this.generation
    this.cancelConnect?.()
    const board = this.board
    if (!board) return
    try { if (this.ready) this.allOff() } catch {}
    this.ready = false
    this.board = null
    const transport = board.transport
    if (transport?.isOpen && transport.drain) await new Promise(resolve => {
      const timeout = setTimeout(resolve, 1500)
      try { transport.drain(() => { clearTimeout(timeout); resolve() }) } catch { clearTimeout(timeout); resolve() }
    })
    if (transport?.close) await new Promise(resolve => {
      if (transport.isOpen === false) { transport.destroy?.(); resolve(); return }
      try {
        // SerialPort exposes isOpen; simple injected transports do not.
        if (typeof transport.isOpen !== 'boolean') { transport.close(); resolve() }
        else transport.close(() => resolve())
      } catch { resolve() }
    })
  }
}
