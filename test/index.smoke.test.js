import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import request from 'supertest'
import { createServer } from '../src/index.js'
const config = { comPort: 'auto', baudRate: 57600, atem: { enabled: false, ip: '' },
  http: { port: 0, enabled: true }, onAtemDisconnect: 'clear', lamps: [{ id: 1, atemInput: 1 }] }
const servers = []
afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.stop())); vi.useRealTimers() })
async function setup(overrides = {}) {
  const output = new EventEmitter()
  Object.assign(output, { ready: false, connect: vi.fn(async () => { output.ready = true }),
    close: vi.fn(async () => { output.ready = false }), render: vi.fn(), setLamps: vi.fn() })
  const atem = new EventEmitter(); atem.state = {}
  atem.connect = vi.fn(); atem.disconnect = vi.fn(async () => {})
  const save = vi.fn()
  const srv = await createServer(config, { outputFactory: () => output, atemFactory: () => atem,
    listPorts: async () => [{ path: 'COM5', vendorId: '1a86', productId: '7523' }],
    saveConfigImpl: save, scanNetwork: async () => [], ...overrides })
  servers.push(srv)
  return { srv, output, atem, save }
}
describe('application lifecycle', () => {
  it('applies M/E selection live and rejects unavailable banks before saving', async () => {
    const { srv, atem, save, output } = await setup()
    atem.state = { info: { capabilities: { mixEffects: 2 } }, video: { mixEffects: [
      { programInput: 1, previewInput: 2 }, { programInput: 2, previewInput: 1 }
    ] } }
    await request(srv.app).patch('/api/config').send({ atem: { enabled: true, ip: '10.0.0.5' } }).expect(200)
    atem.emit('connected')
    expect(srv.controller.computeLampStates()[0].program).toBe(true)
    await request(srv.app).patch('/api/config').send({ atem: { me: 2 } }).expect(200)
    expect(srv.controller.computeLampStates()[0]).toMatchObject({ program: false, preview: true })
    expect(atem.connect).toHaveBeenCalledTimes(1)
    expect(output.setLamps).not.toHaveBeenCalled()
    const { body } = await request(srv.app).get('/status')
    expect(body.connections.atemMe).toBe(2)
    expect(body.connections.mixEffects).toHaveLength(2)
    save.mockClear()
    for (const me of [3, 0, -1, 1.5]) await request(srv.app).patch('/api/config').send({ atem: { me } }).expect(422)
    expect(save).not.toHaveBeenCalled()
    expect(srv.atemSource.me).toBe(2)
  })
  it('starts with absent devices and remains configurable', async () => {
    const { srv } = await setup({ listPorts: async () => [] })
    await srv.start()
    expect((await request(srv.app).get('/status')).body.connections.com).toBe(false)
    await request(srv.app).patch('/api/config').send({ comPort: 'COM99' }).expect(200)
    expect(srv.serial.state.state).toBe('searching')
  })
  it('hot-applies serial and baud settings without restart', async () => {
    const { srv, output } = await setup(); await srv.start()
    const { body } = await request(srv.app).patch('/api/config').send({ comPort: 'COM5', baudRate: 115200 }).expect(200)
    expect(body.restartRequired).toBe(false); expect(output.comPort).toBe('COM5'); expect(output.baudRate).toBe(115200)
  })
  it('reinitializes the output before rendering a changed mapping', async () => {
    const { srv, output } = await setup()
    srv.atemSource.connected = true
    srv.controller.updateAtem({ program: [2] })
    output.render.mockClear()
    await request(srv.app).patch('/api/config').send({ lamps: [{ id: 1, atemInput: 2 }] }).expect(200)
    expect(output.setLamps.mock.invocationCallOrder[0]).toBeLessThan(output.render.mock.invocationCallOrder.at(-1))
    expect(output.render.mock.lastCall[0][0].program).toBe(true)
  })
  it('does not mutate running config after a failed disk write', async () => {
    const { srv } = await setup({ saveConfigImpl: () => { throw new Error('disk full') } })
    await request(srv.app).patch('/api/config').send({ baudRate: 115200 }).expect(422)
    expect((await request(srv.app).get('/api/config')).body.baudRate).toBe(57600)
  })
  it('validates before saving', async () => {
    const { srv, save } = await setup()
    for (const patch of [{ baudRate: 0 }, { atem: { ip: 'abc' } }, { lamps: [null] }])
      await request(srv.app).patch('/api/config').send(patch).expect(422)
    expect(save).not.toHaveBeenCalled()
  })
  it('replaces overlapping test timers and restores the latest ATEM state', async () => {
    const { srv, output } = await setup({ testPulseMs: 100 }); output.ready = true
    vi.useFakeTimers()
    await request(srv.app).post('/api/test/lamp/1').expect(200)
    await vi.advanceTimersByTimeAsync(60)
    await request(srv.app).post('/api/test/lamp/1?color=preview').expect(200)
    srv.controller.updateAtem({ program: [1] })
    await vi.advanceTimersByTimeAsync(50)
    expect(srv.controller.computeLampStates()[0]).toMatchObject({ preview: true, testing: true })
    await vi.advanceTimersByTimeAsync(50)
    expect(srv.controller.computeLampStates()[0]).toMatchObject({ program: true, testing: false })
  })
  it('refuses lamp tests without an open port', async () => {
    const { srv } = await setup()
    await request(srv.app).post('/api/test/lamp/1').expect(409)
  })
  it('attaches ATEM listeners when enabled after starting disabled', async () => {
    const { srv, atem } = await setup()
    await request(srv.app).patch('/api/config').send({ atem: { enabled: true, ip: '10.0.0.5' } }).expect(200)
    atem.state = { video: { mixEffects: [{ programInput: 1 }] } }; atem.emit('connected')
    expect(srv.controller.computeLampStates()[0].program).toBe(true)
    atem.emit('disconnected')
    expect(srv.controller.computeLampStates()[0].program).toBe(false)
  })
  it('keeps a selected ATEM IP rather than silently changing switchers', async () => {
    const { srv, atem } = await setup({ scanNetwork: vi.fn(async () => [{ ip: '10.0.0.9' }]) })
    await request(srv.app).patch('/api/config').send({ atem: { enabled: true, ip: '10.0.0.5' } }).expect(200)
    await srv.start()
    expect(atem.connect).toHaveBeenLastCalledWith('10.0.0.5')
  })
  it('stops idempotently and shuts the listening port', async () => {
    const { srv, output } = await setup(); await srv.start()
    const port = srv.port; await Promise.all([srv.stop(), srv.stop()])
    await expect(fetch('http://127.0.0.1:' + port + '/status')).rejects.toThrow()
    expect(output.ready).toBe(false)
  })
})
