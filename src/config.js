import fs from 'node:fs'

const VALID_MODES = ['atem', 'manual']
const VALID_DISCONNECT = ['hold', 'clear']

export function validateConfig(cfg) {
  const errors = []
  if (!cfg || typeof cfg !== 'object') return ['config must be an object']
  if (!cfg.comPort || typeof cfg.comPort !== 'string') errors.push('comPort is required')
  if (typeof cfg.baudRate !== 'number') errors.push('baudRate must be a number')
  if (!VALID_MODES.includes(cfg.defaultMode)) errors.push(`defaultMode must be one of: ${VALID_MODES.join(', ')}`)
  if (cfg.onAtemDisconnect && !VALID_DISCONNECT.includes(cfg.onAtemDisconnect)) {
    errors.push(`onAtemDisconnect must be one of: ${VALID_DISCONNECT.join(', ')}`)
  }
  if (!Array.isArray(cfg.lamps) || cfg.lamps.length === 0) {
    errors.push('lamps must be a non-empty array')
    return errors
  }
  const ids = new Set(), inputs = new Set(), pins = new Set()
  cfg.lamps.forEach((l, i) => {
    for (const f of ['id', 'atemInput', 'previewPin', 'activePin']) {
      if (typeof l[f] !== 'number') errors.push(`lamp[${i}].${f} must be a number`)
    }
    if (ids.has(l.id)) errors.push(`duplicate lamp id ${l.id}`)
    ids.add(l.id)
    if (inputs.has(l.atemInput)) errors.push(`duplicate atemInput ${l.atemInput}`)
    inputs.add(l.atemInput)
    for (const p of [l.previewPin, l.activePin]) {
      if (pins.has(p)) errors.push(`duplicate pin ${p}`)
      pins.add(p)
    }
  })
  return errors
}

export function loadConfig(configPath, examplePath) {
  if (!fs.existsSync(configPath)) fs.copyFileSync(examplePath, configPath)
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const errors = validateConfig(cfg)
  if (errors.length) throw new Error('Invalid config:\n' + errors.join('\n'))
  return cfg
}

export function saveConfig(configPath, cfg) {
  const errors = validateConfig(cfg)
  if (errors.length) throw new Error('Invalid config:\n' + errors.join('\n'))
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
  return cfg
}
