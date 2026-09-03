/** Platform detection for keyboard-shortcut labels (Alt on PC, Option on Mac). */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export const SEARCH_SHORTCUT_LABEL = IS_MAC ? '⌥S' : 'Alt+S'
