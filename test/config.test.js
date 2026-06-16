import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, loadConfig, saveConfig } from '../src/config.js'

const valid = {
  comPort: 'COM5', baudRate: 57600,
  atem: { ip: '192.168.10.240', enabled: true },
  http: { port: 8080, enabled: true },
  defaultMode: 'atem', onAtemDisconnect: 'hold',
  lamps: [
    { id: 1, atemInput: 1, previewPin: 2, activePin: 3 },
    { id: 2, atemInput: 2, previewPin: 4, activePin: 5 }
  ]
}

describe('validateConfig', () => {
  it('accepts a valid config', () => {
    expect(validateConfig(valid)).toEqual([])
  })
  it('requires comPort', () => {
    const cfg = { ...valid, comPort: '' }
    expect(validateConfig(cfg).some(e => e.includes('comPort'))).toBe(true)
  })
  it('rejects invalid defaultMode', () => {
    const cfg = { ...valid, defaultMode: 'bogus' }
    expect(validateConfig(cfg).some(e => e.includes('defaultMode'))).toBe(true)
  })
  it('rejects duplicate pins across lamps', () => {
    const cfg = { ...valid, lamps: [
      { id: 1, atemInput: 1, previewPin: 2, activePin: 3 },
      { id: 2, atemInput: 2, previewPin: 3, activePin: 5 }
    ] }
    expect(validateConfig(cfg).some(e => e.includes('pin'))).toBe(true)
  })
  it('rejects duplicate lamp ids', () => {
    const cfg = { ...valid, lamps: [
      { id: 1, atemInput: 1, previewPin: 2, activePin: 3 },
      { id: 1, atemInput: 2, previewPin: 4, activePin: 5 }
    ] }
    expect(validateConfig(cfg).some(e => e.includes('id'))).toBe(true)
  })
})

describe('loadConfig / saveConfig', () => {
  let dir
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('copies example when config missing, then loads it', () => {
    const example = path.join(dir, 'config.example.json')
    const target = path.join(dir, 'config.json')
    fs.writeFileSync(example, JSON.stringify(valid))
    const cfg = loadConfig(target, example)
    expect(cfg.comPort).toBe('COM5')
    expect(fs.existsSync(target)).toBe(true)
  })
  it('saveConfig throws on invalid config', () => {
    const target = path.join(dir, 'config.json')
    expect(() => saveConfig(target, { ...valid, defaultMode: 'x' })).toThrow()
  })
  it('saveConfig writes valid config', () => {
    const target = path.join(dir, 'config.json')
    saveConfig(target, valid)
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).comPort).toBe('COM5')
  })
})
