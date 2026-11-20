import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorState } from '@tiptap/pm/state'

export function visualProjection(state: EditorState, next: ProseMirrorNode, recordHistory: boolean) {
  const before = state.doc
  const start = before.content.findDiffStart(next.content)
  const end = before.content.findDiffEnd(next.content)
  let transaction = state.tr
  if (start !== null && end) {
    const overlap = Math.max(0, start - Math.min(end.a, end.b))
    try {
      transaction.replace(start, end.a + overlap, next.slice(start, end.b + overlap))
    } catch {
      transaction = state.tr
    }
    if (!transaction.doc.content.eq(next.content)) {
      // Changes spanning incompatible node types require a block-level replacement.
      transaction = state.tr
      const count = Math.min(before.childCount, next.childCount)
      let prefix = 0
      let from = 0
      while (prefix < count && before.child(prefix).eq(next.child(prefix))) from += next.child(prefix++).nodeSize
      let tail = 0
      for (let suffix = 1; prefix + suffix <= count; suffix++) {
        const node = next.child(next.childCount - suffix)
        if (!node.eq(before.child(before.childCount - suffix))) break
        tail += node.nodeSize
      }
      transaction.replaceWith(from, before.content.size - tail, next.content.cut(from, next.content.size - tail))
    }
  }
  if (before.attrs.frontMatter !== next.attrs.frontMatter) transaction.setDocAttribute('frontMatter', next.attrs.frontMatter)
  transaction.setMeta('preventUpdate', true)
  return recordHistory ? closeHistory(transaction) : transaction.setMeta('addToHistory', false)
}
