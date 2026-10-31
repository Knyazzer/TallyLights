import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/sources/httpSource.js'
import { TallyController } from '../src/tallyController.js'
function setup() {
  const testLamp = vi.fn(), save = vi.fn(async c => c)
  const controller = new TallyController({ lamps: [{ id: 1, atemInput: 1 }] })
  const app = createApp({ controller, getConfig: () => ({ lamps: [{ id: 1 }] }), saveConfigFn: save,
    listPorts: async () => [], scanAtem: async () => [{ ip: '10.0.0.2', name: 'ATEM Mini' }],
    getAtemInputs: () => [{ id: 1, name: 'CAM 1' }], testLamp, stopTests: () => controller.clearTests(),
    reconnectSerial: async () => {}, getStatus: () => ({ atem: false, com: true }) })
  return { app, testLamp, save }
}
describe('device and test API', () => {
  it('exposes lamp, connection, and input status together', async () => {
    const { app } = setup(); const { body } = await request(app).get('/status').expect(200)
    expect(body.inputs).toEqual([{ id: 1, name: 'CAM 1' }]); expect(body.connections.com).toBe(true)
    expect(body).not.toHaveProperty('mode')
  })
  it('removes watchdog and manual routes', async () => {
    const { app } = setup()
    for (const route of ['/health', '/routes', '/mode']) await request(app).get(route).expect(404)
    for (const route of ['/mode/manual', '/program/1', '/preview/1', '/off/1', '/clear']) await request(app).post(route).expect(404)
  })
  it('awaits asynchronous saves and reports errors', async () => {
    const { app, save } = setup()
    await request(app).patch('/api/config').send({ comPort: 'auto' }).expect(200)
    expect(save).toHaveBeenCalledWith({ comPort: 'auto' })
    save.mockRejectedValueOnce(new Error('bad config'))
    expect((await request(app).put('/api/config').send({}).expect(422)).body.error).toBe('bad config')
  })
  it('validates test ids and colors before touching hardware', async () => {
    const { app, testLamp } = setup()
    await request(app).post('/api/test/lamp/1?color=preview').expect(200)
    expect(testLamp).toHaveBeenCalledWith(1, 'preview')
    for (const route of ['/api/test/lamp/99', '/api/test/lamp/NaN', '/api/test/lamp/1?color=bad']) await request(app).post(route).expect(400)
    expect(testLamp).toHaveBeenCalledTimes(1)
  })
  it('returns discovered ATEM names and serial ports', async () => {
    const { app } = setup()
    expect((await request(app).get('/api/atem/scan').expect(200)).body[0].name).toBe('ATEM Mini')
    await request(app).get('/api/ports').expect(200)
  })
  it('closes SSE clients during disposal', async () => {
    const { app } = setup()
    const server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/events')
    const reader = response.body.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('connections')
    app.locals.dispose()
    expect((await reader.read()).done).toBe(true)
    await new Promise(resolve => server.close(resolve))
  })
})
