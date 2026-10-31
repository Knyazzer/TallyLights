import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import { loadConfig, saveConfig, normalizeConfig, validateConfig } from './config.js'
import { TallyController } from './tallyController.js'
import { FirmataOutput } from './output/firmataOutput.js'
import { SerialConnection } from './output/serialConnection.js'
import { AtemSource } from './sources/atemSource.js'
import { listInterfaces, hostsForSubnet, scan } from './sources/atemDiscovery.js'
import { createApp } from './sources/httpSource.js'
import { diffRestartFields } from './diffRestartFields.js'
import { log } from './logger.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
function dataDir() {
  if (process.env.TALLY_DATA_DIR) return process.env.TALLY_DATA_DIR
  try { fs.accessSync(ROOT, fs.constants.W_OK); return ROOT } catch {}
  return path.join(process.env.APPDATA || ROOT, 'TallyLights')
}
async function listSerialPorts() {
  const { SerialPort } = await import('serialport')
  return SerialPort.list()
}
async function productName(ip) {
  const { Atem } = await import('atem-connection')
  const atem = new Atem()
  return new Promise(resolve => {
    let done = false
    const finish = name => {
      if (done) return
      done = true; clearTimeout(timer)
      Promise.resolve(atem.destroy?.() ?? atem.disconnect()).catch(() => {})
      resolve(name)
    }
    const grab = () => { const name = atem.state?.info?.productIdentifier; if (name) finish(name) }
    const timer = setTimeout(() => finish(null), 2000)
    atem.on('error', () => finish(null))
    atem.on('connected', grab); atem.on('stateChanged', grab)
    Promise.resolve(atem.connect(ip)).catch(() => finish(null))
  })
}
export async function createServer(cfg, opts = {}) {
  let currentCfg = normalizeConfig(cfg)
  const { outputFactory, atemFactory, configPath = path.join(dataDir(), 'config.json'),
    saveConfigImpl = saveConfig, testPulseMs = 1000, listPorts = listSerialPorts,
    scanNetwork, serialRetryMs = 2000 } = opts
  const controller = new TallyController(currentCfg)
  const output = outputFactory ? outputFactory() : new FirmataOutput(currentCfg)
  const atemSource = new AtemSource({ ip: currentCfg.atem.ip, me: currentCfg.atem.me, atemFactory })
  const events = new EventEmitter()
  const notify = () => events.emit('status')
  const serial = new SerialConnection({ output, listPorts, getStates: () => controller.computeLampStates(), retryMs: serialRetryMs })
  serial.on('change', notify)
  controller.on('render', states => output.render(states))
  atemSource.on('tally', tally => controller.updateAtem(tally))
  atemSource.on('status', status => {
    if (status === 'disconnected') controller.atemDisconnected()
    notify()
  })
  atemSource.on('error', e => { log.warn('ATEM:', e?.message || e); notify() })
  let running = false, httpServer = null, atemTimer = null, scanPromise = null, revision = 0
  const testTimers = new Map()
  const stopTests = () => {
    for (const timer of testTimers.values()) clearTimeout(timer)
    testTimers.clear(); controller.clearTests()
  }
  async function scanAtem() {
    if (scanPromise) return scanPromise
    scanPromise = (async () => {
      if (scanNetwork) return scanNetwork()
      const found = await Promise.all(listInterfaces().map(iface =>
        scan({ hosts: hostsForSubnet(iface.address, iface.netmask) })))
      const ips = [...new Set(found.flat().map(d => d.ip))]
      return Promise.all(ips.map(async ip => ({ ip, name: ip === atemSource.ip && atemSource.connected
        ? atemSource.getInfo().name : await productName(ip) })))
    })()
    try { return await scanPromise } finally { scanPromise = null }
  }
  async function ensureAtem() {
    if (!running || !currentCfg.atem.enabled || atemSource.connected) return
    // An explicitly selected IP stays selected. atem-connection retries it.
    if (currentCfg.atem.ip) return
    const rev = revision
    try {
      const found = await scanAtem()
      if (!running || rev !== revision || atemSource.connected || found.length !== 1) return
      const next = normalizeConfig({ ...currentCfg, atem: { ...currentCfg.atem, ip: found[0].ip } })
      saveConfigImpl(configPath, next)
      currentCfg = next
      await atemSource.reconnect(next.atem.ip)
      notify()
    } catch (e) { log.warn('ATEM discovery:', e.message) }
  }
  let saveQueue = Promise.resolve()
  function applyConfig(patch) {
    const task = saveQueue.then(async () => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Expected config object')
      const next = normalizeConfig({ ...currentCfg, ...patch,
        atem: { ...currentCfg.atem, ...patch.atem }, http: { ...currentCfg.http, ...patch.http } })
      const errors = validateConfig(next)
      if (errors.length) throw new Error(errors.join('\n'))
      const sameAtem = next.atem.ip === currentCfg.atem.ip && next.atem.enabled === currentCfg.atem.enabled
      if (patch.atem?.me !== undefined && sameAtem && atemSource.connected && atemSource.getMixEffects().length && !atemSource.getMixEffects().some(bank => bank.id === next.atem.me)) {
        throw new Error(`M/E ${next.atem.me} недоступен на подключённом ATEM`)
      }
      saveConfigImpl(configPath, next)
      const restartFields = diffRestartFields(currentCfg, next)
      const serialChanged = next.comPort !== currentCfg.comPort || next.baudRate !== currentCfg.baudRate
      const atemChanged = !sameAtem
      const meChanged = next.atem.me !== currentCfg.atem.me
      const lampsChanged = JSON.stringify(next.lamps) !== JSON.stringify(currentCfg.lamps)
      currentCfg = next
      ++revision
      stopTests()
      // Reinitialize hardware BEFORE the controller's render, otherwise a
      // successful map save leaves every physical lamp off until the next cut.
      if (lampsChanged) output.setLamps?.(next.lamps)
      controller.onAtemDisconnect = next.onAtemDisconnect
      controller.setLamps(next.lamps)
      if (meChanged) atemSource.setMe(next.atem.me)
      if (!atemSource.connected) controller.atemDisconnected()
      if (serialChanged && running) await serial.configure(next)
      if (atemChanged) {
        await atemSource.reconnect(next.atem.enabled ? next.atem.ip : null)
        if (running && !next.atem.ip) void ensureAtem()
      }
      notify()
      return { ...next, restartRequired: restartFields.length > 0, restartFields }
    })
    saveQueue = task.catch(() => {})
    return task
  }
  const app = createApp({
    controller, getConfig: () => currentCfg, saveConfigFn: applyConfig,
    listPorts, scanAtem, getAtemInputs: () => atemSource.connected ? atemSource.getInputs() : [],
    getStatus: () => ({ atem: atemSource.connected, atemIp: atemSource.ip,
      atemName: atemSource.connected ? atemSource.getInfo().name : null, atemError: atemSource.error || null,
      atemMe: currentCfg.atem.me, mixEffects: atemSource.connected ? atemSource.getMixEffects() : [],
      com: !!output.ready, serial: { ...serial.state }, baudRate: currentCfg.baudRate }),
    subscribe: fn => { events.on('status', fn); return () => events.off('status', fn) },
    reconnectSerial: () => serial.configure(currentCfg),
    stopTests,
    testLamp: (id, color) => {
      clearTimeout(testTimers.get(id))
      controller.testLamp(id, color)
      testTimers.set(id, setTimeout(() => { testTimers.delete(id); controller.endTest(id) }, testPulseMs))
    }
  })
  let stopping = null
  return {
    app, controller, output, atemSource, serial,
    get port() { return httpServer?.address()?.port },
    async start() {
      if (running) return
      running = true
      try {
        if (currentCfg.http.enabled || opts.desktop) {
          httpServer = await new Promise((resolve, reject) => {
            const server = app.listen(opts.desktop ? 0 : currentCfg.http.port, '127.0.0.1', () => resolve(server))
            server.once('error', reject)
          })
        }
      } catch (e) { running = false; throw e }
      void serial.start(currentCfg).catch(e => log.warn('COM:', e.message))
      if (currentCfg.atem.enabled) atemSource.start()
      atemTimer = setInterval(ensureAtem, 15000); atemTimer.unref?.()
      void ensureAtem()
    },
    stop() {
      if (stopping) return stopping
      running = false; ++revision
      clearInterval(atemTimer)
      app.locals.dispose()
      stopping = (async () => {
        await saveQueue
        stopTests()
        await Promise.allSettled([atemSource.stop(), serial.stop()])
        if (httpServer) await new Promise(resolve => httpServer.close(resolve))
        httpServer = null
      })()
      return stopping
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let srv
  try {
    const dir = dataDir()
    fs.mkdirSync(dir, { recursive: true })
    const cfg = loadConfig(path.join(dir, 'config.json'), path.join(ROOT, 'config.example.json'))
    const desktop = process.argv.includes('--desktop')
    srv = await createServer(cfg, { desktop })
    let quitting = false
    const shutdown = async () => {
      if (quitting) return
      quitting = true
      await srv.stop()
      process.exit(0)
    }
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
    if (desktop) {
      const commands = createInterface({ input: process.stdin })
      commands.on('line', line => { if (line === 'shutdown') void shutdown() })
      commands.on('close', () => void shutdown())
    }
    await srv.start()
    console.log('TALLY_READY ' + JSON.stringify({ port: srv.port }))
  } catch (e) {
    log.error(e.stack || e.message)
    await srv?.stop()
    process.exitCode = 1
  }
}
