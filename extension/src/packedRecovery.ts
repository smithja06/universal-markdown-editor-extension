import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { isPendingCheckpoint, spliceSource, type PendingCheckpoint } from '../../src/host/vscode/protocol'
import { isRecord, isRecoveryDraft, type RecoveryDraft } from '../../src/host/vscode/recovery'

interface EncodedBase { data: string; units: number }
export type PackedRecovery = PendingCheckpoint & { encoding: 'deflate-utf16-v1'; base: EncodedBase }

export function encodeRecoveryBase(source: string): EncodedBase {
  return { data: deflateRawSync(Buffer.from(source, 'utf16le'), { level: 1 }).toString('base64'), units: source.length }
}

function isPackedRecovery(value: unknown): value is PackedRecovery {
  if (!isRecord(value) || value.encoding !== 'deflate-utf16-v1' || !isRecord(value.base)) return false
  const { units, data } = value.base
  return typeof data === 'string' && typeof units === 'number' && Number.isSafeInteger(units) && units > 0 &&
    isPendingCheckpoint(value) && (value.change === undefined || value.change.to <= units)
}

export function recoveryGeneration(value: unknown) {
  if (isRecoveryDraft(value) || isPackedRecovery(value)) return value.generation
  return 0
}

export function unpackRecovery(value: unknown): RecoveryDraft | undefined {
  if (isRecoveryDraft(value)) return value
  if (!isPackedRecovery(value)) return
  try {
    const { id, uri, generation, eol, bom, base, change } = value
    const bytes = inflateRawSync(Buffer.from(base.data, 'base64'), { maxOutputLength: base.units * 2 })
    if (bytes.length !== base.units * 2) return
    const source = bytes.toString('utf16le')
    const draft = { id, uri, generation, eol, bom, reason: 'pending', source: change ? spliceSource(source, change) : source }
    if (isRecoveryDraft(draft)) return draft
  } catch { /* A corrupt entry must not prevent recovering other drafts. */ }
}
