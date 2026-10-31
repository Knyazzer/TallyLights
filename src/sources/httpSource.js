import express from 'express'
import { fileURLToPath } from 'node:url'

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url))
export function createApp({ controller, getConfig, saveConfigFn, listPorts, scanAtem, getAtemInputs, testLamp, stopTests, getStatus, subscribe, reconnectSerial }) {
  const app = express()
  app.use(express.json({ limit: '32kb' }))
  const snapshot = () => ({ lamps: controller.computeLampStates(), connections: getStatus(), inputs: getAtemInputs?.() || [] })
  app.get('/status', (_req, res) => res.json(snapshot()))
  const clients = new Set()
  const broadcast = () => { const message = `data: ${JSON.stringify(snapshot())}\n\n`; for (const client of clients) client.write(message) }
  controller.on('change', broadcast)
  const unsubscribe = subscribe?.(broadcast)
  app.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.flushHeaders()
    clients.add(res)
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`)
    req.on('close', () => clients.delete(res))
  })
  app.locals.dispose = () => {
    controller.off('change', broadcast); unsubscribe?.()
    for (const client of clients) client.end()
    clients.clear()
  }
  app.get('/api/config', (_req, res) => res.json(getConfig()))
  const save = async (req, res) => {
    try { res.json(await saveConfigFn(req.body)) } catch (e) { res.status(422).json({ error: e.message }) }
  }
  app.put('/api/config', save)
  app.patch('/api/config', save)
  const asyncRoute = fn => async (req, res) => {
    try { res.json(await fn(req)) } catch (e) { res.status(e.status || 500).json({ error: e.message }) }
  }
  app.get('/api/ports', asyncRoute(() => listPorts()))
  app.get('/api/atem/scan', asyncRoute(() => scanAtem()))
  app.get('/api/atem/inputs', (_req, res) => res.json(getAtemInputs?.() || []))
  app.post('/api/serial/reconnect', asyncRoute(async () => { await reconnectSerial(); return { ok: true } }))
  app.post('/api/test/stop', asyncRoute(async () => { stopTests(); return { ok: true } }))
  app.post('/api/test/lamp/:id', asyncRoute(async req => {
    const id = Number(req.params.id), color = req.query.color || 'program'
    if (!Number.isInteger(id) || !getConfig().lamps.some(l => l.id === id) || !['program', 'preview'].includes(color)) {
      const e = new Error('Unknown lamp or test color'); e.status = 400; throw e
    }
    if (!getStatus().com) { const e = new Error('COM-порт не подключён'); e.status = 409; throw e }
    await testLamp(id, color)
    return { ok: true }
  }))
  app.use(express.static(PUBLIC_DIR))
  return app
}
