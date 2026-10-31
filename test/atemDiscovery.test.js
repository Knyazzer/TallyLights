import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { hostsForSubnet, scan, chooseAtemIp } from '../src/sources/atemDiscovery.js'

describe('hostsForSubnet', () => {
  it('returns 254 hosts for a /24', () => {
    const hosts = hostsForSubnet('192.168.10.50', '255.255.255.0')
    expect(hosts.length).toBe(254)
    expect(hosts[0]).toBe('192.168.10.1')
    expect(hosts[253]).toBe('192.168.10.254')
  })
})

function fakeSocket() {
  const s = new EventEmitter()
  s.sent = []
  s.bind = (cb) => cb && cb()
  s.send = (buf, off, len, port, ip) => s.sent.push({ ip, port })
  s.close = () => {}
  return s
}

describe('scan', () => {
  it('ignores unrelated UDP senders and malformed packets', async () => {
    const socket = fakeSocket()
    const p = scan({ hosts: ['10.0.0.2'], timeoutMs: 10, socketFactory: () => socket })
    const reply = Buffer.alloc(20); reply[0] = 0x10; reply[1] = 20
    socket.emit('message', reply, { address: '10.0.0.3', port: 9910 })
    socket.emit('message', reply, { address: '10.0.0.2', port: 1234 })
    socket.emit('message', Buffer.from([0x10]), { address: '10.0.0.2', port: 9910 })
    expect(await p).toEqual([])
  })
  it('collects IPs that respond on port 9910', async () => {
    const socket = fakeSocket()
    const p = scan({ hosts: ['192.168.10.240', '192.168.10.5'], timeoutMs: 20, socketFactory: () => socket })
    const reply = Buffer.alloc(20); reply[0] = 0x10; reply[1] = 20
    socket.emit('message', reply, { address: '192.168.10.240', port: 9910 })
    const found = await p
    expect(found).toEqual([{ ip: '192.168.10.240' }])
    expect(socket.sent.map(s => s.port)).toEqual([9910, 9910])
  })

  it('returns empty when nobody responds', async () => {
    const socket = fakeSocket()
    const found = await scan({ hosts: ['192.168.10.5'], timeoutMs: 20, socketFactory: () => socket })
    expect(found).toEqual([])
  })
})

describe('chooseAtemIp', () => {
  it('prefers the last-known ip when it is among the found', () => {
    expect(chooseAtemIp(['10.0.0.5', '10.0.0.9'], '10.0.0.9')).toBe('10.0.0.9')
  })
  it('falls back to the first found when preferred is absent', () => {
    expect(chooseAtemIp(['10.0.0.5', '10.0.0.9'], '192.168.1.1')).toBe('10.0.0.5')
  })
  it('uses the first found when no preferred ip', () => {
    expect(chooseAtemIp(['10.0.0.5'], undefined)).toBe('10.0.0.5')
  })
  it('returns null when nothing found', () => {
    expect(chooseAtemIp([], '10.0.0.9')).toBe(null)
  })
})
