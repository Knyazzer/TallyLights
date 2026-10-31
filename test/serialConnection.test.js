import { EventEmitter } from 'node:events'
import { it, expect, vi, afterEach } from 'vitest'
import { SerialConnection, tallyCandidates } from '../src/output/serialConnection.js'
afterEach(() => vi.useRealTimers())
const candidate = { path: 'COM7', vendorId: '1a86', productId: '7523' }
function setup(listPorts) {
  const output = new EventEmitter()
  Object.assign(output, { ready: false, connect: vi.fn(async () => { output.ready = true }),
    close: vi.fn(async () => { output.ready = false }), render: vi.fn() })
  const states = [{ id: 1, program: true }]
  const serial = new SerialConnection({ output, listPorts, getStates: () => states, retryMs: 10 })
  return { serial, output, states }
}
it('does not open unrelated USB serial devices', () => {
  expect(tallyCandidates([{ path: 'COM1', vendorId: '0403', productId: '6001' }])).toEqual([])
})
it('finds a late USB connection without restarting and replays current tally', async () => {
  vi.useFakeTimers()
  let ports = []
  const { serial, output, states } = setup(async () => ports)
  await serial.start({ comPort: 'auto', baudRate: 57600 })
  expect(serial.state.state).toBe('searching')
  ports = [candidate]; await vi.advanceTimersByTimeAsync(10)
  expect(output.connect).toHaveBeenCalledTimes(1)
  expect(output.render).toHaveBeenLastCalledWith(states)
  expect(serial.state.state).toBe('port-open')
  output.ready = false; output.emit('disconnected', new Error('unplugged'))
  ports = []; await vi.advanceTimersByTimeAsync(1)
  expect(serial.state.state).toBe('searching')
  ports = [{ ...candidate, path: 'COM8' }]; await vi.advanceTimersByTimeAsync(10)
  expect(output.comPort).toBe('COM8')
  expect(output.connect).toHaveBeenCalledTimes(2)
  await serial.stop(); await vi.advanceTimersByTimeAsync(100)
  expect(output.connect).toHaveBeenCalledTimes(2)
})
it('requires selection when several CH340 devices are present', async () => {
  const { serial, output } = setup(async () => [candidate, { ...candidate, path: 'COM8' }])
  await serial.start({ comPort: 'auto', baudRate: 57600 })
  expect(serial.state.state).toBe('selection-required')
  expect(output.connect).not.toHaveBeenCalled()
  await serial.configure({ comPort: 'COM8', baudRate: 115200 })
  expect(output.comPort).toBe('COM8'); expect(output.baudRate).toBe(115200)
  await serial.stop()
})
it('retries a busy port, then stops all background work', async () => {
  vi.useFakeTimers()
  const { serial, output } = setup(async () => [candidate])
  output.connect.mockRejectedValueOnce(new Error('Access denied'))
  await serial.start({ comPort: 'COM7', baudRate: 57600 })
  expect(serial.state.error).toBe('Access denied')
  await vi.advanceTimersByTimeAsync(10)
  expect(output.ready).toBe(true)
  await serial.stop()
  expect(output.ready).toBe(false)
})
it('waits for an in-flight connection before teardown and never replays after stopping', async () => {
  let finish
  const { serial, output } = setup(async () => [candidate])
  output.connect.mockImplementation(() => new Promise(resolve => { finish = () => { output.ready = true; resolve() } }))
  const start = serial.start({ comPort: 'auto', baudRate: 57600 })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const stop = serial.stop(); finish(); await Promise.all([start, stop])
  expect(output.ready).toBe(false); expect(output.render).not.toHaveBeenCalled()
})
