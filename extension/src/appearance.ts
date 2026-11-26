import * as vscode from 'vscode'
import { normalizeColorPreferences, sameColorPreferences, type ColorPreferences } from '../../src/appearance'

/** Matches the webview envelope in src/host/vscode/appearance.ts. */
const messageKey = 'folioAppearance'
const requestKey = 'folioAppearanceRequest'
const storageKey = 'folio.appearance.v1'

let memento: vscode.Memento | undefined
const panels = new Set<vscode.WebviewPanel>()

/** Color choices are global so every Folio editor in every window opens with the same theme and accent. */
export function initializeAppearance(state: vscode.Memento) { memento = state }

export const currentAppearance = (): ColorPreferences => normalizeColorPreferences(memento?.get(storageKey))

const send = (panel: vscode.WebviewPanel, preferences: ColorPreferences) => {
  void Promise.resolve(panel.webview.postMessage({ [messageKey]: preferences })).catch(() => undefined)
}

/** Relay color changes between this panel and the other open Folio editors. The panel cleans up when it closes. */
export function attachAppearance(panel: vscode.WebviewPanel) {
  panels.add(panel)
  const listener = panel.webview.onDidReceiveMessage((incoming: unknown) => {
    if (!incoming || typeof incoming !== 'object') return
    // A webview recreated from its original HTML asks for the current choice.
    if (requestKey in incoming) { send(panel, currentAppearance()); return }
    if (!(messageKey in incoming)) return
    const next = normalizeColorPreferences((incoming as Record<string, unknown>)[messageKey])
    if (sameColorPreferences(next, currentAppearance())) return
    void Promise.resolve(memento?.update(storageKey, next)).catch(() => undefined)
    for (const other of panels) if (other !== panel) send(other, next)
  })
  const closed = panel.onDidDispose(() => {
    panels.delete(panel)
    listener.dispose()
    closed.dispose()
  })
}

/** The initial choice is embedded in the page so the first paint already uses it. */
export const appearanceMeta = () => `<meta name="folio-appearance" content="${JSON.stringify(currentAppearance()).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">`
