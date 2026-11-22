import { lazy, Suspense, useEffect, useId, useState } from 'react'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Code2, FileCode2, GitFork, ListTree, Pencil } from 'lucide-react'
import { LazyBoundary } from '../LazyBoundary'
import { renderDiagram } from '../document/diagrams'
import { documentInfo } from '../document/metadata'
import { BlockMath, DocumentImage, InlineMath, MermaidBlock, RawBlock, Toc, WikiLink, safeUrl } from './schema'
import type { FolioHost } from '../host/contracts'

function MermaidPreview({ value, id }: { value: string; id: string }) {
  const [result, setResult] = useState<{ svg?: string; error?: string }>({})
  useEffect(() => {
    if (!value.trim()) { setResult({}); return }
    const controller = new AbortController()
    setResult({})
    async function render() {
      try {
        const svg = await renderDiagram(id, value, { mode: 'preview', signal: controller.signal })
        if (!controller.signal.aborted) setResult({ svg })
      } catch (error) {
        if (!controller.signal.aborted) setResult({ error: error instanceof Error ? error.message.split('\n')[0] : 'Invalid Mermaid syntax.' })
      }
    }
    const timeout = window.setTimeout(() => { void render() }, 260)
    return () => { controller.abort(); window.clearTimeout(timeout) }
  }, [value, id])
  if (!value.trim()) return <span className="muted">Enter Mermaid code to preview the diagram.</span>
  if (result.error) return <p className="field-error" role="status">{result.error}</p>
  return result.svg ? <div className="mermaid-result" dangerouslySetInnerHTML={{ __html: result.svg }} /> : <span className="muted">Rendering diagram…</span>
}

export function DiagramPreview({ value }: { value: string }) {
  const id = 'diagram-' + useId().replace(/[^a-z0-9-]/gi, '')
  return <MermaidPreview value={value} id={id} />
}

const MathPreview = lazy(() => import('./MathPreview'))

function editAtom(props: NodeViewProps) {
  const position = props.getPos()
  if (position === undefined) return
  props.editor.view.dom.dispatchEvent(new CustomEvent('folio-edit-atom', { bubbles: true, detail: { name: props.node.type.name, position } }))
}

function DiagramNode(props: NodeViewProps) {
  return <NodeViewWrapper className="content-card" contentEditable={false} data-drag-handle>
    <div className="content-card-head"><GitFork size={15} /> Mermaid diagram <button type="button" className="icon-button" title="Edit diagram" aria-label="Edit diagram" onClick={() => editAtom(props)}><Pencil size={14} /></button></div>
    <div className="content-card-preview"><DiagramPreview value={props.node.attrs.value} /></div>
  </NodeViewWrapper>
}

function EquationNode(props: NodeViewProps) {
  const block = props.node.type.name === 'blockMath'
  const value = String(props.node.attrs.value)
  const fallback = <code aria-label={'Equation ' + value}>{value}</code>
  return <NodeViewWrapper as={block ? 'div' : 'span'} className={block ? 'equation-block' : 'equation-inline'} contentEditable={false}>
    <button type="button" title="Edit equation" onClick={() => editAtom(props)}>
      <LazyBoundary fallback={fallback}><Suspense fallback={fallback}><MathPreview value={value} block={block} /></Suspense></LazyBoundary>
    </button>
  </NodeViewWrapper>
}

function RawNode({ node, editor }: NodeViewProps) {
  return <NodeViewWrapper className="content-card opaque-card" contentEditable={false} data-drag-handle>
    <div className="content-card-head"><FileCode2 size={15} /> Preserved Markdown <button type="button" className="icon-button" title="Edit in Markdown source" aria-label="Edit in Markdown source" onClick={() => editor.view.dom.dispatchEvent(new CustomEvent('folio-open-source', { bubbles: true }))}><Code2 size={16} /></button></div>
    <pre>{node.attrs.value}</pre>
  </NodeViewWrapper>
}

function WikiNode(props: NodeViewProps) {
  return <NodeViewWrapper as="span" className="equation-inline wiki-view" contentEditable={false}>
    <button type="button" title={'Wiki link to ' + props.node.attrs.value} onClick={() => editAtom(props)}>{props.node.attrs.label || props.node.attrs.value}</button>
  </NodeViewWrapper>
}

function TocNode({ editor }: NodeViewProps) {
  const [headings, setHeadings] = useState(() => documentInfo(editor.state.doc).outline)
  useEffect(() => {
    const update = () => setHeadings(documentInfo(editor.state.doc).outline)
    editor.on('update', update)
    return () => { editor.off('update', update) }
  }, [editor])
  return <NodeViewWrapper className="content-card" contentEditable={false} data-drag-handle>
    <div className="content-card-head"><ListTree size={15} /> Table of contents</div>
    <nav aria-label="Table of contents" className="toc-links">
      {headings.length === 0 && <span className="muted">Headings will appear here as you write.</span>}
      {headings.map(heading => <button type="button" key={heading.anchor} style={{ paddingInlineStart: (heading.level - 1) * 12 }} onClick={() => editor.chain().focus().setTextSelection(heading.position + 1).scrollIntoView().run()}>{heading.title}</button>)}
    </nav>
  </NodeViewWrapper>
}

export const nodeViewExtensions = [
  MermaidBlock.extend({ addNodeView: () => ReactNodeViewRenderer(DiagramNode) }),
  InlineMath.extend({ addNodeView: () => ReactNodeViewRenderer(EquationNode) }),
  BlockMath.extend({ addNodeView: () => ReactNodeViewRenderer(EquationNode) }),
  RawBlock.extend({ addNodeView: () => ReactNodeViewRenderer(RawNode) }),
  WikiLink.extend({ addNodeView: () => ReactNodeViewRenderer(WikiNode) }),
  Toc.extend({ addNodeView: () => ReactNodeViewRenderer(TocNode) }),
]

export function workspaceImageExtension(resources: NonNullable<FolioHost['resources']>) {
  function WorkspaceImage({ node }: NodeViewProps) {
    const { src, alt, width, title, caption, align } = node.attrs
    const embedded = typeof src === 'string' && /^data:image\//i.test(src) && safeUrl(src, true) ? src : undefined
    const [resolved, setResolved] = useState<{ reference: string; image: string }>()
    useEffect(() => {
      if (embedded || !src || typeof src !== 'string') return
      const controller = new AbortController()
      void resources.image(src, controller.signal).then(image => {
        if (image && !controller.signal.aborted) setResolved({ reference: src, image })
      })
      return () => controller.abort()
    }, [embedded, src])
    return <NodeViewWrapper as="span" className="document-image" data-folio-image="" data-folio-align={align || undefined} contentEditable={false}>
      <img src={embedded ?? (resolved?.reference === src ? resolved?.image : undefined)} alt={alt ?? ''} title={title ?? undefined} width={/^\d+$/.test(width ?? '') ? width : undefined} />
      {caption && <span className="image-caption">{caption}</span>}
    </NodeViewWrapper>
  }
  return DocumentImage.extend({ addNodeView: () => ReactNodeViewRenderer(WorkspaceImage) })
}
