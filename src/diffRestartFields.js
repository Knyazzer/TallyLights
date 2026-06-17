/**
 * Returns the names of restart-required fields that differ between two configs.
 * Checked fields: comPort, baudRate, http.port. (atem.ip is hot-reconnected
 * live, so it is intentionally NOT a restart field.)
 *
 * @param {object} oldCfg
 * @param {object} newCfg
 * @returns {string[]}
 */
export function diffRestartFields(oldCfg, newCfg) {
  const checks = [
    ['comPort',   oldCfg.comPort,     newCfg.comPort],
    ['baudRate',  oldCfg.baudRate,    newCfg.baudRate],
    ['http.port', oldCfg.http?.port,  newCfg.http?.port],
  ]
  return checks.filter(([, a, b]) => a !== b).map(([name]) => name)
}
