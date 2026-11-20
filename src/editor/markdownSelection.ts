import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { isEmptyParagraph, type MarkdownSession } from '../document/markdown'

function bodyBlocks(doc: ProseMirrorNode) {
  const blocks: { node: ProseMirrorNode; offset: number }[] = []
  doc.forEach((node, offset) => { if (!isEmptyParagraph(node)) blocks.push({ node, offset }) })
  return blocks
}

function textRuns(node: ProseMirrorNode, raw: string) {
  const runs: { visual: number; source: number; size: number }[] = []
  let cursor = 0
  node.descendants((child, position) => {
    if (!child.text) return
    const source = raw.indexOf(child.text, cursor)
    if (source < 0) return
    runs.push({ visual: position + 1, source, size: child.text.length })
    cursor = source + child.text.length
  })
  return runs
}

function closestOffset(position: number, ranges: { from: number; to: number; size: number }[], fallback: number) {
  let value = fallback
  let nearest = Infinity
  for (const { from, to, size } of ranges) {
    const local = Math.max(0, Math.min(size, position - from))
    const distance = Math.abs(position - from - local)
    if (distance >= nearest) continue
    if (distance === 0) return to + local
    nearest = distance
    value = to + local
  }
  return value
}

export function visualToSource(doc: ProseMirrorNode, position: number, session: MarkdownSession) {
  const blocks = bodyBlocks(doc)
  const sourceBlocks = session.blocks.filter(block => !isEmptyParagraph(block.node))
  const index = blocks.findIndex((block, index) => (blocks[index + 1]?.offset ?? Infinity) > position)
  const visual = blocks[index]
  const source = sourceBlocks[index]
  if (!visual || !source) return session.frontMatter?.end ?? 0
  const local = position - visual.offset
  const ranges = textRuns(visual.node, source.raw).map(run => ({ from: run.visual, to: run.source, size: run.size }))
  return source.start + closestOffset(local, ranges, 0)
}

export function sourceToVisual(session: MarkdownSession, position: number, doc: ProseMirrorNode) {
  const sourceBlocks = session.blocks.filter(block => !isEmptyParagraph(block.node))
  const index = sourceBlocks.findIndex((block, index) => (sourceBlocks[index + 1]?.start ?? Infinity) > position)
  const source = sourceBlocks[index]
  const visual = bodyBlocks(doc)[index]
  if (!source || !visual) return 0
  const ranges = textRuns(visual.node, source.raw).map(run => ({ from: run.source, to: run.visual, size: run.size }))
  return visual.offset + closestOffset(position - source.start, ranges, 1)
}
