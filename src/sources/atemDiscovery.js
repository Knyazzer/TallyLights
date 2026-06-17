import dgram from 'node:dgram'
import os from 'node:os'

const ATEM_PORT = 9910
// Standard ATEM "hello/connect" packet (20 bytes) that triggers a response from the switcher.
const HELLO = Buffer.from([
  0x10, 0x14, 0x53, 0xab, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x3a, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00
])

/** Returns all external IPv4 network interfaces. */
export function listInterfaces() {
  const out = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address, netmask: i.netmask })
    }
  }
  return out
}

/** Returns all candidate host IPs (.1–.254) for a /24 subnet. */
export function hostsForSubnet(address, netmask) {
  const a = address.split('.').map(Number)
  const base = `${a[0]}.${a[1]}.${a[2]}.`
  const hosts = []
  for (let h = 1; h <= 254; h++) hosts.push(base + h)
  return hosts
}

/**
 * Sends ATEM hello packets to each host on UDP port 9910 and collects
 * those that respond within timeoutMs.
 *
 * @param {object} options
 * @param {string[]} options.hosts - candidate IP addresses to probe
 * @param {number} [options.timeoutMs=1500] - how long to wait for responses
 * @param {function} [options.socketFactory] - injectable factory for testing (returns dgram-like object)
 * @returns {Promise<Array<{ip: string}>>}
 */
export function scan({ hosts, timeoutMs = 1500, socketFactory } = {}) {
  return new Promise((resolve) => {
    const found = new Map()
    const socket = (socketFactory || (() => dgram.createSocket('udp4')))()
    socket.on('message', (msg, rinfo) => {
      if (!found.has(rinfo.address)) found.set(rinfo.address, { ip: rinfo.address })
    })
    socket.on('error', () => {})
    socket.bind(() => {
      for (const ip of hosts) socket.send(HELLO, 0, HELLO.length, ATEM_PORT, ip)
    })
    setTimeout(() => {
      try { socket.close() } catch { /* ignore */ }
      resolve([...found.values()])
    }, timeoutMs)
  })
}

/**
 * Pick which discovered ATEM to auto-connect to: the preferred (last-known) ip
 * if it's among the found ones, otherwise the first found, or null if none.
 * @param {string[]} found - discovered ip addresses
 * @param {string} [preferred] - last-known/configured ip
 * @returns {string|null}
 */
export function chooseAtemIp(found, preferred) {
  if (preferred && found.includes(preferred)) return preferred
  return found[0] || null
}
