/**
 * Returns the names of restart-required fields that differ between two configs.
 * Checked fields: comPort, baudRate, atem.ip, http.port
 *
 * @param {object} oldCfg
 * @param {object} newCfg
 * @returns {string[]}
 */
export function diffRestartFields(oldCfg, newCfg) {
  const checks = [
    ['comPort',   oldCfg.comPort,     newCfg.comPort],
    ['baudRate',  oldCfg.baudRate,    newCfg.baudRate],
    ['atem.ip',   oldCfg.atem?.ip,    newCfg.atem?.ip],
    ['http.port', oldCfg.http?.port,  newCfg.http?.port],
  ]
  return checks.filter(([, a, b]) => a !== b).map(([name]) => name)
}
