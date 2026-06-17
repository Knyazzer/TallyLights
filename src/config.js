import fs from 'node:fs'
import { LAMP_PINS, withPins } from './lampPins.js'

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
  // Pins are no longer stored in config — they come from LAMP_PINS by lamp id.
  // A lamp just needs a known id and a numeric atemInput. Multiple lamps may
  // follow the same atemInput; only ids must be unique.
  const ids = new Set()
  cfg.lamps.forEach((l, i) => {
    if (typeof l.id !== 'number') errors.push(`lamp[${i}].id must be a number`)
    else if (!LAMP_PINS[l.id]) errors.push(`lamp[${i}].id ${l.id} is not a known lamp (valid: ${Object.keys(LAMP_PINS).join(', ')})`)
    if (typeof l.atemInput !== 'number') errors.push(`lamp[${i}].atemInput must be a number`)
    if (ids.has(l.id)) errors.push(`duplicate lamp id ${l.id}`)
    ids.add(l.id)
  })
  return errors
}

export function loadConfig(configPath, examplePath) {
  if (!fs.existsSync(configPath)) fs.copyFileSync(examplePath, configPath)
  // Strip a leading UTF-8 BOM — Windows editors (Notepad) add one and it breaks JSON.parse.
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^﻿/, ''))
  const errors = validateConfig(cfg)
  if (errors.length) throw new Error('Invalid config:\n' + errors.join('\n'))
  cfg.lamps = cfg.lamps.map(withPins) // attach hardcoded pins for the app to use
  return cfg
}

export function saveConfig(configPath, cfg) {
  const errors = validateConfig(cfg)
  if (errors.length) throw new Error('Invalid config:\n' + errors.join('\n'))
  // Persist only {id, atemInput} per lamp — pins live in code, not on disk.
  const onDisk = { ...cfg, lamps: cfg.lamps.map(l => ({ id: l.id, atemInput: l.atemInput })) }
  fs.writeFileSync(configPath, JSON.stringify(onDisk, null, 2))
  return onDisk
}
