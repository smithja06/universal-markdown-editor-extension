import { isGeneration, isId, isRecord, isRecoveryDraft, isUri, type RecoveryDraft } from './recovery'
import { isNativeAction, type NativeAction } from './nativeCommands'

interface DocumentMetadata {
  uri: string
  title: string
  revision: number
  dirty: boolean
  eol: '\n' | '\r\n'
  bom?: boolean
  available: boolean
}

export interface DocumentState extends DocumentMetadata {
  source: string
}

/** A replacement in LF-normalized text using UTF-16 offsets. */
export interface Splice { from: number; to: number; text: string }
export type PendingCheckpoint = Pick<RecoveryDraft, 'id' | 'uri' | 'generation' | 'eol' | 'bom'> & {
  baseRevision: number
  change?: Splice
}
export const concurrentWorkspaceImages = 4

export type ClientMessage =
  | { type: 'ready' }
  | { type: 'edit'; id: number; revision: number; change: Splice }
  | { type: 'checkpoint'; draft: RecoveryDraft | PendingCheckpoint }
  | { type: 'dismiss'; id: string; generation: number }
  | { type: 'status' }
  | { type: 'abandon'; id: number }
  | { type: 'command'; command: 'save' | 'undo' | 'redo' }
  | { type: 'copy'; id: number; text: string }
  | { type: 'resource'; id: number; operation: 'image' | 'open'; reference: string }
  | { type: 'cancelResource'; id: number }

export type HostMessage =
  | { type: 'state'; state: DocumentState; edit?: { id: number; accepted: boolean; message?: string } }
  | { type: 'accepted'; state: DocumentMetadata; edit: { id: number } }
  | { type: 'error'; message: string }
  | { type: 'recovery'; scope: string; id: string; active: string[]; drafts: RecoveryDraft[]; baseRevision?: number }
  | { type: 'stored'; id: string; generation: number; stored: boolean }
  | { type: 'dismissed'; id: string; generation: number; dismissed: boolean }
  | { type: 'copied'; id: number; copied: boolean }
  | { type: 'action'; action: NativeAction }
  | { type: 'resourceResult'; id: number; ok: boolean; image?: string }

const record = isRecord
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
const normalized = (value: unknown): value is string => typeof value === 'string' && !value.includes('\r')

function isSplice(value: unknown): value is Splice {
  return record(value) && integer(value.from) && integer(value.to) && value.from <= value.to && normalized(value.text)
}

export function isPendingCheckpoint(value: unknown): value is PendingCheckpoint {
  return record(value) && !('source' in value) && integer(value.baseRevision) &&
    (value.change === undefined || isSplice(value.change)) &&
    isRecoveryDraft({ ...value, source: '', reason: 'pending' })
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!record(value)) return false
  if (value.type === 'ready' || value.type === 'status') return true
  if (value.type === 'edit') return integer(value.id, 1) && integer(value.revision) && isSplice(value.change)
  if (value.type === 'checkpoint') return isRecoveryDraft(value.draft) || isPendingCheckpoint(value.draft)
  if (value.type === 'dismiss') return isId(value.id) && isGeneration(value.generation)
  if (value.type === 'abandon') return isGeneration(value.id)
  if (value.type === 'copy') return isGeneration(value.id) && typeof value.text === 'string'
  if (value.type === 'resource') return isGeneration(value.id) && (value.operation === 'image' || value.operation === 'open') &&
    typeof value.reference === 'string' && value.reference.length > 0 && value.reference.length <= 4096
  if (value.type === 'cancelResource') return isGeneration(value.id)
  return value.type === 'command' && (value.command === 'save' || value.command === 'undo' || value.command === 'redo')
}

function isDocumentMetadata(value: unknown): value is DocumentMetadata {
  return record(value) && isUri(value.uri) &&
    typeof value.title === 'string' && integer(value.revision) &&
    (value.bom === undefined || typeof value.bom === 'boolean') &&
    typeof value.dirty === 'boolean' && typeof value.available === 'boolean' && (value.eol === '\n' || value.eol === '\r\n')
}

function isDocumentState(value: unknown): value is DocumentState {
  return record(value) && normalized(value.source) && isDocumentMetadata(value)
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (!record(value)) return false
  if (value.type === 'error') return typeof value.message === 'string'
  if (value.type === 'recovery') return typeof value.scope === 'string' && /^[\da-f]{64}$/.test(value.scope) &&
    isId(value.id) && Array.isArray(value.active) && value.active.every(isId) &&
    (value.baseRevision === undefined || integer(value.baseRevision)) &&
    Array.isArray(value.drafts) && value.drafts.every(isRecoveryDraft)
  if (value.type === 'stored') return isId(value.id) && isGeneration(value.generation) && typeof value.stored === 'boolean'
  if (value.type === 'dismissed') return isId(value.id) && isGeneration(value.generation) && typeof value.dismissed === 'boolean'
  if (value.type === 'copied') return isGeneration(value.id) && typeof value.copied === 'boolean'
  if (value.type === 'accepted') return record(value.state) && !('source' in value.state) &&
    isDocumentMetadata(value.state) && value.state.available && record(value.edit) && isGeneration(value.edit.id)
  if (value.type === 'action') return isNativeAction(value.action)
  if (value.type === 'resourceResult') return isGeneration(value.id) && typeof value.ok === 'boolean' &&
    (value.image === undefined || (typeof value.image === 'string' && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon);base64,/.test(value.image)))
  if (value.type !== 'state' || !isDocumentState(value.state)) return false
  const edit = value.edit
  return edit === undefined || (record(edit) && integer(edit.id, 1) && typeof edit.accepted === 'boolean' &&
    (edit.message === undefined || typeof edit.message === 'string'))
}

export function connectionMessage<T>(value: unknown, validate: (message: unknown) => message is T) {
  if (record(value) && isId(value.connection) && validate(value.message)) {
    return { connection: value.connection, message: value.message }
  }
}

function splitsSurrogate(source: string, offset: number) {
  const before = source.charCodeAt(offset - 1)
  const after = source.charCodeAt(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

export function sourceChange(before: string, after: string): Splice | undefined {
  if (before === after) return
  let from = 0
  let to = before.length
  let end = after.length
  const step = 4096
  const common = Math.min(to, end)
  while (from + step <= common && before.startsWith(after.slice(from, from + step), from)) from += step
  while (from < Math.min(to, end) && before[from] === after[from]) from++
  while (to - from >= step && end - from >= step && before.startsWith(after.slice(end - step, end), to - step)) {
    to -= step
    end -= step
  }
  while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end-- }
  if (splitsSurrogate(before, from) || splitsSurrogate(after, from)) from--
  if (splitsSurrogate(before, to) || splitsSurrogate(after, end)) { to++; end++ }
  return { from, to, text: after.slice(from, end) }
}

export function spliceSource(source: string, change: Splice): string {
  if (change.from < 0 || change.to < change.from || change.to > source.length) {
    throw new RangeError('The Markdown edit range is outside the document.')
  }
  return source.slice(0, change.from) + change.text + source.slice(change.to)
}

/** Rebase only if the changed ranges are provably independent. */
export function rebaseSource(base: string, local: string, native: string): string | undefined {
  if (local === native || local === base) return native
  if (native === base) return local
  const left = sourceChange(base, local)!
  const right = sourceChange(base, native)!
  if (left.from === left.to && right.from === right.to && left.from === right.from) return
  if (left.to <= right.from) return spliceSource(native, left)
  if (right.to <= left.from) {
    const shift = right.text.length - (right.to - right.from)
    return spliceSource(native, { ...left, from: left.from + shift, to: left.to + shift })
  }
}
