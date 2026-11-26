import { sourceChange } from './protocol'
import { isRecord } from './recovery'

export const maxLocalDraft = 2 * 1024 * 1024
const anchorLength = 64

/**
 * The secondary webview journal stores a complete draft up to 2 MiB. Larger workbooks store the pending splice against
 * the host-acknowledged draft with its replaced text and surrounding context, so a restore applies only to the same base.
 */
interface PendingSplice { from: number; to: number; text: string; baseLength: number; baseHash: number; removed: string; before: string; after: string; length: number }

/** FNV-1a over UTF-16 code units. It identifies the acknowledged base; the splice context and workbook parse check the rest. */
function checksum(text: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193)
  return hash >>> 0
}

export function pendingRecord(base: string | undefined, draft: string, fingerprint: string): string | undefined {
  if (draft.length <= maxLocalDraft) return JSON.stringify({ fingerprint, source: draft })
  if (base === undefined) return
  const change = sourceChange(base, draft)
  if (!change || change.text.length + (change.to - change.from) > maxLocalDraft) return
  const splice: PendingSplice = { ...change, baseLength: base.length, baseHash: checksum(base), removed: base.slice(change.from, change.to),
    before: base.slice(Math.max(0, change.from - anchorLength), change.from), after: base.slice(change.to, change.to + anchorLength), length: draft.length }
  return JSON.stringify({ fingerprint, splice })
}

export function pendingDraft(saved: string, current: string | undefined, fingerprint: string | undefined): string | undefined {
  if (saved.length > 2 * maxLocalDraft + 4096) return
  const value: unknown = JSON.parse(saved)
  if (!isRecord(value) || value.fingerprint !== fingerprint) return
  if (typeof value.source === 'string') return value.source === current ? undefined : value.source
  const splice = value.splice
  if (!isRecord(splice) || current === undefined) return
  const { from, to, text, baseLength, baseHash, removed, before, after, length } = splice as Partial<Record<keyof PendingSplice, unknown>>
  if (typeof from !== 'number' || typeof to !== 'number' || typeof text !== 'string' || typeof removed !== 'string' ||
    typeof before !== 'string' || typeof after !== 'string' || baseLength !== current.length || !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) || from < 0 || to < from || to > current.length) return
  // A mismatch means the host already holds this edit or a different draft. The native checkpoint stays authoritative.
  if (current.slice(from, to) !== removed || current.slice(Math.max(0, from - before.length), from) !== before ||
    current.slice(to, to + after.length) !== after || baseHash !== checksum(current)) return
  const restored = current.slice(0, from) + text + current.slice(to)
  return restored.length === length ? restored : undefined
}

