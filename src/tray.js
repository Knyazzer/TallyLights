// Optional Windows system-tray icon (systray2). Best-effort: if the library or
// its helper binary isn't available, the app simply runs without a tray.
import { log } from './logger.js'

// 32x32 red-dot .ico (base64) — the tray/app icon. Generated via GDI+ so the
// systray helper binary accepts it (hand-rolled 32bpp ICOs make it exit).
const ICON = 'AAABAAEAICAQAAAAAADoAgAAFgAAACgAAAAgAAAAQAAAAAEABAAAAAAAgAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACAAAAAgIAAgAAAAIAAgACAgAAAgICAAMDAwAAAAP8AAP8AAAD//wD/AAAA/wD/AP//AAD///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEREQAAAAAAAAAAAAAAABmZmZmZEAAAAAAAAAAAABmZmZmZmZkQAAAAAAAAAAGZmZmZmZmZkQAAAAAAAAAZmZmZmZmZmZmQAAAAAAABmZmZmZmZmZmZkQAAAAAAGZmZmZmZmZmZmZkQAAAAAJmZmZmZmZmZmZmZkAAAAAGZmZmZmZmZmZmZmZEAAAABmZmZmZmZmZmZmZmZAAAACZmZmZmZmZmZmZmZmQAAAAmZmZmZmZmZmZmZmZkQAAAZmZmZmZmZmZmZmZmZEAAAGZmZmZmZmZmZmZmZmRAAABmZmZmZmZmZmZmZmZkQAAAJmZmZmZmZmZmZmZmZEAAACZmZmZmZmZmZmZmZmQAAAAGZmZmZmZmZmZmZmZEAAAABmZmZmZmZmZmZmZmRAAAAABmZmZmZmZmZmZmZkAAAAAAJmZmZmZmZmZmZmRAAAAAAAZmZmZmZmZmZmZEAAAAAAAAZmZmZmZmZmZkQAAAAAAAAAZmZmZmZmZmRAAAAAAAAAAABmZmZmZmRAAAAAAAAAAAAABGZmZmREAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////////+A///+AB//+AAP//AAB//gAAP/wAAB/8AAAf+AAAD/gAAA/wAAAH8AAAB/AAAAfwAAAH8AAAB/AAAAf4AAAH+AAAD/gAAA/8AAAf/AAAH/4AAD//AAB//4AA///gA////A///////////////////////w=='

// Starts the tray. handlers: { openAdmin(), quit() }. Returns the SysTray
// instance, or null when a tray can't be created (non-Windows, lib missing).
export async function startTray({ openAdmin, quit, tooltip = 'TallyLights' } = {}) {
  if (process.platform !== 'win32') return null
  let SysTray
  try {
    // systray2 is CommonJS: under ESM interop the class lands at mod.default.default.
    const mod = await import('systray2')
    SysTray = mod?.default?.default ?? mod?.default ?? mod
    if (typeof SysTray !== 'function') throw new Error('SysTray constructor not found')
  } catch (e) {
    log.warn('tray unavailable:', e?.message || e)
    return null
  }
  const open = { title: 'Открыть админку', tooltip: '', checked: false, enabled: true }
  const exit = { title: 'Выход', tooltip: '', checked: false, enabled: true }
  const tray = new SysTray({
    menu: { icon: ICON, isTemplateIcon: false, title: 'TallyLights', tooltip, items: [open, SysTray.separator, exit] },
    debug: false,
    copyDir: false // run the helper binary in place (our install dir is writable)
  })
  tray.onClick((action) => {
    if (action.item.title === open.title) { try { openAdmin?.() } catch { /* ignore */ } }
    else if (action.item.title === exit.title) { try { quit?.() } catch { /* ignore */ } }
  })
  try {
    await tray.ready()
  } catch (e) {
    log.warn('tray failed to start:', e?.message || e)
    return null
  }
  return tray
}
