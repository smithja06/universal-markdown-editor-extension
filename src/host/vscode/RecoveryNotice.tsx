import { useState } from 'react'
import type { LiveDocumentSnapshot } from '../contracts'
import { recoveryMarkdown, type RecoveryDraft, type RecoveryText } from './recovery'

interface RecoveryActions {
  copy(text: string): Promise<void>
  discard(id: string): void
  notify(message: string): void
}

function RecoveryItem({ draft, currentUri, copy, discard, notify }: RecoveryActions & {
  draft: RecoveryDraft
  currentUri: string
}) {
  const [copying, setCopying] = useState(false)
  const native = draft.native
  async function copyVersion(text: RecoveryText) {
    setCopying(true)
    try {
      await copy(recoveryMarkdown(text))
      notify('Markdown copied')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    } finally { setCopying(false) }
  }

  return <article className="host-recovery">
    <p>{draft.reason === 'conflict' ? 'Folio and VS Code changed the same Markdown. Both versions are available for review.' :
      'Folio recovered a draft that may contain edits missing from VS Code.'}</p>
    {draft.uri !== currentUri && <p className="host-recovery-uri">{draft.uri}</p>}
    <div>
      <button type="button" className="secondary-button" disabled={copying} onClick={() => void copyVersion(draft)}>Copy pending draft</button>
      <button type="button" className="secondary-button" disabled={copying} onClick={() => discard(draft.id)}>Discard pending draft</button>
    </div>
    <details><summary>View pending Markdown</summary><textarea aria-label="Pending Markdown" readOnly value={draft.source} /></details>
    {native && <details><summary>View VS Code Markdown at recovery</summary>
      <button type="button" className="secondary-button" disabled={copying} onClick={() => void copyVersion(native)}>Copy VS Code version</button>
      <textarea aria-label="VS Code Markdown at recovery" readOnly value={native.source} />
    </details>}
  </article>
}

export function RecoveryNotice({ state, ...actions }: RecoveryActions & { state: LiveDocumentSnapshot }) {
  const { id, message, recoveryWarning, recovery = [] } = state
  if (!message && !recoveryWarning && recovery.length === 0) return null

  return <section className="host-notice" aria-label="VS Code synchronization">
    {message && <p role="alert">{message}</p>}
    {recoveryWarning && <p role="alert">{recoveryWarning}</p>}
    {recovery.map(draft => <RecoveryItem key={draft.id} draft={draft} currentUri={id} {...actions} />)}
  </section>
}
