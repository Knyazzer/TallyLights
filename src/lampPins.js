// Fixed hardware pin map for the AVMATRIX TS3019-6: each tally lamp is wired to
// a specific preview (green) and active (red) Firmata pin. These are determined
// by the box (same values vMix uses) and are NOT user-editable — the admin only
// chooses which ATEM input each lamp follows.
export const LAMP_PINS = {
  1: { previewPin: 2, activePin: 3 },
  2: { previewPin: 4, activePin: 5 },
  3: { previewPin: 6, activePin: 7 },
  4: { previewPin: 8, activePin: 9 },
  5: { previewPin: 10, activePin: 11 },
  6: { previewPin: 12, activePin: 13 }
}

// Lamp ids in order (1..6).
export const LAMP_IDS = Object.keys(LAMP_PINS).map(Number)

// Return a lamp with its hardcoded pins attached (overriding any stray pins).
export function withPins(lamp) {
  return { ...lamp, ...(LAMP_PINS[lamp.id] || {}) }
}
