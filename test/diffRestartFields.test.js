import { it, expect } from 'vitest'
import { diffRestartFields } from '../src/diffRestartFields.js'
const base = { comPort: 'auto', baudRate: 57600, http: { port: 8080, enabled: true } }
it('applies COM and baud changes without restarting', () => {
  expect(diffRestartFields(base, { ...base, comPort: 'COM9', baudRate: 115200 })).toEqual([])
})
it('reports only listener settings requiring restart', () => {
  expect(diffRestartFields(base, { ...base, http: { port: 9000, enabled: false } })).toEqual(['http.port', 'http.enabled'])
})
