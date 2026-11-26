import { describe, expect, it } from 'vitest'
import { maxLocalDraft, pendingDraft, pendingRecord } from './spreadsheetJournal'

const fingerprint = 'a'.repeat(64)

describe('secondary spreadsheet journal', () => {
  it('stores small drafts whole and skips drafts the host already holds', () => {
    const record = pendingRecord('{"a":1}', '{"a":2}', fingerprint)!
    expect(JSON.parse(record)).toEqual({ fingerprint, source: '{"a":2}' })
    expect(pendingDraft(record, '{"a":1}', fingerprint)).toBe('{"a":2}')
    expect(pendingDraft(record, '{"a":2}', fingerprint)).toBeUndefined()
    expect(pendingDraft(record, '{"a":1}', 'b'.repeat(64))).toBeUndefined()
  })

  it('journals a verified splice for drafts above the whole-draft limit', () => {
    const base = '{"cells":"' + 'x'.repeat(maxLocalDraft) + '","value":1}'
    const draft = base.replace('"value":1', '"value":42')
    const record = pendingRecord(base, draft, fingerprint)!
    expect(record.length).toBeLessThan(1024)
    expect(pendingDraft(record, base, fingerprint)).toBe(draft)
    // The host already accepted the change, or holds a different draft: never apply it twice or elsewhere.
    expect(pendingDraft(record, draft, fingerprint)).toBeUndefined()
    expect(pendingDraft(record, base.replace('"value":1', '"value":7'), fingerprint)).toBeUndefined()
    expect(pendingDraft(record, base.replace('{"cells"', '{"cellz"'), fingerprint)).toBeUndefined()
  })

  it('reports drafts it cannot journal', () => {
    const huge = 'y'.repeat(maxLocalDraft + 10)
    expect(pendingRecord(undefined, huge, fingerprint)).toBeUndefined()
    expect(pendingRecord('', huge, fingerprint)).toBeUndefined()
  })
})
