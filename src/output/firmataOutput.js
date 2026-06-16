// NOTE: 'firmata' is imported lazily (inside connect()) so that tests can
// inject a fake board via boardFactory without triggering the serialport
// native-binding load at module parse time.

const HIGH = 1
const LOW = 0
const OUTPUT = 1

export class FirmataOutput {
  constructor({ comPort, baudRate = 57600, lamps, boardFactory } = {}) {
    this.comPort = comPort
    this.baudRate = baudRate
    this.lamps = lamps
    this._boardFactory = boardFactory || null // resolved lazily if null
    this.board = null
    this.ready = false
    this.pinValues = new Map()
  }

  async _resolveFactory() {
    if (this._boardFactory) return this._boardFactory
    // Lazy import — only executed in production (real COM port) path.
    const { default: Firmata } = await import('firmata')
    this._boardFactory = (port, opts, cb) => new Firmata(port, opts, cb)
    return this._boardFactory
  }

  async connect() {
    const factory = await this._resolveFactory()
    return new Promise((resolve, reject) => {
      try {
        this.board = factory(this.comPort, { baudRate: this.baudRate }, (err) => {
          if (err) return reject(err)
          this._init()
          this.ready = true
          resolve()
        })
        this.board.on('error', () => { this.ready = false })
      } catch (e) { reject(e) }
    })
  }

  _init() {
    const pins = new Set()
    for (const l of this.lamps) { pins.add(l.activePin); pins.add(l.previewPin) }
    for (const p of pins) { this.board.pinMode(p, OUTPUT); this._write(p, LOW) }
  }

  _write(pin, value) {
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

  async close() {
    if (!this.board) return
    this.allOff()
    if (this.board.transport && this.board.transport.close) this.board.transport.close()
    this.ready = false
  }
}
