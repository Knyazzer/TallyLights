import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, saveConfig } from './config.js'
import { TallyController } from './tallyController.js'
import { FirmataOutput } from './output/firmataOutput.js'
import { AtemSource } from './sources/atemSource.js'
import { listInterfaces, hostsForSubnet, scan, chooseAtemIp } from './sources/atemDiscovery.js'
import { createApp } from './sources/httpSource.js'
import { diffRestartFields } from './diffRestartFields.js'
import { withPins } from './lampPins.js'
import { log } from './logger.js'

// NOTE: 'serialport' is NOT imported at the top level — its native bindings
// would crash at parse time in environments where native modules cannot be
// rebuilt (CI, test, non-hardware machines). It is lazily imported inside
// the listPorts helper that is only called at runtime via HTTP.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

// Where the live, writable config.json lives. When the app is installed under a
// read-only location (Program Files), fall back to %APPDATA%\TallyLights so the
// config (and the auto-discovered ATEM ip) can be saved. In a dev checkout the
// project root is writable, so it stays there. Override with TALLY_DATA_DIR.
function resolveDataDir(root) {
  if (process.env.TALLY_DATA_DIR) return process.env.TALLY_DATA_DIR
  try { fs.accessSync(root, fs.constants.W_OK); return root } catch { /* read-only */ }
  const base = process.env.APPDATA || process.env.HOME || root
  return path.join(base, 'TallyLights')
}
const DATA_DIR = resolveDataDir(ROOT)
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
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

// Best-effort: briefly connect to an ATEM to read its product name, then drop.
// Resolves null if it can't be read within timeoutMs. Used only by network scan.
async function atemProductName(ip, timeoutMs = 2500) {
  const { Atem } = await import('atem-connection')
  const a = new Atem()
  return new Promise((resolve) => {
    let done = false
    const finish = (name) => { if (done) return; done = true; try { a.disconnect() } catch { /* ignore */ } resolve(name) }
    a.on('error', () => {})
    const grab = () => { const n = a.state?.info?.productIdentifier; if (n) finish(n) }
    a.on('connected', grab)
    a.on('stateChanged', grab)
    setTimeout(() => finish(null), timeoutMs)
    try { a.connect(ip) } catch { finish(null) }
  })
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
// Duration (ms) the test-lamp pulse stays lit before restoring real states.
// Overridable via opts.testPulseMs for tests (avoids real 1 s timers).
const DEFAULT_TEST_PULSE_MS = 1000

export async function createServer(cfg, opts = {}) {
  const { outputFactory, atemFactory, configPath = CONFIG_PATH, saveConfigImpl = saveConfig, testPulseMs = DEFAULT_TEST_PULSE_MS } = opts

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
      // Hybrid hot-apply: lamp map, onAtemDisconnect AND the ATEM connection take
      // effect live; comPort / baudRate / http.port require a restart.
      const restartFields = diffRestartFields(currentCfg, next)
      // Attach hardcoded pins by lamp id (UI only sends {id, atemInput}).
      const resolved = { ...next, lamps: next.lamps.map(withPins) }
      controller.setLamps(resolved.lamps)
      if (typeof output.setLamps === 'function') output.setLamps(resolved.lamps)
      controller.onAtemDisconnect = next.onAtemDisconnect
      // Reconnect the ATEM live when its ip / enabled changed (no restart needed).
      const atemChanged = next.atem?.ip !== currentCfg.atem?.ip || next.atem?.enabled !== currentCfg.atem?.enabled
      currentCfg = resolved
      if (atemChanged && typeof atemSource.reconnect === 'function') {
        Promise.resolve(atemSource.reconnect(next.atem?.enabled ? next.atem?.ip : null))
          .catch(e => log.warn('atem reconnect failed:', e?.message || e))
      }
      return { ...next, restartRequired: restartFields.length > 0, restartFields }
    },
    // listPorts: lazy import to avoid loading native serialport at module parse time
    listPorts: () => listSerialPorts(),
    scanAtem: async () => {
      const ifaces = listInterfaces()
      const found = []
      for (const iface of ifaces) {
        const hosts = hostsForSubnet(iface.address, iface.netmask)
        found.push(...await scan({ hosts }))
      }
      // Best-effort: read each switcher's product name so several ATEMs in the
      // network can be told apart. Name is null if it can't be read in time.
      const out = []
      for (const d of found) out.push({ ip: d.ip, name: await atemProductName(d.ip).catch(() => null) })
      return out
    },
    getAtemInputs: () => atemSource.getInputs(),
    testLamp: async (id, color) => {
      const lamp = currentCfg.lamps.find(l => l.id === id)
      if (!lamp) {
        log.warn(`testLamp: unknown lamp id ${id}`)
        return
      }
      // Momentary pulse: light the lamp for testPulseMs, then restore real states.
      output.render([{
        id,
        activePin: lamp.activePin,
        previewPin: lamp.previewPin,
        program: color === 'program',
        preview: color === 'preview'
      }])
      setTimeout(() => {
        output.render(controller.computeLampStates())
      }, testPulseMs)
    },
    getStatus: () => ({ atem: status.atem, com: !!output.ready, atemName: atemSource.getInfo?.().name || null })
  })

  // ── Server handle (for graceful HTTP shutdown) ───────────────────────────────
  let httpServer = null
  let atemTimers = []
  let discovering = false

  // Discover ATEM ips across all local subnets (raw, ip-only scan).
  async function discoverAtemIps() {
    const ips = []
    for (const iface of listInterfaces()) {
      const found = await scan({ hosts: hostsForSubnet(iface.address, iface.netmask) })
      for (const f of found) if (!ips.includes(f.ip)) ips.push(f.ip)
    }
    return ips
  }

  // Auto-connect: while the ATEM isn't connected, scan the network and connect
  // to a discovered switcher (preferring the last-known ip). Lets the app work
  // in any local network with no hand-edited ip; persists the working ip.
  async function ensureAtem() {
    if (!currentCfg.atem?.enabled || status.atem || discovering) return
    discovering = true
    try {
      const found = await discoverAtemIps()
      if (status.atem) return
      const ip = chooseAtemIp(found, currentCfg.atem?.ip)
      if (!ip) return
      if (ip !== currentCfg.atem?.ip) {
        currentCfg = { ...currentCfg, atem: { ...currentCfg.atem, ip } }
        try { saveConfigImpl(configPath, currentCfg) } catch (e) { log.warn('persist atem ip failed:', e?.message || e) }
      }
      log.info(`ATEM auto-discovery → connecting ${ip}`)
      await atemSource.reconnect(ip)
    } catch (e) {
      log.warn('ATEM auto-discovery failed:', e?.message || e)
    } finally {
      discovering = false
    }
  }

  return {
    app,
    controller,
    output,
    atemSource,

    async start() {
      // Start HTTP first so the admin UI is reachable even when COM/ATEM are
      // down — the operator can then fix the port/IP from the browser.
      if (cfg.http.enabled) {
        await new Promise((resolve) => {
          httpServer = app.listen(cfg.http.port, resolve)
        })
        log.info(`HTTP on :${cfg.http.port}`)
      }

      // Connect to the COM port in the background; a failure (wrong port or a
      // non-Firmata device) is logged and must never block or crash startup.
      output.connect().catch((e) => log.error('COM connect failed:', e?.message || e))

      // Start ATEM polling only when enabled; a start error is logged, never fatal.
      if (cfg.atem.enabled) {
        try {
          atemSource.start()
        } catch (e) {
          log.error('ATEM start failed:', e?.message || e)
        }
        // Fall back to network auto-discovery if the configured ip doesn't
        // connect, and keep retrying while disconnected (new network / late power-on).
        const t1 = setTimeout(ensureAtem, 5000); t1.unref?.()
        const t2 = setInterval(ensureAtem, 15000); t2.unref?.()
        atemTimers.push(t1, t2)
      }
    },

    async stop() {
      for (const t of atemTimers) clearInterval(t)
      atemTimers = []
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
// pathToFileURL canonicalises argv[1] to the same form as import.meta.url on
// every platform (file:///C:/… on Windows, file:///… on POSIX) — a hand-built
// `file://` + path string does NOT match on Windows (file:// vs file:///).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const cfg = loadConfig(CONFIG_PATH, EXAMPLE_PATH)
  const srv = await createServer(cfg)
  await srv.start()

  // Open the admin UI in the default browser (disable with TALLY_NO_OPEN=1).
  if (cfg.http.enabled && !process.env.TALLY_NO_OPEN) {
    const url = `http://localhost:${cfg.http.port}`
    try {
      const { spawn } = await import('node:child_process')
      if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
      else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    } catch { /* ignore */ }
  }

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
