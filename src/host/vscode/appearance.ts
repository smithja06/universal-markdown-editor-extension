import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { accentTheme, normalizeColorPreferences, sameColorPreferences, type ColorPreferences } from '../../appearance'
import { onWebviewTheme, webviewTheme } from './theme'

/** The extension host and every Folio webview exchange color choices in this envelope, outside the document protocol. */
export const appearanceMessageKey = 'folioAppearance'
export const appearanceMetaName = 'folio-appearance'

type Listener = (preferences: ColorPreferences) => void
const listeners = new Set<Listener>()
let post: ((message: unknown) => void) | undefined
let current = normalizeColorPreferences(undefined)

function initial(): ColorPreferences {
  try {
    const content = document.querySelector(`meta[name="${appearanceMetaName}"]`)?.getAttribute('content')
    return normalizeColorPreferences(content ? JSON.parse(content) : undefined)
  } catch { return normalizeColorPreferences(undefined) }
}

function publish(next: ColorPreferences) {
  if (sameColorPreferences(current, next)) return false
  current = next
  for (const listener of listeners) listener(next)
  return true
}

/** Read the shared choice the extension host embedded in this webview and follow later changes from other Folio editors. */
export function connectWebviewAppearance(send: NonNullable<typeof post>) {
  current = initial()
  post = send
  const receive = (event: MessageEvent<unknown>) => {
    if (event.origin === 'null' || event.origin !== window.origin) return
    const data = event.data
    if (data && typeof data === 'object' && appearanceMessageKey in data) publish(normalizeColorPreferences((data as Record<string, unknown>)[appearanceMessageKey]))
  }
  window.addEventListener('message', receive)
  // VS Code recreates hidden webviews from their first HTML, so confirm the embedded choice is still current.
  try { send({ folioAppearanceRequest: true }) } catch { /* Keep the embedded choice. */ }
  return () => window.removeEventListener('message', receive)
}

export const colorPreferences = () => current

export function setColorPreferences(update: Partial<ColorPreferences>) {
  const next = normalizeColorPreferences({ ...current, ...update })
  if (!publish(next)) return
  try { post?.({ [appearanceMessageKey]: next }) } catch { /* Keep the choice for this webview. */ }
}

export function onColorPreferences(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const effectiveTheme = (preferences: ColorPreferences) => preferences.hostColors ? webviewTheme() : preferences.theme

/** Colors for VS Code shells that do not use the full Folio workspace store. */
export function useWebviewColors() {
  const [preferences, setPreferences] = useState(colorPreferences)
  const [hostTheme, setHostTheme] = useState(webviewTheme)
  useEffect(() => onColorPreferences(setPreferences), [])
  useEffect(() => onWebviewTheme(setHostTheme), [])
  const theme = preferences.hostColors ? hostTheme : preferences.theme
  const style = useMemo(() => preferences.hostColors ? undefined : accentTheme(preferences.accentColor, theme) as CSSProperties,
    [preferences.accentColor, preferences.hostColors, theme])
  return { preferences, theme, style, hostColors: preferences.hostColors, set: setColorPreferences }
}
