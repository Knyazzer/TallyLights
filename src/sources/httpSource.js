import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public')

/**
 * Create the Express app (no listen — callers do that).
 *
 * @param {object} deps
 * @param {import('../tallyController.js').TallyController} deps.controller
 * @param {() => object}                deps.getConfig     - returns current config object
 * @param {(cfg: object) => object}     deps.saveConfigFn  - saves; throws on validation error
 * @param {() => Promise<object[]>}     deps.listPorts     - e.g. serialport.SerialPort.list()
 * @param {() => Promise<{ip:string}[]>} deps.scanAtem     - network scan for ATEMs
 * @param {(id:number, color:string) => Promise<void>} deps.testLamp
 * @param {() => {atem:boolean, com:boolean}} deps.getStatus
 * @returns {import('express').Express}
 */
export function createApp({ controller, getConfig, saveConfigFn, listPorts, scanAtem, getAtemInputs, testLamp, getStatus }) {
  const app = express()
  app.use(express.json())

  // ── mode ────────────────────────────────────────────────────────────────────
  app.post('/mode/:mode', (req, res) => {
    try {
      controller.setMode(req.params.mode)
      res.json({ mode: controller.getMode() })
    } catch (e) {
      res.status(400).json({ error: e.message })
    }
  })

  app.get('/mode', (req, res) => {
    res.json({ mode: controller.getMode() })
  })

  // ── tally commands (manual mode only) ──────────────────────────────────────
  function requireManual(req, res) {
    if (controller.getMode() !== 'manual') {
      res.status(409).json({ error: 'server not in manual mode' })
      return false
    }
    return true
  }

  function parseInput(req, res) {
    const input = Number(req.params.input)
    if (!Number.isFinite(input) || !Number.isInteger(input)) {
      res.status(400).json({ error: 'invalid input: must be an integer' })
      return null
    }
    return input
  }

  function tallyHandler(state) {
    return (req, res) => {
      if (!requireManual(req, res)) return
      const input = parseInput(req, res)
      if (input === null) return
      controller.manualSet(input, state)
      res.json({ ok: true })
    }
  }

  app.post('/program/:input', tallyHandler('program'))
  app.post('/preview/:input', tallyHandler('preview'))
  app.post('/off/:input', tallyHandler('off'))

  app.post('/clear', (req, res) => {
    if (!requireManual(req, res)) return
    controller.manualClear()
    res.json({ ok: true })
  })

  // ── status ──────────────────────────────────────────────────────────────────
  app.get('/status', (req, res) => {
    res.json({
      mode: controller.getMode(),
      lamps: controller.computeLampStates(),
      connections: getStatus()
    })
  })

  // ── SSE /events ─────────────────────────────────────────────────────────────
  app.get('/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.flushHeaders()

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)

    // send current state immediately
    send({ mode: controller.getMode(), lamps: controller.computeLampStates(), connections: getStatus() })

    const onChange = (d) => send({ ...d, connections: getStatus() })
    controller.on('change', onChange)

    req.on('close', () => {
      controller.off('change', onChange)
    })
  })

  // ── admin API ────────────────────────────────────────────────────────────────
  app.get('/api/config', (req, res) => {
    res.json(getConfig())
  })

  app.put('/api/config', (req, res) => {
    try {
      const saved = saveConfigFn(req.body)
      res.json(saved)
    } catch (e) {
      res.status(422).json({ error: e.message })
    }
  })

  app.get('/api/ports', async (req, res) => {
    try {
      const ports = await listPorts()
      res.json(ports)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  app.get('/api/atem/scan', async (req, res) => {
    try {
      const devices = await scanAtem()
      res.json(devices)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  app.get('/api/atem/inputs', (req, res) => {
    try {
      res.json(getAtemInputs ? getAtemInputs() : [])
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  app.post('/api/test/lamp/:id', async (req, res) => {
    try {
      const id = Number(req.params.id)
      const color = req.query.color || 'program'
      await testLamp(id, color)
      res.json({ ok: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // ── static admin UI ──────────────────────────────────────────────────────────
  app.use(express.static(PUBLIC_DIR))

  return app
}
