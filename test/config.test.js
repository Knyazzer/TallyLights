import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig, loadConfig, saveConfig, normalizeConfig } from '../src/config.js'

const valid = {
  comPort: 'COM5', baudRate: 57600,
  atem: { ip: '192.168.10.240', enabled: true },
  http: { port: 8080, enabled: true },
  defaultMode: 'atem', onAtemDisconnect: 'hold',
  lamps: [
    { id: 1, atemInput: 1 },
    { id: 2, atemInput: 2 }
  ]
}

describe('validateConfig', () => {
  it('migrates old startup modes and defaults missing disconnect policy to clear', () => {
    const cfg = normalizeConfig({ ...valid, defaultMode: 'manual', onAtemDisconnect: undefined })
    expect(cfg).not.toHaveProperty('defaultMode')
    expect(cfg.onAtemDisconnect).toBe('clear')
    expect(cfg.atem.me).toBe(1)
    expect(normalizeConfig(valid).onAtemDisconnect).toBe('hold')
  })
  it('rejects malformed nested fields, null lamps and fractional input ids', () => {
    for (const cfg of [{ ...valid, http: null }, { ...valid, atem: { ip: 'abc' } },
      { ...valid, lamps: [null] }, { ...valid, lamps: [{ id: 1, atemInput: 1.5 }] }])
      expect(validateConfig(cfg).length).toBeGreaterThan(0)
  })
  it('accepts a valid config', () => {
    expect(validateConfig(valid)).toEqual([])
  })
  it('requires comPort', () => {
    const cfg = { ...valid, comPort: '' }
    expect(validateConfig(cfg).some(e => e.includes('comPort'))).toBe(true)
  })
  it('rejects invalid baudRate', () => {
    const cfg = { ...valid, baudRate: 0 }
    expect(validateConfig(cfg).some(e => e.includes('baudRate'))).toBe(true)
  })
  it('rejects an unknown lamp id (no hardcoded pin mapping)', () => {
    const cfg = { ...valid, lamps: [{ id: 99, atemInput: 1 }] }
    expect(validateConfig(cfg).some(e => e.includes('known lamp'))).toBe(true)
  })
  it('rejects duplicate lamp ids', () => {
    const cfg = { ...valid, lamps: [
      { id: 1, atemInput: 1 },
      { id: 1, atemInput: 2 }
    ] }
    expect(validateConfig(cfg).some(e => e.includes('id'))).toBe(true)
  })
  it('allows two lamps to follow the same atemInput', () => {
    const cfg = { ...valid, lamps: [
      { id: 1, atemInput: 5 },
      { id: 2, atemInput: 5 }
    ] }
    expect(validateConfig(cfg)).toEqual([])
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
    // pins are not in the file — they are attached from the hardcoded map by id
    expect(cfg.lamps[0]).toMatchObject({ id: 1, atemInput: 1, previewPin: 2, activePin: 3 })
  })
  it('saveConfig throws on invalid config', () => {
    const target = path.join(dir, 'config.json')
    expect(() => saveConfig(target, { ...valid, baudRate: 0 })).toThrow()
  })
  it('saveConfig writes valid config', () => {
    const target = path.join(dir, 'config.json')
    saveConfig(target, valid)
    const saved = JSON.parse(fs.readFileSync(target, 'utf8'))
    expect(saved.comPort).toBe('COM5')
    expect(saved).not.toHaveProperty('defaultMode')
    expect(saved.lamps[0]).not.toHaveProperty('activePin')
  })
})
