import { useEffect, useRef, useState } from 'react'
import { CircleAlert, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { Modal } from './controls'
import { PdfViewer } from './pdf/PdfViewer'
import type { ExportNotice, Margins, Orientation, PageSize, PdfPageOptions, PrintDocument } from '../document/pdfExport/model'

const sizes: [PageSize, string][] = [['letter', 'Letter (8.5 × 11 in)'], ['a4', 'A4 (210 × 297 mm)']]
const orientations: [Orientation, string][] = [['portrait', 'Portrait'], ['landscape', 'Landscape']]
const margins: [Margins, string][] = [['narrow', 'Narrow (0.5 in)'], ['normal', 'Normal (1 in)'], ['wide', 'Wide (1.5 in)']]
const effects = { preserved: 'Preserved', approximated: 'Approximated', omitted: 'Omitted' } as const

export function pdfFilename(title: string) {
  // eslint-disable-next-line no-control-regex -- Remove controls and characters that are invalid in filenames.
  const stem = title.replace(/\.(?:md|markdown|txt|docx)$/i, '').replace(/[\u0000-\u001f<>:"/\\|?*]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return (stem || 'Document').slice(0, 150) + '.pdf'
}

export function validPdfFilename(value: string) {
  // eslint-disable-next-line no-control-regex -- Match the VS Code host's filename check.
  return value.length <= 200 && /\.pdf$/i.test(value) && !/[\u0000-\u001f<>:"/\\|?*]/u.test(value) && !/^\.+$/.test(value) && !/[. ]$/.test(value.slice(0, -4)) && value.trim() === value
}

interface Props {
  title: string
  /** Builds the print model from the snapshot captured when the dialog opened. */
  build(signal: AbortSignal): Promise<PrintDocument>
  isCurrent(): boolean
  deliver(filename: string, bytes: Uint8Array): Promise<string | undefined>
  deliveryLabel: string
  close(): void
  restart(): void
  notify(message: string): void
}

type Preview = { status: 'idle' } | { status: 'working'; step: string } | { status: 'ready'; bytes: Uint8Array; pages: number; key: string } | { status: 'error'; message: string }

export function PdfExportDialog({ title, build, isCurrent, deliver, deliveryLabel, close, restart, notify }: Props) {
  const [options, setOptions] = useState<PdfPageOptions>({ size: 'letter', orientation: 'portrait', margins: 'normal' })
  const [filename, setFilename] = useState(() => pdfFilename(title))
  const [print, setPrint] = useState<PrintDocument>()
  const [notices, setNotices] = useState<ExportNotice[]>([])
  const [preview, setPreview] = useState<Preview>({ status: 'working', step: 'Preparing content…' })
  const [stale, setStale] = useState(false)
  const [delivering, setDelivering] = useState(false)
  const lifetime = useRef(new AbortController())
  const buildRef = useRef(build)

  useEffect(() => {
    const controller = lifetime.current
    void (async () => {
      try {
        const model = await buildRef.current(controller.signal)
        const { reviewNotices } = await import('../document/pdfExport/browser')
        if (controller.signal.aborted) return
        setNotices(reviewNotices(model))
        setPrint(model)
      } catch (error) {
        if (!controller.signal.aborted) setPreview({ status: 'error', message: error instanceof Error ? error.message : 'The document could not be prepared for PDF export.' })
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!print) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, lifetime.current.signal])
    setPreview({ status: 'working', step: 'Generating PDF preview…' })
    void (async () => {
      try {
        const { createPdf } = await import('../document/pdfExport/browser')
        const { bytes, validation } = await createPdf(print, options, signal)
        if (!signal.aborted) setPreview({ status: 'ready', bytes, pages: validation.pageCount, key: JSON.stringify(options) })
      } catch (error) {
        if (!signal.aborted) setPreview({ status: 'error', message: 'Folio could not create a valid PDF. Your document is unchanged. ' + (error instanceof Error ? error.message : '') })
      }
    })()
    return () => controller.abort()
  }, [print, options])

  function cancel() {
    lifetime.current.abort()
    close()
  }

  async function confirm() {
    if (preview.status !== 'ready' || delivering) return
    if (!isCurrent()) { setStale(true); return }
    setDelivering(true)
    try {
      const message = await deliver(filename, preview.bytes)
      if (message === undefined) return
      notify(message)
      close()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The PDF copy could not be saved.')
    } finally { setDelivering(false) }
  }

  const option = <T extends string>(label: string, value: T, choices: [T, string][], update: (value: T) => void) =>
    <label className="field">{label}<select value={value} disabled={!print || delivering} onChange={event => update(event.target.value as T)}>
      {choices.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select></label>

  return <Modal title="Export PDF" close={cancel} wide>
    <div className="dialog-form pdf-export">
      <div className="pdf-export-options">
        {option('Page size', options.size, sizes, size => setOptions(previous => ({ ...previous, size })))}
        {option('Orientation', options.orientation, orientations, orientation => setOptions(previous => ({ ...previous, orientation })))}
        {option('Margins', options.margins, margins, value => setOptions(previous => ({ ...previous, margins: value })))}
        <label className="field pdf-export-name">File name<input value={filename} spellCheck={false} onChange={event => setFilename(event.target.value)} aria-invalid={!validPdfFilename(filename)} /></label>
      </div>
      {!validPdfFilename(filename) && <p className="field-error">Enter a file name ending in .pdf without path separators or reserved characters.</p>}
      {notices.length > 0 && <details className="pdf-export-notices" open>
        <summary>Fidelity review · {notices.filter(notice => notice.effect !== 'preserved').length} changes</summary>
        <ul className="export-diagnostics">{notices.map((notice, index) => <li key={index}>
          <strong>{[notice.feature, notice.location].filter(Boolean).join(' · ')}</strong><span>{notice.message}</span><span className="muted">{effects[notice.effect]}</span>
        </li>)}</ul>
      </details>}
      <div className="pdf-export-preview" aria-live="polite">
        {preview.status === 'working' && <div className="opening-state" role="status"><LoaderCircle size={18} className="spinner" /> {preview.step}</div>}
        {preview.status === 'error' && <div className="pdf-state pdf-error" role="alert"><CircleAlert size={18} /><p>{preview.message}</p></div>}
        {preview.status === 'ready' && <PdfViewer preview bytes={preview.bytes} documentKey={preview.key} label="PDF preview" notify={notify} />}
      </div>
      {preview.status === 'ready' && <p className="muted" role="status">Preview validated · {preview.pages.toLocaleString()} {preview.pages === 1 ? 'page' : 'pages'}. The source document is unchanged.</p>}
      {stale && <p className="field-error" role="alert">The document changed after this preview was generated. Start a new export from the current revision.</p>}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" data-dialog-focus onClick={cancel}>Cancel</button>
        {stale ? <button type="button" className="primary-button" onClick={restart}><RefreshCw size={14} /> Review current revision</button>
          : <button type="button" className="primary-button" disabled={preview.status !== 'ready' || delivering || !validPdfFilename(filename)} onClick={() => void confirm()}>
            <Download size={14} /> {delivering ? 'Saving…' : deliveryLabel}</button>}
      </div>
    </div>
  </Modal>
}
