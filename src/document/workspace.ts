import { create } from 'zustand'
import type { MarkdownFile } from './files'
import { forestAccent, normalizeAccent, type AccentColor, type Theme } from '../appearance'

export interface DocumentFile extends MarkdownFile {
  id: string
  title: string
  savedSource: string
  savedTitle: string
  updated: number
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
export const recentLimit = 15
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

let database: Promise<IDBDatabase> | undefined
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('folio-workspace', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('sessions')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Close another Folio tab to enable local storage.'))
  }).catch(error => { database = undefined; throw error })
  return database
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction('sessions').objectStore('sessions').get('current')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function storeWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readwrite')
    const store = transaction.objectStore('sessions')
    const request = store.get('current')
    request.onsuccess = () => {
      const saved = request.result as WorkspaceSnapshot | undefined
      const versions = new Map((saved?.files ?? []).map(file => [file.id, file]))
      for (const file of snapshot.files) {
        const previous = versions.get(file.id)
        if (!previous || file.updated >= previous.updated) versions.set(file.id, file)
      }
      const active = versions.get(snapshot.currentId)
      const others = [...versions.values()].filter(file => file.id !== snapshot.currentId).sort((a, b) => b.updated - a.updated)
      const files = active ? [active, ...others.slice(0, recentLimit - 1)] : others.slice(0, recentLimit)
      store.put({ currentId: snapshot.currentId, files }, 'current')
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
