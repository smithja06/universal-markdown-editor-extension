import { create } from 'zustand'
import type { MarkdownFile } from './files'
import { forestAccent, normalizeAccent, type AccentColor, type Theme } from '../appearance'

export { loadWorkspace, recentLimit, storeWorkspace } from './workspaceStorage'

export interface DocumentFile extends MarkdownFile {
  id: string
  title: string
  savedSource: string
  savedTitle: string
  updated: number
  historyEpoch?: string
}

export interface Appearance {
  theme: Theme
  accentColor: AccentColor
  font: 'Default' | 'Sans serif' | 'Serif' | 'Monospace'
  fontSize: number
  lineHeight: number
  width: 'page' | 'full'
  lineNumbers: boolean
  wordWrap: boolean
  splitRatio: number
  syncScroll: boolean
}

const defaultAppearance: Appearance = { theme: 'light', accentColor: forestAccent, font: 'Default', fontSize: 16, lineHeight: 1.7, width: 'page', lineNumbers: true, wordWrap: true, splitRatio: 0.5, syncScroll: false }

export function newDocument(title = 'Untitled document', file: MarkdownFile = { source: '', lineEnding: '\n', bom: false }): DocumentFile {
  return { ...file, title, id: crypto.randomUUID(), savedSource: file.source, savedTitle: title, updated: Date.now() }
}

export const welcomeSource = [
  '# Welcome to Folio',
  'A calmer space to write, edit, and organize your Markdown documents.',
  '> [!TIP]\n> Press `/` anywhere on a new line to see what you can insert.',
  '## Getting started',
  'Folio brings a rich-text editor and a Markdown source editor together. Use the toolbar to format your writing, or switch to **Markdown Source** when you want to work directly with the syntax.',
  '- [x] Open your first document\n- [ ] Try the visual and source modes\n- [ ] Make this space your own',
  '## Make it yours',
  'Open a Markdown file or start with a blank page. Use the outline to move between sections, and export your work whenever you’re ready.',
].join('\n\n') + '\n'

const appearanceKey = 'folio.appearance.v1'
function persistAppearance(appearance: Appearance) {
  try { localStorage.setItem(appearanceKey, JSON.stringify(appearance)) } catch { /* Preferences still work for this tab. */ }
}

function initialAppearance(): Appearance {
  try {
    const stored: Partial<Omit<Appearance, 'theme' | 'accentColor'>> & { theme?: unknown; accentColor?: unknown } =
      JSON.parse(localStorage.getItem(appearanceKey) ?? '{}') ?? {}
    const systemDark = stored.theme === 'system' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches
    const theme = stored.theme === 'dark' || systemDark ? 'dark' : 'light'
    const appearance = { ...defaultAppearance, ...stored, theme, accentColor: normalizeAccent(stored.accentColor) } satisfies Appearance
    if (stored.theme === 'system') persistAppearance(appearance)
    return appearance
  }
  catch { return defaultAppearance }
}

export type EditorPane = 'visual' | 'source'
export type EditorMode = EditorPane | 'split'

interface Workspace {
  mode: EditorMode
  sidebar: boolean
  appearance: Appearance
  setMode(mode: Workspace['mode']): void
  setSidebar(sidebar: boolean): void
  setAppearance(update: Partial<Appearance>): void
}

export const useWorkspace = create<Workspace>(set => ({
  mode: 'visual',
  sidebar: typeof window === 'undefined' || window.innerWidth >= 1000,
  appearance: initialAppearance(),
  setMode: mode => set({ mode }),
  setSidebar: sidebar => set({ sidebar }),
  setAppearance: update => set(state => {
    const appearance = { ...state.appearance, ...update }
    persistAppearance(appearance)
    return { appearance }
  }),
}))

export interface WorkspaceSnapshot { currentId: string; files: DocumentFile[] }
