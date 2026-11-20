import { useEffect, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorView } from '@codemirror/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { isEmptyParagraph, type MarkdownSession } from '../document/markdown'

export interface BlockAnchor { visual: number; source: number }

export function splitAnchors(doc: ProseMirrorNode, session: MarkdownSession): BlockAnchor[] {
  const source = session.blocks.filter(block => !isEmptyParagraph(block.node))
  const anchors: BlockAnchor[] = []
  doc.forEach((node, offset) => {
    if (isEmptyParagraph(node)) return
    const block = source[anchors.length]
    if (block) anchors.push({ visual: offset, source: block.start })
  })
  return anchors
}

function blockTop(editor: Editor, scroller: HTMLElement, position: number) {
  const element = editor.view.nodeDOM(position)
  return element instanceof Element ? element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop : 0
}

function lineTop(view: EditorView, position: number) {
  return view.lineBlockAt(position).top + view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop
}

function lastBefore(length: number, test: (index: number) => boolean) {
  let low = 0
  let high = length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (test(middle)) low = middle + 1
    else high = middle
  }
  return Math.max(0, low - 1)
}

export function scrollToSplitHeading(editor: Editor, visual: HTMLElement, view: EditorView, position: BlockAnchor) {
  visual.scrollTop = Math.max(0, blockTop(editor, visual, position.visual) - 8)
  view.dispatch({ effects: EditorView.scrollIntoView(position.source, { y: 'start', yMargin: 8 }) })
}

export function useSplitScroll(enabled: boolean, editor: Editor | null, visualRef: RefObject<HTMLDivElement | null>, sourceRef: RefObject<EditorView | null>, anchorsForCurrentDocument: () => BlockAnchor[], documentId: string) {
  useEffect(() => {
    const visual = visualRef.current
    const view = sourceRef.current
    if (!enabled || !editor || !visual || !view) return
    const source = view.scrollDOM
    const expected = new Map<HTMLElement, number>()
    let frame = 0
    let sourceAlignment: number | undefined
    const allowSourceScroll = () => {
      window.clearTimeout(sourceAlignment)
      sourceAlignment = undefined
    }
    const align = (origin: HTMLElement) => {
      const ignored = expected.get(origin)
      expected.delete(origin)
      if (ignored !== undefined && Math.abs(ignored - origin.scrollTop) < 2) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const anchors = anchorsForCurrentDocument()
        if (!anchors.length) return
        const fromVisual = origin === visual
        const target = fromVisual ? source : visual
        const originMax = origin.scrollHeight - origin.clientHeight
        const targetMax = target.scrollHeight - target.clientHeight
        if (originMax <= 0 || targetMax <= 0) return
        const top = origin.scrollTop
        const visualTop = (index: number) => blockTop(editor, visual, anchors[index].visual)
        const sourceTop = (index: number) => lineTop(view, anchors[index].source)
        const from = fromVisual ? visualTop : sourceTop
        const to = fromVisual ? sourceTop : visualTop
        const at = lastBefore(anchors.length, index => from(index) <= top + 10)
        const next = at + 1
        const start = Math.min(originMax, from(at))
        const end = Math.min(originMax, next < anchors.length ? from(next) : originMax)
        const proportion = Math.min(1, Math.max(0, (top + 8 - start) / Math.max(1, end - start)))
        const mappedStart = Math.min(targetMax, to(at))
        const mappedEnd = Math.min(targetMax, next < anchors.length ? to(next) : targetMax)
        const mapped = top < 2 ? 0 : top >= originMax - 2 ? targetMax : Math.max(0, mappedStart + (mappedEnd - mappedStart) * proportion - 8)
        if (Math.abs(mapped - target.scrollTop) < 2) return
        if (fromVisual && top >= 2 && top < originMax - 2) {
          // CodeMirror resolves scroll effects after measuring wrapped and virtualized lines.
          const anchor = anchors[at].source
          const offset = (mappedEnd - mappedStart) * proportion
          const height = view.lineBlockAt(anchor).top + offset
          const line = offset < 1 ? view.lineBlockAt(anchor) : view.lineBlockAtHeight(height)
          allowSourceScroll()
          sourceAlignment = window.setTimeout(allowSourceScroll, 100)
          view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 8 - (height - line.top) }) })
          return
        }
        target.scrollTop = mapped
        expected.set(target, target.scrollTop)
      })
    }
    const onVisual = () => align(visual)
    const onSource = () => { if (sourceAlignment === undefined) align(source) }
    visual.addEventListener('scroll', onVisual, { passive: true })
    source.addEventListener('scroll', onSource, { passive: true })
    const actions = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const
    for (const action of actions) source.addEventListener(action, allowSourceScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      allowSourceScroll()
      visual.removeEventListener('scroll', onVisual)
      source.removeEventListener('scroll', onSource)
      for (const action of actions) source.removeEventListener(action, allowSourceScroll)
    }
  }, [enabled, editor, visualRef, sourceRef, anchorsForCurrentDocument, documentId])
}
