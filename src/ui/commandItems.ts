import { CommandRegistry, shortcutLabel, type Shortcut, type ShortcutPlatform } from '../core/commands'
import type { Item } from './controls'

interface RegisteredItem extends Item { id?: string; keywords?: string; shortcuts?: Shortcut[]; available?: () => boolean }

function legacyShortcut(label: string | undefined): Shortcut[] | undefined {
  if (!label) return
  const parts = label.split('+')
  return [{ key: parts.at(-1)!, primary: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt') }]
}

export function registerItems(registry: CommandRegistry, platform: ShortcutPlatform, category: string, namespace: string,
  items: RegisteredItem[], enabled = true): Item[] {
  return items.map(item => {
    if (item.divider || !item.run) return item
    const id = item.id ?? `${namespace}.${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`
    const shortcuts = item.shortcuts ?? legacyShortcut(item.shortcut)
    registry.register({ id, label: item.label, category, keywords: item.keywords, shortcuts,
      available: () => enabled && (item.available?.() ?? !item.disabled), run: item.run })
    const local = shortcuts?.find(shortcut => !shortcut.platform || shortcut.platform === platform)
    return { ...item, disabled: !enabled || item.disabled, shortcut: local ? shortcutLabel(local, platform) : undefined, run: () => { registry.execute(id) } }
  })
}
