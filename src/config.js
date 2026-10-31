import fs from 'node:fs'
import net from 'node:net'
import { LAMP_PINS, withPins } from './lampPins.js'

export function normalizeConfig(cfg) {
  const { defaultMode, ...rest } = cfg
  return { ...rest, comPort: cfg.comPort || 'auto', baudRate: cfg.baudRate ?? 57600,
    atem: { enabled: true, ip: '', me: 1, ...cfg.atem },
    http: { enabled: true, port: 8080, ...cfg.http },
    onAtemDisconnect: cfg.onAtemDisconnect || 'clear', lamps: cfg.lamps?.map(withPins) }
}
export function validateConfig(cfg) {
  const errors = []
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return ['config must be an object']
  if (typeof cfg.comPort !== 'string' || !cfg.comPort.trim()) errors.push('comPort is required (auto or port name)')
  if (!Number.isInteger(cfg.baudRate) || cfg.baudRate < 300 || cfg.baudRate > 1000000) errors.push('baudRate must be between 300 and 1000000')
  if (cfg.atem?.ip && net.isIP(cfg.atem.ip) !== 4) errors.push('atem.ip must be an IPv4 address')
  if (!cfg.atem || typeof cfg.atem.enabled !== 'boolean') errors.push('atem.enabled must be a boolean')
  if (cfg.atem?.me !== undefined && (!Number.isInteger(cfg.atem.me) || cfg.atem.me < 1 || cfg.atem.me > 64)) errors.push('atem.me must be an integer between 1 and 64')
  if (!cfg.http || typeof cfg.http.enabled !== 'boolean' || !Number.isInteger(cfg.http.port) || cfg.http.port < 0 || cfg.http.port > 65535) errors.push('http.port must be between 0 and 65535')
  if (!['hold', 'clear'].includes(cfg.onAtemDisconnect)) errors.push('onAtemDisconnect must be hold or clear')
  if (!Array.isArray(cfg.lamps) || cfg.lamps.length === 0) return [...errors, 'lamps must be a non-empty array']
  const ids = new Set()
  cfg.lamps.forEach((l, i) => {
    if (!l || !Number.isInteger(l.id) || !LAMP_PINS[l.id]) errors.push(`lamp[${i}].id is not a known lamp`)
    if (!l || !Number.isInteger(l.atemInput) || l.atemInput < 0) errors.push(`lamp[${i}].atemInput must be a non-negative integer`)
    if (ids.has(l?.id)) errors.push(`duplicate lamp id ${l?.id}`)
    ids.add(l?.id)
  })
  return errors
}
export function loadConfig(configPath, examplePath) {
  if (!fs.existsSync(configPath)) fs.copyFileSync(examplePath, configPath)
  const cfg = normalizeConfig(JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')))
  const errors = validateConfig(cfg)
  if (errors.length) throw new Error('Invalid config:\n' + errors.join('\n'))
  return cfg
}
export function saveConfig(configPath, cfg) {
  const errors = validateConfig(cfg)
  if (errors.length) throw new Error('Invalid config:\n' + errors.join('\n'))
  const { defaultMode, ...rest } = cfg
  const onDisk = { ...rest, lamps: cfg.lamps.map(({ id, atemInput }) => ({ id, atemInput })) }
  const temporary = configPath + '.tmp'
  fs.writeFileSync(temporary, JSON.stringify(onDisk, null, 2))
  fs.renameSync(temporary, configPath)
  return onDisk
}
