import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { TallyController } from '../src/tallyController.js'
import { createApp } from '../src/sources/httpSource.js'

describe('static admin UI', () => {
  it('serves index.html at /', async () => {
    const controller = new TallyController({ lamps: [{ id: 1, atemInput: 1, previewPin: 2, activePin: 3 }], defaultMode: 'atem' })
    const app = createApp({
      controller,
      getConfig: () => ({}), saveConfigFn: (c) => c,
      listPorts: async () => [], scanAtem: async () => [],
      testLamp: async () => {}, getStatus: () => ({ atem: false, com: false })
    })
    const res = await request(app).get('/').expect(200)
    expect(res.text).toContain('TallyLights')
  })
})
