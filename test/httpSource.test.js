import { describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import request from 'supertest'
import { TallyController } from '../src/tallyController.js'
import { createApp } from '../src/sources/httpSource.js'

const lamps = [{ id: 1, atemInput: 1, previewPin: 2, activePin: 3 }]

function makeApp(over = {}) {
  const controller = new TallyController({ lamps, defaultMode: 'atem', onAtemDisconnect: 'hold' })
  const deps = {
    controller,
    getConfig: () => ({ comPort: 'COM5', lamps }),
    saveConfigFn: vi.fn((cfg) => cfg),
    listPorts: vi.fn(async () => [{ path: 'COM5' }]),
    scanAtem: vi.fn(async () => [{ ip: '192.168.10.240' }]),
    testLamp: vi.fn(async () => {}),
    getStatus: () => ({ atem: false, com: false }),
    ...over
  }
  return { app: createApp(deps), controller, deps }
}

describe('httpSource', () => {
  // ── mode ──────────────────────────────────────────────────────────────────
  it('switches mode via POST /mode/:mode', async () => {
    const { app, controller } = makeApp()
    await request(app).post('/mode/manual').expect(200)
    expect(controller.getMode()).toBe('manual')
  })

  it('POST /mode/:mode returns { mode }', async () => {
    const { app } = makeApp()
    const res = await request(app).post('/mode/manual').expect(200)
    expect(res.body).toEqual({ mode: 'manual' })
  })

  it('POST /mode/invalid returns 400', async () => {
    const { app } = makeApp()
    await request(app).post('/mode/whatever').expect(400)
  })

  it('GET /mode returns current mode', async () => {
    const { app } = makeApp()
    const res = await request(app).get('/mode').expect(200)
    expect(res.body).toEqual({ mode: 'atem' })
  })

  it('GET /api/atem/inputs returns the injected ATEM input list', async () => {
    const inputs = [{ id: 1, name: 'CAM 1' }, { id: 2, name: 'CAM 2' }]
    const { app } = makeApp({ getAtemInputs: () => inputs })
    const res = await request(app).get('/api/atem/inputs').expect(200)
    expect(res.body).toEqual(inputs)
  })

  it('GET /api/atem/inputs returns [] when no provider wired', async () => {
    const { app } = makeApp()
    const res = await request(app).get('/api/atem/inputs').expect(200)
    expect(res.body).toEqual([])
  })

  // ── tally commands ─────────────────────────────────────────────────────────
  it('rejects tally commands when not in manual mode (409)', async () => {
    const { app } = makeApp()
    await request(app).post('/program/1').expect(409)
  })

  it('rejects preview command when not in manual mode (409)', async () => {
    const { app } = makeApp()
    await request(app).post('/preview/1').expect(409)
  })

  it('rejects off command when not in manual mode (409)', async () => {
    const { app } = makeApp()
    await request(app).post('/off/1').expect(409)
  })

  it('rejects clear when not in manual mode (409)', async () => {
    const { app } = makeApp()
    await request(app).post('/clear').expect(409)
  })

  it('accepts tally program command in manual mode', async () => {
    const { app, controller } = makeApp()
    controller.setMode('manual')
    await request(app).post('/program/1').expect(200)
    expect(controller.computeLampStates().find(l => l.id === 1).program).toBe(true)
  })

  it('accepts tally preview command in manual mode', async () => {
    const { app, controller } = makeApp()
    controller.setMode('manual')
    await request(app).post('/preview/1').expect(200)
    expect(controller.computeLampStates().find(l => l.id === 1).preview).toBe(true)
  })

  it('accepts tally off command in manual mode', async () => {
    const { app, controller } = makeApp()
    controller.setMode('manual')
    // first set to program
    controller.manualSet(1, 'program')
    await request(app).post('/off/1').expect(200)
    const lamp = controller.computeLampStates().find(l => l.id === 1)
    expect(lamp.program).toBe(false)
    expect(lamp.preview).toBe(false)
  })

  it('accepts clear in manual mode', async () => {
    const { app, controller } = makeApp()
    controller.setMode('manual')
    controller.manualSet(1, 'program')
    await request(app).post('/clear').expect(200)
    expect(controller.computeLampStates().find(l => l.id === 1).program).toBe(false)
  })

  it('400 on non-numeric input', async () => {
    const { app, controller } = makeApp()
    controller.setMode('manual')
    await request(app).post('/program/abc').expect(400)
  })

  it('400 on NaN input (empty string-like path)', async () => {
    const { app, controller } = makeApp()
    controller.setMode('manual')
    await request(app).post('/off/NaN').expect(400)
  })

  // ── status ─────────────────────────────────────────────────────────────────
  it('returns status JSON with mode and lamps', async () => {
    const { app } = makeApp()
    const res = await request(app).get('/status').expect(200)
    expect(res.body).toHaveProperty('mode')
    expect(res.body).toHaveProperty('lamps')
    expect(res.body).toHaveProperty('connections')
  })

  it('status connections reflects getStatus()', async () => {
    const { app } = makeApp({ getStatus: () => ({ atem: true, com: true }) })
    const res = await request(app).get('/status').expect(200)
    expect(res.body.connections).toEqual({ atem: true, com: true })
  })

  // ── admin API ──────────────────────────────────────────────────────────────
  it('GET /api/config returns config', async () => {
    const { app } = makeApp()
    const res = await request(app).get('/api/config').expect(200)
    expect(res.body).toHaveProperty('comPort', 'COM5')
    expect(res.body).toHaveProperty('lamps')
  })

  it('lists serial ports via GET /api/ports', async () => {
    const { app } = makeApp()
    const res = await request(app).get('/api/ports').expect(200)
    expect(res.body).toEqual([{ path: 'COM5' }])
  })

  it('scans for ATEM via GET /api/atem/scan', async () => {
    const { app } = makeApp()
    const res = await request(app).get('/api/atem/scan').expect(200)
    expect(res.body).toEqual([{ ip: '192.168.10.240' }])
  })

  it('saves config and returns saved value (200)', async () => {
    const saveConfigFn = vi.fn((cfg) => {
      if (!cfg.ok) throw new Error('bad')
      return cfg
    })
    const { app } = makeApp({ saveConfigFn })
    const res = await request(app).put('/api/config').send({ ok: true }).expect(200)
    expect(res.body).toEqual({ ok: true })
    expect(saveConfigFn).toHaveBeenCalledWith({ ok: true })
  })

  it('rejects invalid config with 422', async () => {
    const saveConfigFn = vi.fn((cfg) => {
      if (!cfg.ok) throw new Error('bad')
      return cfg
    })
    const { app } = makeApp({ saveConfigFn })
    const res = await request(app).put('/api/config').send({ ok: false }).expect(422)
    expect(res.body).toHaveProperty('error')
  })

  it('POST /api/test/lamp/:id calls testLamp', async () => {
    const testLamp = vi.fn(async () => {})
    const { app } = makeApp({ testLamp })
    await request(app).post('/api/test/lamp/1').expect(200)
    expect(testLamp).toHaveBeenCalledWith(1, 'program')
  })

  it('POST /api/test/lamp/:id uses color query param', async () => {
    const testLamp = vi.fn(async () => {})
    const { app } = makeApp({ testLamp })
    await request(app).post('/api/test/lamp/2?color=preview').expect(200)
    expect(testLamp).toHaveBeenCalledWith(2, 'preview')
  })

  // ── SSE ────────────────────────────────────────────────────────────────────
  it('GET /events returns SSE headers and initial data', async () => {
    const { app } = makeApp()
    const server = app.listen(0)
    const port = server.address().port
    await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/events`, (res) => {
        try {
          expect(res.headers['content-type']).toMatch(/text\/event-stream/)
        } catch (e) {
          req.destroy()
          return reject(e)
        }
        let buf = ''
        res.on('data', (chunk) => {
          buf += chunk.toString()
          const match = buf.match(/^data: (.+)\n\n/m)
          if (match) {
            try {
              const payload = JSON.parse(match[1])
              expect(payload).toHaveProperty('mode')
              expect(payload).toHaveProperty('lamps')
              resolve()
            } catch (e) {
              reject(e)
            } finally {
              req.destroy()
            }
          }
        })
        res.on('error', reject)
      })
      req.on('error', reject)
    })
    await new Promise((resolve) => server.close(resolve))
  }, 8000)
})
