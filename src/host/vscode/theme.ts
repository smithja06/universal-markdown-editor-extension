import type { Appearance } from '../../document/workspace'

export function webviewTheme(): Appearance['theme'] {
  return document.body.matches('.vscode-dark, .vscode-high-contrast:not(.vscode-high-contrast-light)') ? 'dark' : 'light'
}

export function onWebviewTheme(listener: (theme: Appearance['theme']) => void) {
  let previous = webviewTheme()
  const observer = new MutationObserver(() => {
    const next = webviewTheme()
    if (previous !== next) { previous = next; listener(next) }
  })
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  listener(previous)
  return () => observer.disconnect()
}
