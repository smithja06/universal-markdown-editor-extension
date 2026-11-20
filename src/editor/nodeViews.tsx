import { useEffect, useId, useState } from 'react'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Code2, FileCode2, GitFork, ListTree, Pencil } from 'lucide-react'
import katex from 'katex'
import { documentInfo } from '../document/metadata'
import { BlockMath, InlineMath, MermaidBlock, RawBlock, Toc, WikiLink } from './schema'

let mermaidLoader: Promise<typeof import('mermaid')['default']> | undefined
let diagramJobs = Promise.resolve()

function MermaidPreview({ value, id }: { value: string; id: string }) {
  const [result, setResult] = useState<{ svg?: string; error?: string }>({})
  useEffect(() => {
    if (!value.trim()) { setResult({}); return }
    let active = true
    setResult({})
    const timeout = window.setTimeout(() => {
      const render = async () => {
        try {
          mermaidLoader ??= import('mermaid').then(({ default: mermaid }) => {
            mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'neutral', flowchart: { htmlLabels: false }, maxTextSize: 50000 })
            return mermaid
          })
          const mermaid = await mermaidLoader
          if (!active) return
          const { svg } = await mermaid.render(id, value)
          if (active) setResult({ svg })
        } catch (error) {
          if (active) setResult({ error: error instanceof Error ? error.message.split('\n')[0] : 'Invalid Mermaid syntax.' })
        }
      }
      diagramJobs = diagramJobs.then(render, render)
    }, 260)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [value, id])
  if (!value.trim()) return <span className="muted">Enter Mermaid code to preview the diagram.</span>
  if (result.error) return <p className="field-error" role="status">{result.error}</p>
  return result.svg ? <div className="mermaid-result" dangerouslySetInnerHTML={{ __html: result.svg }} /> : <span className="muted">Rendering diagram…</span>
}

export function DiagramPreview({ value }: { value: string }) {
  const id = 'diagram-' + useId().replace(/[^a-z0-9-]/gi, '')
  return <MermaidPreview value={value} id={id} />
}

function MathPreview({ value, block }: { value: string; block: boolean }) {
  const html = katex.renderToString(value, { displayMode: block, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 })
  return <span aria-label={'Equation ' + value} dangerouslySetInnerHTML={{ __html: html }} />
}

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
  return <NodeViewWrapper as={block ? 'div' : 'span'} className={block ? 'equation-block' : 'equation-inline'} contentEditable={false}>
    <button type="button" title="Edit equation" onClick={() => editAtom(props)}><MathPreview value={props.node.attrs.value} block={block} /></button>
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
