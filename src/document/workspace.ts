import { createStore } from 'zustand/vanilla'
import type { DocumentContent, DocumentFormat } from './formats/content'
import { forestAccent, normalizeAccent, type AccentColor, type Theme } from '../appearance'
import type { AppearancePreferences } from '../host/contracts'

interface DocumentIdentity {
  id: string
  title: string
  savedSource: string
  savedTitle: string
  updated: number
  historyEpoch?: string
}

export type DocumentFile = DocumentIdentity & DocumentContent

export interface Appearance {
  theme: Theme
  accentColor: AccentColor
  /** In hosts with their own color theme, use the host colors instead of the Folio palette. */
  hostColors: boolean
  font: 'Default' | 'Sans serif' | 'Serif' | 'Monospace'
  fontSize: number
  lineHeight: number
  width: 'page' | 'full'
  lineNumbers: boolean
  wordWrap: boolean
  splitRatio: number
  syncScroll: boolean
}

const defaultAppearance: Appearance = { theme: 'light', accentColor: forestAccent, hostColors: true, font: 'Default', fontSize: 16, lineHeight: 1.7, width: 'page', lineNumbers: true, wordWrap: true, splitRatio: 0.5, syncScroll: false }

export function newDocument(title = 'Untitled document', file: DocumentContent = { source: '', lineEnding: '\n', bom: false }): DocumentFile {
  const content: DocumentContent = file.format && file.format !== 'markdown' ? file : { ...file, format: 'markdown', schemaVersion: 1 }
  return { ...content, title, id: crypto.randomUUID(), savedSource: file.source, savedTitle: title, updated: Date.now() }
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

type StoredAppearance = Partial<Omit<Appearance, 'theme' | 'accentColor' | 'hostColors'>> & { theme?: unknown; accentColor?: unknown; hostColors?: unknown }

export function normalizeAppearance(stored: StoredAppearance, prefersDark = false): Appearance {
  const theme = stored.theme === 'dark' || (stored.theme === 'system' && prefersDark) ? 'dark' : 'light'
  return { ...defaultAppearance, ...stored, theme, accentColor: normalizeAccent(stored.accentColor), hostColors: stored.hostColors !== false }
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

export function createWorkspace(preferences: AppearancePreferences, sidebar: boolean) {
  return createStore<Workspace>(set => ({
    mode: 'visual',
    sidebar,
    appearance: preferences.read(),
    setMode: mode => set({ mode }),
    setSidebar: sidebar => set({ sidebar }),
    setAppearance: update => set(state => {
      const appearance = { ...state.appearance, ...update }
      preferences.write(appearance)
      return { appearance }
    }),
  }))
}

export type WorkspaceView = ReturnType<typeof createWorkspace>

export interface DocumentSummary {
  id: string
  title: string
  format?: DocumentFormat
  createdAt: number
  updated: number
  openedAt?: number
  deletedAt?: number
  words?: number
  dirty: boolean
}

export interface TabView {
  id: string
  mode: EditorMode
  pane?: EditorPane
  visual?: { anchor: number; head: number; top: number; left: number }
  source?: { anchor: number; head: number; top: number; left: number }
}

export interface WorkspaceLayout { activeId: string | null; tabs: TabView[]; closed: TabView[] }
export const emptyLayout: WorkspaceLayout = { activeId: null, tabs: [], closed: [] }

export function draftSummary(file: DocumentFile, existing?: DocumentSummary, words?: number): DocumentSummary {
  return { ...existing, id: file.id, title: file.title, ...(file.format ? { format: file.format } : {}), createdAt: existing?.createdAt ?? file.updated,
    updated: file.updated, words: words ?? existing?.words, dirty: (!file.format || file.format === 'markdown') && (file.source !== file.savedSource || file.title !== file.savedTitle) }
}

export function withoutTabs(layout: WorkspaceLayout, ids: Set<string>, remember: boolean): WorkspaceLayout {
  const index = layout.tabs.findIndex(tab => tab.id === layout.activeId)
  const removed = layout.tabs.filter(tab => ids.has(tab.id))
  const tabs = layout.tabs.filter(tab => !ids.has(tab.id))
  const activeId = layout.activeId && !ids.has(layout.activeId) ? layout.activeId : tabs[Math.min(Math.max(index, 0), tabs.length - 1)]?.id ?? null
  const closed = [...(remember ? [...removed].reverse() : []), ...layout.closed.filter(tab => !ids.has(tab.id))].slice(0, 20)
  return { activeId, tabs, closed }
}

export function availableTitle(requested: string, existing: Iterable<DocumentSummary>) {
  const key = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\.(md|markdown)$/i, '')
  const titles = new Set(Array.from(existing).filter(item => item.deletedAt === undefined).map(item => key(item.title)))
  const extension = /\.(?:md|markdown|txt|docx|pdf|xlsx|csv)$/i.exec(requested)?.[0] ?? ''
  const stem = extension ? requested.slice(0, -extension.length) : requested
  let title = stem
  for (let suffix = 2; titles.has(key(title + extension)); suffix++) title = `${stem} (${suffix})`
  return title + extension
}
