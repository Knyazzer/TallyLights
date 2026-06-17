import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createServer } from '../src/index.js'

const cfg = {
  comPort: 'COMX', baudRate: 57600,
  atem: { ip: '1.2.3.4', enabled: false },
  http: { port: 0, enabled: true },
  defaultMode: 'atem', onAtemDisconnect: 'hold',
  lamps: [{ id: 1, atemInput: 1, previewPin: 2, activePin: 3 }]
}

describe('createServer', () => {
  it('wires modules and serves /status without opening real hardware', async () => {
    const srv = await createServer(cfg, {
      // inject fakes so no real hardware is touched
      outputFactory: () => ({ connect: async () => {}, render: () => {}, allOff: () => {}, close: async () => {}, ready: true }),
      atemFactory: () => ({ on: () => {}, connect: () => {}, disconnect: async () => {}, state: {} })
    })
    const res = await request(srv.app).get('/status').expect(200)
    expect(res.body.mode).toBe('atem')
    await srv.stop()
  })

  it('returns controller, output, atemSource from createServer', async () => {
    const srv = await createServer(cfg, {
      outputFactory: () => ({ connect: async () => {}, render: () => {}, allOff: () => {}, close: async () => {}, ready: true }),
      atemFactory: () => ({ on: () => {}, connect: () => {}, disconnect: async () => {}, state: {} })
    })
    expect(srv.controller).toBeDefined()
    expect(srv.output).toBeDefined()
    expect(srv.atemSource).toBeDefined()
    expect(srv.app).toBeDefined()
    await srv.stop()
  })

  it('wires controller render event to output.render', async () => {
    const rendered = []
    const srv = await createServer(cfg, {
      outputFactory: () => ({
        connect: async () => {},
        render: (states) => rendered.push(states),
        allOff: () => {},
        close: async () => {},
        ready: true
      }),
      atemFactory: () => ({ on: () => {}, connect: () => {}, disconnect: async () => {}, state: {} })
    })
    // switch to manual mode and set a tally — should trigger render
    srv.controller.setMode('manual')
    srv.controller.manualSet(1, 'program')
    expect(rendered.length).toBeGreaterThan(0)
    await srv.stop()
  })

  it('wires atemSource tally event to controller.updateAtem', async () => {
    let tallyHandler = null
    const srv = await createServer(cfg, {
      outputFactory: () => ({ connect: async () => {}, render: () => {}, allOff: () => {}, close: async () => {}, ready: true }),
      atemFactory: () => ({
        on: (event, fn) => { if (event === 'connected') tallyHandler = fn },
        connect: () => {},
        disconnect: async () => {},
        state: { video: { mixEffects: [{ programInput: 1, previewInput: 2 }] } }
      })
    })
    // Simulate connected event which calls _emitTally -> controller.updateAtem
    // (atemSource emits 'tally' on connected; controller picks it up)
    srv.atemSource.emit('tally', { program: [1], preview: [2] })
    const states = srv.controller.computeLampStates()
    expect(states[0].program).toBe(true)
    await srv.stop()
  })

  it('getStatus returns atem and com booleans', async () => {
    const srv = await createServer(cfg, {
      outputFactory: () => ({ connect: async () => {}, render: () => {}, allOff: () => {}, close: async () => {}, ready: true }),
      atemFactory: () => ({ on: () => {}, connect: () => {}, disconnect: async () => {}, state: {} })
    })
    const res = await request(srv.app).get('/status').expect(200)
    expect(typeof res.body.connections.atem).toBe('boolean')
    expect(typeof res.body.connections.com).toBe('boolean')
    await srv.stop()
  })

  it('start() does not crash when output.connect() fails', async () => {
    const srv = await createServer(cfg, {
      outputFactory: () => ({
        connect: async () => { throw new Error('no COM port') },
        render: () => {},
        allOff: () => {},
        close: async () => {},
        ready: false
      }),
      atemFactory: () => ({ on: () => {}, connect: () => {}, disconnect: async () => {}, state: {} })
    })
    // Should not throw
    await expect(srv.start()).resolves.not.toThrow()
    await srv.stop()
  })

  it('stop() closes server, stops atemSource, and closes output', async () => {
    const closed = { output: false, atem: false }
    const srv = await createServer(cfg, {
      outputFactory: () => ({
        connect: async () => {},
        render: () => {},
        allOff: () => {},
        close: async () => { closed.output = true },
        ready: true
      }),
      atemFactory: () => ({
        on: () => {},
        connect: () => {},
        disconnect: async () => { closed.atem = true },
        state: {}
      })
    })
    await srv.start()
    await srv.stop()
    expect(closed.output).toBe(true)
    // atem stop is called via atemSource.stop() which calls disconnect
    expect(closed.atem).toBe(true)
  })

  it('atemSource status=disconnected calls controller.atemDisconnected', async () => {
    const srv = await createServer({ ...cfg, onAtemDisconnect: 'clear' }, {
      outputFactory: () => ({ connect: async () => {}, render: () => {}, allOff: () => {}, close: async () => {}, ready: true }),
      atemFactory: () => ({ on: () => {}, connect: () => {}, disconnect: async () => {}, state: {} })
    })
    // Seed some atem state
    srv.controller.updateAtem({ program: [1], preview: [] })
    expect(srv.controller.computeLampStates()[0].program).toBe(true)
    // Simulate disconnected
    srv.atemSource.emit('status', 'disconnected')
    // With onAtemDisconnect: 'clear', program should clear
    expect(srv.controller.computeLampStates()[0].program).toBe(false)
    await srv.stop()
  })
})
