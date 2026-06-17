// NOTE: serialport@12 is imported lazily (inside connect()) so tests can inject
// a fake board via boardFactory without loading native bindings at parse time.
//
// We drive the tally box with RAW Firmata bytes (SET_PIN_MODE + port-based
// DIGITAL_MESSAGE) over an open serialport@12 transport. We deliberately do NOT
// use the firmata/firmata-io handshake: the AVMATRIX TS3019 firmware accepts
// pin commands but never sends a REPORT_VERSION reply, so firmata-io's strict
// "ready" never fires. vMix drives the same box the same low-level way.

const HIGH = 1
const LOW = 0
const OUTPUT = 1

// Minimal Firmata writer over an open serial transport. Implements just the two
// commands we need, with the same method names FirmataOutput expects from a board.
export class RawFirmataBoard {
  constructor(transport) {
    this.transport = transport
    this._ports = new Map() // port index -> current 8-pin value bitmask
  }

  // SET_PIN_MODE: 0xF4, pin, mode (OUTPUT = 1)
  pinMode(pin, mode) {
    this.transport.write(Buffer.from([0xF4, pin & 0x7F, mode & 0x7F]))
  }

  // DIGITAL_MESSAGE (port-based): 0x90|port, lsb(7 bits), msb(1 bit). We keep a
  // running bitmask per 8-pin port so writing one pin preserves the others.
  digitalWrite(pin, value) {
    const port = pin >> 3
    const bit = pin & 7
    let mask = this._ports.get(port) || 0
    if (value) mask |= (1 << bit)
    else mask &= ~(1 << bit)
    this._ports.set(port, mask)
    this.transport.write(Buffer.from([0x90 | (port & 0x0F), mask & 0x7F, (mask >> 7) & 0x7F]))
  }

  on(event, cb) { this.transport.on(event, cb) }
}

export class FirmataOutput {
  constructor({ comPort, baudRate = 57600, lamps, boardFactory, readyTimeoutMs = 10000 } = {}) {
    this.comPort = comPort
    this.baudRate = baudRate
    this.lamps = lamps
    this.readyTimeoutMs = readyTimeoutMs
    this._boardFactory = boardFactory || null // resolved lazily if null
    this.board = null
    this.ready = false
    this.pinValues = new Map()
  }

  async _resolveFactory() {
    if (this._boardFactory) return this._boardFactory
    // Lazy import — only executed in production (real COM port) path.
    const { SerialPort } = await import('serialport')
    this._boardFactory = (port, opts, cb) => {
      const sp = new SerialPort({ path: port, baudRate: opts.baudRate })
      const board = new RawFirmataBoard(sp)
      let settled = false
      const finish = (err) => { if (!settled) { settled = true; cb(err) } }
      sp.on('error', finish)
      // No Firmata handshake (see top note). Ready once the port is open, plus a
      // short settle in case the board resets on open so pin init lands reliably.
      sp.on('open', () => setTimeout(() => finish(), 1000))
      return board
    }
    return this._boardFactory
  }

  async connect() {
    // Reset pin cache so a reconnect (new board) always initializes every pin.
    this.pinValues = new Map()
    const factory = await this._resolveFactory()
    return new Promise((resolve, reject) => {
      let settled = false
      let timer = null
      const finish = (fn, arg) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        fn(arg)
      }
      // The port may open on a non-Firmata device (or wrong port); the board
      // would then never report ready. Bound the wait so connect() always
      // settles and the caller (e.g. server start) can proceed.
      timer = setTimeout(() => {
        this.ready = false
        const b = this.board
        this.board = null
        try { b?.transport?.close?.() } catch { /* ignore */ }
        finish(reject, new Error(`Firmata not ready on ${this.comPort} within ${this.readyTimeoutMs}ms`))
      }, this.readyTimeoutMs)
      try {
        this.board = factory(this.comPort, { baudRate: this.baudRate }, (err) => {
          if (err) return finish(reject, err)
          this._init()
          this.ready = true
          finish(resolve)
        })
        this.board.on('error', () => { this.ready = false })
      } catch (e) { finish(reject, e) }
    })
  }

  _init() {
    const pins = new Set()
    for (const l of this.lamps) { pins.add(l.activePin); pins.add(l.previewPin) }
    for (const p of pins) { this.board.pinMode(p, OUTPUT); this._write(p, LOW) }
  }

  _write(pin, value) {
    if (!this.board) return
    if (this.pinValues.get(pin) === value) return
    this.board.digitalWrite(pin, value)
    this.pinValues.set(pin, value)
  }

  render(lampStates) {
    if (!this.ready) return
    for (const s of lampStates) {
      this._write(s.activePin, s.program ? HIGH : LOW)
      this._write(s.previewPin, s.preview && !s.program ? HIGH : LOW)
    }
  }

  allOff() {
    for (const l of this.lamps) { this._write(l.activePin, LOW); this._write(l.previewPin, LOW) }
  }

  setLamps(lamps) {
    if (this.ready) {
      // Drive ALL current (old) lamp pins LOW before swapping, so no pin stays
      // physically lit after a live lamp-map edit removes it from the new map.
      this.allOff()
    }
    this.lamps = lamps
    if (!this.ready) return
    this.pinValues = new Map()  // clear diff cache so next render re-initializes
    this._init()
  }

  async close() {
    if (!this.board) return
    this.allOff()
    if (this.board.transport && this.board.transport.close) this.board.transport.close()
    this.ready = false
    this.board = null
  }
}
