// Device settings apply live. Only the standalone HTTP listener needs restart.
export function diffRestartFields(oldCfg, newCfg) {
  return ['port', 'enabled'].filter(k => oldCfg.http?.[k] !== newCfg.http?.[k]).map(k => `http.${k}`)
}
