import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig } from './config.js'
import { TallyController } from './tallyController.js'
import { FirmataOutput } from './output/firmataOutput.js'
import { AtemSource } from './sources/atemSource.js'
import { listInterfaces, hostsForSubnet, scan } from './sources/atemDiscovery.js'
import { createApp } from './sources/httpSource.js'
import { diffRestartFields } from './diffRestartFields.js'
import { log } from './logger.js'

// NOTE: 'serialport' is NOT imported at the top level — its native bindings
// would crash at parse time in environments where native modules cannot be
// rebuilt (CI, test, non-hardware machines). It is lazily imported inside
// the listPorts helper that is only called at runtime via HTTP.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const CONFIG_PATH = path.join(ROOT, 'config.json')
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json')

/**
 * Lazily import SerialPort and return a port listing.
 * Dynamic import keeps the native binding out of module parse time so that
 * tests (and any other importer) can load index.js without native modules.
 */
async function listSerialPorts() {
  const { SerialPort } = await import('serialport')
  return SerialPort.list()
}

/**
 * Assemble the application from its modules.
 *
 * @param {object} cfg              - validated config object
 * @param {object} [opts]
 * @param {function} [opts.outputFactory]  - inject a fake FirmataOutput for tests
 * @param {function} [opts.atemFactory]    - inject a fake Atem client for tests
 * @param {string}   [opts.configPath]     - override config file path (tests)
 * @returns {Promise<{app, controller, output, atemSource, start(), stop()}>}
 */
export async function createServer(cfg, opts = {}) {
  const { outputFactory, atemFactory, configPath = CONFIG_PATH, saveConfigImpl = saveConfig } = opts

  // The currently running config. Reassigned on every successful save so that
  // getConfig() and restart-field diffs always compare against live state.
  let currentCfg = cfg

  // ── Controller ──────────────────────────────────────────────────────────────
  const controller = new TallyController({
    lamps: cfg.lamps,
    defaultMode: cfg.defaultMode,
    onAtemDisconnect: cfg.onAtemDisconnect
  })

  // ── Output (Firmata over COM) ────────────────────────────────────────────────
  const output = outputFactory
    ? outputFactory()
    : new FirmataOutput({ comPort: cfg.comPort, baudRate: cfg.baudRate, lamps: cfg.lamps })

  // Wire render events → hardware output
  controller.on('render', (states) => output.render(states))

  // ── ATEM source ─────────────────────────────────────────────────────────────
  const atemSource = new AtemSource({ ip: cfg.atem.ip, atemFactory })

  atemSource.on('tally', (t) => controller.updateAtem(t))
  atemSource.on('status', (s) => {
    if (s === 'disconnected') controller.atemDisconnected()
  })
  atemSource.on('error', (e) => log.warn('atem error:', e?.message || e))

  // ── Connection status tracking ───────────────────────────────────────────────
  const status = { atem: false, com: false }
  atemSource.on('status', (s) => { status.atem = s === 'connected' })

  // ── Express app ─────────────────────────────────────────────────────────────
  const app = createApp({
    controller,
    getConfig: () => currentCfg,
    saveConfigFn: (next) => {
      // Persist + validate first (throws on invalid → HTTP layer maps to 422).
      saveConfigImpl(configPath, next)
      // Hybrid hot-apply: the lamp map and onAtemDisconnect take effect live;
      // comPort / baudRate / atem.ip / http.port require a restart.
      const restartFields = diffRestartFields(currentCfg, next)
      controller.setLamps(next.lamps)
      if (typeof output.setLamps === 'function') output.setLamps(next.lamps)
      controller.onAtemDisconnect = next.onAtemDisconnect
      currentCfg = next
      return { ...next, restartRequired: restartFields.length > 0, restartFields }
    },
    // listPorts: lazy import to avoid loading native serialport at module parse time
    listPorts: () => listSerialPorts(),
    scanAtem: async () => {
      const ifaces = listInterfaces()
      const all = []
      for (const iface of ifaces) {
        const hosts = hostsForSubnet(iface.address, iface.netmask)
        const found = await scan({ hosts })
        all.push(...found)
      }
      return all
    },
    testLamp: async (id, color) => {
      const lamp = currentCfg.lamps.find(l => l.id === id)
      if (!lamp) {
        log.warn(`testLamp: unknown lamp id ${id}`)
        return
      }
      output.render([{
        id,
        activePin: lamp.activePin,
        previewPin: lamp.previewPin,
        program: color === 'program',
        preview: color === 'preview'
      }])
    },
    getStatus: () => ({ atem: status.atem, com: !!output.ready })
  })

  // ── Server handle (for graceful HTTP shutdown) ───────────────────────────────
  let httpServer = null

  return {
    app,
    controller,
    output,
    atemSource,

    async start() {
      // Connect to COM port; failure is logged but never crashes the process.
      try {
        await output.connect()
      } catch (e) {
        log.error('COM connect failed:', e?.message || e)
      }

      // Start ATEM polling only when enabled in config.
      if (cfg.atem.enabled) {
        try {
          atemSource.start()
        } catch (e) {
          log.error('ATEM start failed:', e?.message || e)
        }
      }

      // Start HTTP server when enabled.
      if (cfg.http.enabled) {
        await new Promise((resolve) => {
          httpServer = app.listen(cfg.http.port, resolve)
        })
        log.info(`HTTP on :${cfg.http.port}`)
      }
    },

    async stop() {
      // Close HTTP server first so no new requests come in.
      if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve))
        httpServer = null
      }
      // Stop ATEM (disconnect); ignore errors during shutdown.
      await atemSource.stop().catch(() => {})
      // Set all pins LOW and close the serial port.
      await output.close().catch(() => {})
    }
  }
}

// ── Entrypoint ──────────────────────────────────────────────────────────────
// Only execute when this file is run directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const cfg = loadConfig(CONFIG_PATH, EXAMPLE_PATH)
  const srv = await createServer(cfg)
  await srv.start()

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('shutting down…')
    await srv.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
