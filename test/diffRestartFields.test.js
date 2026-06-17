import { describe, it, expect } from 'vitest'
import { diffRestartFields } from '../src/diffRestartFields.js'

const base = {
  comPort: 'COM3', baudRate: 57600,
  atem: { ip: '192.168.1.10' },
  http: { port: 8080 },
  lamps: [{ id: 1, atemInput: 1, previewPin: 2, activePin: 3 }],
  onAtemDisconnect: 'hold'
}

describe('diffRestartFields', () => {
  it('returns [] when nothing changed', () => {
    expect(diffRestartFields(base, { ...base })).toEqual([])
  })

  it('detects comPort change', () => {
    const next = { ...base, comPort: 'COM4' }
    expect(diffRestartFields(base, next)).toContain('comPort')
  })

  it('does NOT require a restart for atem.ip change (hot-reconnected live)', () => {
    const next = { ...base, atem: { ...base.atem, ip: '10.0.0.1' } }
    expect(diffRestartFields(base, next)).toEqual([])
  })

  it('detects comPort but not atem.ip when both change', () => {
    const next = { ...base, comPort: 'COM5', atem: { ...base.atem, ip: '10.0.0.2' } }
    const result = diffRestartFields(base, next)
    expect(result).toContain('comPort')
    expect(result).not.toContain('atem.ip')
  })

  it('returns [] when only lamps changed', () => {
    const next = { ...base, lamps: [{ id: 99, atemInput: 99, previewPin: 10, activePin: 11 }] }
    expect(diffRestartFields(base, next)).toEqual([])
  })

  it('returns [] when only onAtemDisconnect changed', () => {
    const next = { ...base, onAtemDisconnect: 'clear' }
    expect(diffRestartFields(base, next)).toEqual([])
  })

  it('detects baudRate change', () => {
    const next = { ...base, baudRate: 115200 }
    expect(diffRestartFields(base, next)).toContain('baudRate')
  })

  it('detects http.port change', () => {
    const next = { ...base, http: { ...base.http, port: 9090 } }
    expect(diffRestartFields(base, next)).toContain('http.port')
  })
})
