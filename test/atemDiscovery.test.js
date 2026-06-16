import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { hostsForSubnet, scan } from '../src/sources/atemDiscovery.js'

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
  it('collects IPs that respond on port 9910', async () => {
    const socket = fakeSocket()
    const p = scan({ hosts: ['192.168.10.240', '192.168.10.5'], timeoutMs: 20, socketFactory: () => socket })
    socket.emit('message', Buffer.from([0x10]), { address: '192.168.10.240', port: 9910 })
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
