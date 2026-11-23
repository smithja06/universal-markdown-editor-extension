import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { DiagramPreview } from '../editor/nodeViews'
import { safeUrl } from '../editor/schema'
import type { FolioHost } from '../host/contracts'
import { Modal } from './controls'

export type DialogName = 'link' | 'image' | 'table' | 'mermaid' | 'inlineMath' | 'blockMath' | 'wikiLink' | 'footnote' | 'reference'
export interface InsertRequest {
  name: DialogName
  position?: number
  preset?: string
  imageTarget?: {
    revision(): number
    range?: { from: number; to: number }
    insertSource?(url: string, alt: string): void
  }
}

type WorkspacePicker = Pick<NonNullable<FolioHost['resources']>, 'pickWorkspaceImage' | 'confirmWorkspaceImage'>

const labels: Record<DialogName, string> = {
  link: 'Insert link', image: 'Insert image', table: 'Insert table', mermaid: 'Mermaid diagram',
  inlineMath: 'Inline equation', blockMath: 'Block equation', wikiLink: 'Wiki link', footnote: 'Footnote', reference: 'Reference link',
}

export const diagramPresets = {
  Flowchart: 'flowchart LR\n  A[Draft] --> B[Review]\n  B --> C[Publish]',
  'Sequence diagram': 'sequenceDiagram\n  participant W as Writer\n  participant R as Reviewer\n  W->>R: Share draft\n  R-->>W: Send feedback',
  'Class diagram': 'classDiagram\n  Document <|-- MarkdownDocument\n  class Document {\n    +String title\n    +save()\n  }',
  'State diagram': 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Published\n  Published --> [*]',
}

export function InsertDialog({ request, editor, anchors, close, chooseLocalImage, workspacePicker }: {
  request: InsertRequest; editor: Editor; anchors: { anchor: string; title: string }[]; close(): void; chooseLocalImage?(): void; workspacePicker?: WorkspacePicker
}) {
  const { name, imageTarget } = request
  const sourceImage = !!imageTarget?.insertSource
  const selection = editor.state.selection
  const node = request.position !== undefined ? editor.state.doc.nodeAt(request.position) : selection instanceof NodeSelection ? selection.node : null
  const link = editor.getAttributes('link')
  const selectionText = editor.state.doc.textBetween(selection.from, selection.to, ' ')
  const wasLink = editor.isActive('link')
  const isImage = !sourceImage && !imageTarget?.range && node?.type.name === 'image'
  const isEquation = name === 'inlineMath' || name === 'blockMath'
  const [value, setValue] = useState<string>(name === 'link' ? link.href ?? request.preset ?? '' : name === 'image' ? isImage ? node.attrs.src : '' : node?.attrs.value ?? request.preset ?? '')
  const [label, setLabel] = useState<string>(name === 'link' ? selectionText : isImage ? node.attrs.alt : '')
  const [caption, setCaption] = useState<string>(isImage ? node.attrs.caption ?? '' : '')
  const [width, setWidth] = useState<string>(isImage ? node.attrs.width ?? '' : '')
  const [align, setAlign] = useState<string>(isImage ? node.attrs.align ?? '' : '')
  const [rows, setRows] = useState(3)
  const [columns, setColumns] = useState(3)
  const [header, setHeader] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const picked = useRef<number | undefined>(undefined)
  const pending = useRef<AbortController | undefined>(undefined)
  const altField = useRef<HTMLInputElement>(null)
  useEffect(() => () => pending.current?.abort(), [])

  function closeDialog() {
    pending.current?.abort()
    close()
  }

  async function checkImage(perform: (revision: number, signal: AbortSignal) => Promise<void>) {
    if (!imageTarget || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError('')
    try { await perform(imageTarget.revision(), controller.signal) }
    catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Folio could not validate this image.')
    } finally {
      pending.current = undefined
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function browse() {
    if (!workspacePicker || !imageTarget) return
    void checkImage(async (revision, signal) => {
      const result = await workspacePicker.pickWorkspaceImage(revision, signal)
      if (!result || signal.aborted) return
      imageTarget.revision()
      picked.current = result.id
      setValue(result.reference)
      requestAnimationFrame(() => altField.current?.focus())
    })
  }

  function insertImage(input: string, alt: string) {
    if (imageTarget?.insertSource) {
      imageTarget.insertSource(input, alt)
      close()
      return
    }
    const command = editor.chain().focus()
    if (request.position !== undefined) command.setNodeSelection(request.position)
    const attrs = { src: input, alt, caption: caption.trim() || null, width: width || null, align: align || null, title: isImage ? node.attrs.title : null }
    const image = { type: 'image', attrs }
    const result = isImage ? command.updateAttributes('image', attrs).run()
      : imageTarget?.range ? command.insertContentAt(imageTarget.range, image).run() : command.insertContent(image).run()
    if (result) close()
    else setError('Move the cursor to a part of the document that accepts this content.')
  }

  function submit(form: HTMLFormElement | null) {
    if (pending.current || !form?.reportValidity()) return
    const input = value.trim()
    if (name === 'image') {
      if (!safeUrl(input, true)) {
        setError(workspacePicker ? 'Enter an image URL or browse for a workspace image.' : 'Enter an image URL or select a local image.')
        return
      }
      if (!imageTarget) { insertImage(input, label.trim()); return }
      const selection = picked.current
      void checkImage(async (revision, signal) => {
        if (selection !== undefined) await workspacePicker?.confirmWorkspaceImage(selection, revision, signal)
        if (signal.aborted) return
        imageTarget.revision()
        insertImage(input, label.trim())
      })
      return
    }
    const command = editor.chain().focus()
    if (request.position !== undefined) command.setNodeSelection(request.position)
    let result: boolean
    if (name === 'link') {
      if (!safeUrl(input)) { setError('Enter a URL, file path, or heading anchor.'); return }
      result = selection.empty && !wasLink
        ? command.insertContent({ type: 'text', text: label.trim() || input, marks: [{ type: 'link', attrs: { href: input } }] }).run()
        : command.extendMarkRange('link').setLink({ href: input }).run()
    } else if (name === 'table') {
      result = command.insertTable({ rows, cols: columns, withHeaderRow: header }).run()
    } else if (name === 'footnote' || name === 'reference') {
      const identifier = label.trim()
      if (!/^[\p{Letter}\p{Number}_-]+$/u.test(identifier)) { setError('Use letters, numbers, hyphens, or underscores for the identifier.'); return }
      if (!input || (name === 'reference' && !safeUrl(input))) { setError('Enter a valid ' + (name === 'footnote' ? 'footnote.' : 'URL.')); return }
      const isFootnote = name === 'footnote'
      const definition = isFootnote ? '[^' + identifier + ']: ' + input.replace(/\n/g, '\n    ') : '[' + identifier + ']: <' + input.replace(/[<>]/g, encodeURIComponent) + '>'
      const display = isFootnote ? '[^' + identifier + ']' : '[' + (selectionText.replace(/[[\]]/g, '') || identifier) + '][' + identifier + ']'
      if (editor.state.doc.children.some(block => block.type.name === 'rawBlock' && String(block.attrs.value).toLowerCase().startsWith((isFootnote ? '[^' : '[') + identifier.toLowerCase() + ']:'))) {
        setError('This identifier already has a definition.'); return
      }
      result = command.insertContent({ type: 'rawInline', attrs: { value: display, label: display } }).command(({ tr }) => {
        tr.insert(tr.doc.content.size, editor.schema.nodes.rawBlock.create({ value: definition }))
        return true
      }).run()
    } else {
      if (!input) { setError('Enter ' + (name === 'mermaid' ? 'Mermaid code.' : isEquation ? 'a LaTeX expression.' : 'a wiki link target.')); return }
      if (name === 'wikiLink' && /[\r\n\]]/.test(input)) { setError('The wiki link must fit on one line without closing brackets.'); return }
      const attrs = { value: name === 'mermaid' || isEquation ? value : input, ...(name === 'wikiLink' ? { label: input.split('|').at(-1) } : {}) }
      result = request.position === undefined ? command.insertContent({ type: name, attrs }).run() : command.updateAttributes(name, attrs).run()
    }
    if (result) close()
    else setError('Move the cursor to a part of the document that accepts this content.')
  }

  const setBounded = (value: string, update: (n: number) => void) => update(Math.min(20, Math.max(1, Number(value) || 1)))
  return <Modal title={labels[name]} close={closeDialog} wide={name === 'mermaid'}>
    <form className="dialog-form" onSubmit={event => event.preventDefault()} onKeyDown={event => {
      // VS Code's webview sandbox can block the native submit event.
      if (event.key !== 'Enter' || event.nativeEvent.isComposing ||
          !(event.target instanceof HTMLInputElement) || event.target.type === 'checkbox') return
      event.preventDefault()
      submit(event.currentTarget)
    }}>
      {name === 'table' && <>
        <div className="table-picker" role="group" aria-label="Table size grid">{Array.from({ length: 6 }, (_, row) => Array.from({ length: 8 }, (_, column) =>
          <button key={row + '-' + column} type="button" tabIndex={-1} className={row < rows && column < columns ? 'selected' : ''} title={(row + 1) + ' rows by ' + (column + 1) + ' columns'} aria-label={(row + 1) + ' rows by ' + (column + 1) + ' columns'} onMouseEnter={() => { setRows(row + 1); setColumns(column + 1) }} onClick={() => { setRows(row + 1); setColumns(column + 1) }} />
        ))}</div>
        <div className="field-row"><label className="field">Rows<input data-dialog-focus type="number" min={1} max={20} value={rows} onChange={event => setBounded(event.target.value, setRows)} /></label><label className="field">Columns<input type="number" min={1} max={20} value={columns} onChange={event => setBounded(event.target.value, setColumns)} /></label></div>
        <label className="check-field"><input type="checkbox" checked={header} onChange={event => setHeader(event.target.checked)} /> Include a header row</label>
      </>}
      {name === 'link' && <>
        {!wasLink && selection.empty && <label className="field">Link text<input value={label} onChange={event => setLabel(event.target.value)} placeholder="Text to display" /></label>}
        <label className="field">Destination<input data-dialog-focus value={value} onChange={event => setValue(event.target.value)} placeholder="https://, #heading, or ./file.md" /></label>
        {anchors.length > 0 && <label className="field">Link to a heading<select value={value.startsWith('#') ? value : ''} onChange={event => setValue(event.target.value)}><option value="">Choose a heading</option>{anchors.map(item => <option key={item.anchor} value={'#' + item.anchor}>{item.title}</option>)}</select></label>}
      </>}
      {name === 'image' && <>
        <label className="field">Image URL<input data-dialog-focus disabled={busy} value={value} onChange={event => { picked.current = undefined; setValue(event.target.value) }} placeholder={workspacePicker ? './media/image.png' : 'https://example.com/image.png'} /></label>
        {workspacePicker && <button className="secondary-button upload-button" type="button" disabled={busy} onClick={browse}>Browse workspace images</button>}
        {chooseLocalImage && <button className="secondary-button upload-button" type="button" onClick={() => { close(); chooseLocalImage() }}>Choose a local image</button>}
        <label className="field">Alternative text<input ref={altField} disabled={busy} value={label} onChange={event => setLabel(event.target.value)} placeholder="Describe the image" /></label>
        {!sourceImage && <>
          <label className="field">Caption<input disabled={busy} value={caption} onChange={event => setCaption(event.target.value)} placeholder="Optional caption" /></label>
          <div className="field-row"><label className="field">Width in pixels<input disabled={busy} type="number" min={24} max={2400} value={width} onChange={event => setWidth(event.target.value)} placeholder="Automatic" /></label><label className="field">Alignment<select disabled={busy} value={align} onChange={event => setAlign(event.target.value)}><option value="">Inline</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></div>
        </>}
      </>}
      {name === 'mermaid' && <>
        <label className="field">Diagram template<select value="" onChange={event => setValue(diagramPresets[event.target.value as keyof typeof diagramPresets])}><option value="">Choose a template</option>{Object.keys(diagramPresets).map(key => <option key={key}>{key}</option>)}</select></label>
        <div className="diagram-editor"><label className="field">Mermaid source<textarea data-dialog-focus rows={9} spellCheck={false} value={value} onChange={event => setValue(event.target.value)} /></label><div><span>Preview</span><div className="dialog-preview"><DiagramPreview value={value} /></div></div></div>
      </>}
      {isEquation && <label className="field">LaTeX expression<textarea data-dialog-focus spellCheck={false} rows={3} value={value} onChange={event => setValue(event.target.value)} placeholder="x^2 + y^2 = z^2" /></label>}
      {name === 'wikiLink' && <label className="field">Target or target|label<input data-dialog-focus value={value} onChange={event => setValue(event.target.value)} placeholder="Project notes|Notes" /></label>}
      {(name === 'footnote' || name === 'reference') && <>
        <label className="field">Identifier<input data-dialog-focus value={label} onChange={event => setLabel(event.target.value)} placeholder={name === 'footnote' ? 'note' : 'reference'} /></label>
        <label className="field">{name === 'footnote' ? 'Footnote text' : 'Destination'}<textarea rows={name === 'footnote' ? 3 : 1} value={value} onChange={event => setValue(event.target.value)} /></label>
      </>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {name === 'link' && wasLink && <button type="button" className="danger-button" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); close() }}>Remove link</button>}
        <button type="button" className="secondary-button" onClick={closeDialog}>Cancel</button>
        <button type="button" className="primary-button" disabled={busy} onClick={event => submit(event.currentTarget.form)}>{request.position !== undefined || isImage && name === 'image' || wasLink && name === 'link' ? 'Apply' : 'Insert'}</button>
      </div>
    </form>
  </Modal>
}
