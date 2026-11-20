export type ShortcutPlatform = 'mac' | 'other'
export interface Shortcut { key: string; primary?: boolean; shift?: boolean; alt?: boolean; platform?: ShortcutPlatform }
export interface KeyPress { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }
export interface Command {
  id: string
  label: string
  category: string
  keywords?: string
  shortcuts?: readonly Shortcut[]
  available?: () => boolean
  run(argument?: string): void
}

export class CommandRegistry {
  private commands = new Map<string, Command>()

  register(command: Command) {
    if (this.commands.has(command.id)) throw new Error(`Command already registered: ${command.id}`)
    this.commands.set(command.id, command)
    return () => { if (this.commands.get(command.id) === command) this.commands.delete(command.id) }
  }

  get(id: string) { return this.commands.get(id) }

  list() { return [...this.commands.values()] }

  execute(id: string, argument?: string) {
    const command = this.get(id)
    if (!command || command.available?.() === false) return false
    command.run(argument)
    return true
  }
}

export function matchesShortcut(shortcut: Shortcut, event: KeyPress, platform: ShortcutPlatform) {
  if (shortcut.platform && shortcut.platform !== platform) return false
  const mac = platform === 'mac'
  const key = shortcut.key.toLowerCase()
  const keyMatches = key === event.key.toLowerCase() || (mac && !!shortcut.alt && event.code === 'Key' + key.toUpperCase())
  return keyMatches && event.ctrlKey === (!mac && !!shortcut.primary) &&
    event.metaKey === (mac && !!shortcut.primary) && event.shiftKey === !!shortcut.shift && event.altKey === !!shortcut.alt
}

export function shortcutLabel(shortcut: Shortcut, platform: ShortcutPlatform) {
  return [shortcut.primary ? (platform === 'mac' ? 'Cmd' : 'Ctrl') : '', shortcut.alt ? (platform === 'mac' ? 'Option' : 'Alt') : '',
    shortcut.shift ? 'Shift' : '', shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key].filter(Boolean).join('+')
}

function normalized(text: string) { return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase() }

export function fuzzyScore(query: string, label: string, keywords = '') {
  const terms = normalized(query).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return 0
  const name = normalized(label)
  const text = keywords ? name + ' ' + normalized(keywords) : name
  let score = 0
  for (const term of terms) {
    const start = text.indexOf(term)
    if (start >= 0) {
      score += 200 + (start === 0 ? 80 : text[start - 1] === ' ' ? 30 : 0) + (start < name.length ? 30 : 0) - Math.min(30, start)
      continue
    }
    let at = 0
    let first = -1
    for (const char of term) {
      const match = text.indexOf(char, at)
      if (match < 0) return -1
      if (first < 0) first = match
      at = match + char.length
    }
    score += Math.max(1, 100 - (at - first - term.length) - Math.min(first, 30))
  }
  return score
}
