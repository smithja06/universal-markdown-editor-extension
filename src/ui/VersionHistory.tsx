import { createElement, Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { History, Plus } from 'lucide-react'
import type { JSONContent } from '@tiptap/core'
import { Modal } from './controls'
import type { DocumentFormat } from '../document/formats/content'
import { automaticVersionLimit, versionStorageError, type DocumentVersion, type VersionSummary } from '../document/versions'
import type { DocumentStorage } from '../host/contracts'

const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const calendarDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' })
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const labels = { automatic: 'Automatic', manual: 'Manual', recovery: 'Recovery' }

const docxTags = {
  paragraph: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li',
  tableRow: 'tr', tableCell: 'td', tableHeader: 'th',
} as const
const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

function docxPreview(node: JSONContent): ReactNode {
  const children = (node.content ?? []).map((child, index) => <Fragment key={index}>{docxPreview(child)}</Fragment>)
  switch (node.type) {
    case 'doc': return children
    case 'heading': return createElement(headingTags[Number(node.attrs?.level) - 1] ?? 'h1', null, children)
    case 'orderedList': return <ol start={node.attrs?.start}>{children}</ol>
    case 'table': {
      const header = node.content?.[0]?.content?.[0]?.type === 'tableHeader'
      return <div className="tableWrapper"><table>
        {header && <thead>{children[0]}</thead>}
        <tbody>{header ? children.slice(1) : children}</tbody>
      </table></div>
    }
    case 'text':
    case 'hardBreak': {
      let content: ReactNode = node.type === 'text' ? node.text : <br />
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bold') content = <strong>{content}</strong>
        if (mark.type === 'italic') content = <em>{content}</em>
        if (mark.type === 'underline') content = <u>{content}</u>
        if (mark.type === 'link') content = <span className="version-docx-link" title={mark.attrs?.href}>{content}</span>
      }
      return content
    }
    default: {
      const tag = docxTags[node.type as keyof typeof docxTags]
      return tag ? createElement(tag, null, children) : children
    }
  }
}

function relativeTime(value: number) {
  const seconds = Math.max(0, (Date.now() - value) / 1000)
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86400) return relative.format(-Math.floor(seconds / 3600), 'hour')
  return relative.format(-Math.floor(seconds / 86400), 'day')
}

interface Props {
  documentId: string
  title: string
  theme: 'light' | 'dark'
  automaticError: string
  format?: DocumentFormat
  load(documentId: string): Promise<VersionSummary[]>
  read: DocumentStorage['readVersion']
  create(): ReturnType<DocumentStorage['recordVersion']>
  restore(version: DocumentVersion): Promise<void>
  close(): void
}

export function VersionHistory({ documentId, title, theme, automaticError, format, load, read, create, restore, close }: Props) {
  const [versions, setVersions] = useState<VersionSummary[]>()
  const [selection, setSelection] = useState<{ id: string }>()
  const [preview, setPreview] = useState<DocumentVersion>()
  const [rendered, setRendered] = useState('')
  const [mode, setMode] = useState<'rendered' | 'markdown'>('rendered')
  const [busy, setBusy] = useState<'create' | 'restore'>()
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [reload, setReload] = useState(0)
  const restoreButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)

  useLayoutEffect(() => {
    if (!confirm && restoreFocus.current) {
      restoreFocus.current = false
      restoreButton.current?.focus({ preventScroll: true })
    }
  }, [confirm])

  useEffect(() => {
    let active = true
    void load(documentId).then(items => { if (active) setVersions(items) }, failure => { if (active) setError(versionStorageError(failure)) })
    return () => { active = false }
  }, [documentId, load, reload])

  useEffect(() => {
    if (!selection) return
    let active = true
    void read(documentId, selection.id).then(version => {
      if (!active) return
      if (version) setPreview(version)
      else setError('This version is no longer available.')
    }, failure => { if (active) setError(versionStorageError(failure)) })
    return () => { active = false }
  }, [documentId, read, selection])

  useEffect(() => {
    if (!preview || preview.content.format === 'txt' || preview.content.format === 'docx' || mode !== 'rendered') return
    let active = true
    void import('../document/export').then(module => module.renderVersionPreview(preview.content.source)).then(
      html => { if (active) setRendered(html) },
      () => { if (active) { setMode('markdown'); setError('The rendered preview could not be loaded. Raw Markdown is available below.') } },
    )
    return () => { active = false }
  }, [mode, preview])

  function select(id: string) {
    if (id === selection?.id && preview) return
    setSelection({ id })
    setPreview(undefined)
    setRendered('')
    setError('')
    setConfirm(false)
  }

  async function saveVersion() {
    setBusy('create')
    setError('')
    setStatus('')
    try {
      const result = await create()
      setVersions(await load(documentId))
      select(result.version.id)
      setStatus(result.status === 'existing' ? 'This version is already saved.' : 'Version saved.')
    } catch (failure) { setError(versionStorageError(failure)) }
    finally { setBusy(undefined) }
  }

  async function restoreSelected() {
    if (!preview || busy) return
    setBusy('restore')
    setError('')
    try { await restore(preview); close() }
    catch (failure) { setError(versionStorageError(failure)); setBusy(undefined) }
  }

  const groups = new Map<string, VersionSummary[]>()
  for (const version of versions ?? []) {
    const day = calendarDate.format(version.createdAt)
    const group = groups.get(day)
    if (group) group.push(version)
    else groups.set(day, [version])
  }
  const bytes = versions?.reduce((total, version) => total + version.bytes, 0) ?? 0
  const storage = new Intl.NumberFormat(undefined, { style: 'unit', unit: bytes < 1_000_000 ? 'kilobyte' : 'megabyte', maximumFractionDigits: 1 }).format(bytes / (bytes < 1_000_000 ? 1000 : 1_000_000))

  return <Modal title="Version History" wide close={() => { if (!busy) close() }} closeDisabled={!!busy}>
    <div className="version-history">
      <div className="version-history-top">
        <div><h3>{title}</h3><p className="muted">Versions stay in this browser and are separate from any cloud backup.</p></div>
        <button type="button" className="primary-button version-create" disabled={!!busy || confirm} onClick={() => void saveVersion()}><Plus size={15} />{busy === 'create' ? 'Saving version…' : 'Create version'}</button>
      </div>
      {(error || automaticError) && <p className="field-error version-feedback" role="alert">{error || automaticError}</p>}
      {status && <p className="muted version-feedback" role="status">{status}</p>}
      <div className="version-layout">
        <div className="version-list" aria-label="Saved versions" role="region" tabIndex={0}>
          {versions === undefined && (error ? <button type="button" className="secondary-button" disabled={!!busy} onClick={() => { setError(''); setReload(value => value + 1) }}>Retry loading versions</button> : <p className="muted" role="status">Loading versions…</p>)}
          {versions?.length === 0 && <p className="muted">Create a version to keep a checkpoint of this document.</p>}
          {Array.from(groups, ([label, entries]) => <section key={label}>
            <h4>{label}</h4>
            <ol>{entries.map(item => <li key={item.id}>
              <button type="button" className="version-row" aria-pressed={selection?.id === item.id} disabled={!!busy} onClick={() => select(item.id)}>
                <span className="sr-only">Preview version</span>
                <span className="version-row-time"><time dateTime={new Date(item.createdAt).toISOString()}>{timestamp.format(item.createdAt)}</time><span className={`version-kind version-${item.kind}`}>{labels[item.kind]}</span></span>
                <span className="version-row-title">{item.title}</span>
                <span className="muted version-row-time"><span>{relativeTime(item.createdAt)}</span><span className="version-id" title={item.id}>{item.id.slice(0, 8)}</span></span>
              </button>
            </li>)}</ol>
          </section>)}
        </div>
        <div className="version-preview">
          {!preview && <div className="version-empty"><History size={22} aria-hidden="true" />{selection && error
            ? <button type="button" className="secondary-button" disabled={!!busy} onClick={() => select(selection.id)}>Retry preview</button>
            : <p>{selection ? 'Loading preview…' : 'Choose a version to preview.'}</p>}</div>}
          {preview && <>
            <div className="version-preview-top">
              {preview.content.format !== 'txt' && preview.content.format !== 'docx' && <div role="group" aria-label="Preview format" className="version-formats">
                <button type="button" aria-pressed={mode === 'rendered'} onClick={() => setMode('rendered')}>Rendered</button>
                <button type="button" aria-pressed={mode === 'markdown'} onClick={() => setMode('markdown')}>Markdown</button>
              </div>}
              {!confirm && <button type="button" ref={restoreButton} className="secondary-button" disabled={!!busy} onClick={() => { setConfirm(true); setError(''); setStatus('') }}>Restore version</button>}
            </div>
            {confirm && <div className="version-confirm" role="group" aria-label="Confirm version restore">
              <p>Replace the active document with the version from {timestamp.format(preview.createdAt)}? Folio will keep your current draft in history so you can recover it.</p>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" autoFocus disabled={!!busy} onClick={() => { restoreFocus.current = true; setConfirm(false); setError('') }}>Cancel restore</button>
                <button type="button" className="primary-button" disabled={!!busy} onClick={() => void restoreSelected()}>{busy === 'restore' ? 'Restoring…' : 'Confirm restore'}</button>
              </div>
            </div>}
            {preview.content.format === 'docx'
              ? <div className="version-docx tiptap" role="region" aria-label="DOCX version preview" tabIndex={0}>{docxPreview(preview.content.document)}</div>
              : mode === 'markdown' || preview.content.format === 'txt' ? <pre className="version-markdown" role="region" aria-label={preview.content.format === 'txt' ? 'Plain text version preview' : 'Markdown version preview'} tabIndex={0}>{preview.content.source}</pre>
              : rendered ? <iframe className="version-frame" title="Rendered version preview" sandbox="" srcDoc={rendered} style={{ colorScheme: theme }} />
                : <p className="muted version-empty" role="status">Rendering preview…</p>}
          </>}
        </div>
      </div>
      <p className="muted version-footer">{storage} of {format === 'docx' ? 'DOCX' : format === 'txt' ? 'plain text' : 'Markdown'} stored for this document. Folio keeps the {automaticVersionLimit} most recent automatic checkpoints and retains versions you create or recover.</p>
    </div>
  </Modal>
}
