import { useState } from 'react'
import type { LiveDocumentSnapshot } from '../contracts'
import { docxText, readDocxSnapshot } from '../../document/formats/docx/model'
import { recoveryMarkdown, type RecoveryDraft, type RecoveryText } from './recovery'

interface RecoveryActions {
  copy(text: string): Promise<void>
  discard(id: string): void
  restore?(id: string): void
  notify(message: string): void
}

function RecoveryItem({ draft, currentUri, format, rich, originalFingerprint, copy, discard, restore, notify }: RecoveryActions & {
  draft: RecoveryDraft
  currentUri: string
  format: string
  rich: boolean
  originalFingerprint?: string
}) {
  const [copying, setCopying] = useState(false)
  const native = draft.native
  const originalChanged = rich && (!draft.originalFingerprint || draft.originalFingerprint !== originalFingerprint)
  function preview(source: string) {
    if (!rich) return source
    try { return docxText(readDocxSnapshot(source)) } catch { return source }
  }
  async function copyVersion(text: RecoveryText) {
    setCopying(true)
    try {
      await copy(recoveryMarkdown(text))
      notify(format + ' copied')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    } finally { setCopying(false) }
  }

  return <article className="host-recovery">
    <p>{draft.reason === 'conflict' ? `Folio and VS Code changed the same ${format}. Both versions are available for review.` :
      'Folio recovered a draft that may contain edits missing from VS Code.'}</p>
    {draft.uri !== currentUri && <p className="host-recovery-uri">{draft.uri}</p>}
    <div>
      <button type="button" className="secondary-button" disabled={copying} onClick={() => void copyVersion(draft)}>Copy pending draft</button>
      <button type="button" className="secondary-button" disabled={copying} onClick={() => discard(draft.id)}>Discard pending draft</button>
    </div>
    <details><summary>View pending {format}</summary><textarea aria-label={'Pending ' + format} readOnly value={preview(draft.source)} />
      {originalChanged && <p>This draft belongs to an earlier DOCX package. Copy the draft for review or open the matching original to restore it.</p>}
      {rich && restore && !originalChanged && draft.uri === currentUri && <button type="button" className="secondary-button" onClick={() => restore(draft.id)}>Restore draft as an edit</button>}
    </details>
    {native && <details><summary>View VS Code {format} at recovery</summary>
      <button type="button" className="secondary-button" disabled={copying} onClick={() => void copyVersion(native)}>Copy VS Code version</button>
      <textarea aria-label={'VS Code ' + format + ' at recovery'} readOnly value={preview(native.source)} />
    </details>}
  </article>
}

export function RecoveryNotice({ state, ...actions }: RecoveryActions & { state: LiveDocumentSnapshot }) {
  const { id, message, readOnly, notice, recoveryWarning, recovery = [] } = state
  if (!message && !readOnly && !notice && !recoveryWarning && recovery.length === 0) return null
  const format = state.format === 'txt' ? 'TXT' : state.format === 'docx' ? 'DOCX' : 'Markdown'

  return <section className="host-notice" aria-label="VS Code synchronization">
    {message && <p role="alert">{message}</p>}
    {readOnly && readOnly !== message && <p role="alert">{readOnly}</p>}
    {notice && <p role="status">{notice}</p>}
    {recoveryWarning && <p role="alert">{recoveryWarning}</p>}
    {recovery.map(draft => <RecoveryItem key={draft.id} draft={draft} currentUri={id} format={format} rich={state.format === 'docx'} originalFingerprint={state.originalFingerprint} {...actions}
      restore={state.available && !state.pending && state.conflict === undefined && !readOnly ? actions.restore : undefined} />)}
  </section>
}
