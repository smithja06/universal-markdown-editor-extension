export const recoveryPrefix = 'folio.recovery.v1.'

export interface RecoveryText {
  source: string
  eol: '\n' | '\r\n'
  bom: boolean
}

export interface RecoveryDraft extends RecoveryText {
  id: string
  uri: string
  generation: number
  reason: 'pending' | 'conflict' | 'rejected' | 'unavailable' | 'interrupted'
  native?: RecoveryText
  originalFingerprint?: string
}

export interface RecoveryJournal {
  read(scope: string): RecoveryDraft[]
  write(scope: string, draft: RecoveryDraft): void
  remove(scope: string, draft: RecoveryDraft): void
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
export const isId = (value: unknown): value is string =>
  typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)
export const isUri = (value: unknown): value is string => typeof value === 'string' && /^[a-z][\w+.-]*:[^\s]/i.test(value)
export const isGeneration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
export const isFingerprint = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{64}$/.test(value)

function isRecoveryText(value: unknown): value is RecoveryText {
  return isRecord(value) && typeof value.source === 'string' && !value.source.includes('\r') &&
    (value.eol === '\n' || value.eol === '\r\n') && typeof value.bom === 'boolean'
}

export function isRecoveryDraft(value: unknown): value is RecoveryDraft {
  return isRecord(value) && isId(value.id) && isUri(value.uri) && isGeneration(value.generation) &&
    (value.reason === 'pending' || value.reason === 'conflict' || value.reason === 'rejected' ||
      value.reason === 'unavailable' || value.reason === 'interrupted') &&
    (value.native === undefined || isRecoveryText(value.native)) &&
    (value.originalFingerprint === undefined || isFingerprint(value.originalFingerprint)) && isRecoveryText(value)
}

export function recoveryMarkdown({ source, eol, bom }: RecoveryText): string {
  return (bom ? '\uFEFF' : '') + (eol === '\n' ? source : source.replace(/\n/g, eol))
}

export function createRecoveryJournal(storage: () => Storage): RecoveryJournal {
  const prefix = (scope: string) => recoveryPrefix + scope + '.'
  const key = (scope: string, id: string) => prefix(scope) + id
  function read(store: Storage, entry: string) {
    const json = store.getItem(entry)
    if (!json) return
    try {
      const draft: unknown = JSON.parse(json)
      if (isRecoveryDraft(draft) && entry.endsWith('.' + draft.id)) return draft
    } catch { /* An invalid record must not hide other drafts. */ }
  }
  return {
    read(scope) {
      const store = storage()
      const drafts: RecoveryDraft[] = []
      for (let i = 0; i < store.length; i++) {
        const entry = store.key(i)
        if (!entry?.startsWith(prefix(scope))) continue
        const draft = read(store, entry)
        if (draft) drafts.push(draft)
      }
      return drafts
    },
    write(scope, draft) {
      storage().setItem(key(scope, draft.id), JSON.stringify(draft))
    },
    remove(scope, draft) {
      const store = storage()
      const entry = key(scope, draft.id)
      const current = read(store, entry)
      if (current && current.uri === draft.uri && current.generation <= draft.generation) store.removeItem(entry)
    },
  }
}
