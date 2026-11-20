import type { DragEvent, PointerEvent } from 'react'
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { Selection } from '@tiptap/pm/state'
import { GripVertical } from 'lucide-react'

export const blockDragType = 'application/x-folio-block'
export interface Grip { from: number; left: number; top: number }

function blockStart(editor: Editor, position: number) {
  const point = editor.state.doc.resolve(position)
  return point.depth > 0 ? point.before(1) : position
}

export function hoveredBlock(editor: Editor, event: PointerEvent<HTMLElement>): Grip | null {
  if (!(event.target instanceof Element) || event.target.closest('.block-grip')) return null
  const root = editor.view.dom
  if (!root.contains(event.target) || root === event.target) return null
  let target: Element = event.target
  while (target.parentElement && target.parentElement !== root) target = target.parentElement
  const position = editor.view.posAtDOM(target, 0)
  const from = blockStart(editor, position)
  if (!editor.state.doc.nodeAt(from)) return null
  const bounds = target.getBoundingClientRect()
  return { from, left: Math.max(bounds.left - 26, 4), top: bounds.top + Math.min(7, Math.max(0, (bounds.height - 24) / 2)) }
}

export function dropPosition(editor: Editor, left: number, top: number) {
  const point = editor.view.posAtCoords({ left, top })
  if (!point) return undefined
  const from = blockStart(editor, point.pos)
  const node = editor.state.doc.nodeAt(from)
  const element = editor.view.nodeDOM(from)
  if (!node || !(element instanceof Element)) return from
  const bounds = element.getBoundingClientRect()
  return top > bounds.top + bounds.height / 2 ? from + node.nodeSize : from
}

export function moveBlock(editor: Editor, from: number, to: number) {
  const { state, view } = editor
  const block = state.doc.nodeAt(from)
  if (!block || state.doc.resolve(from).depth !== 0 || state.doc.resolve(to).depth !== 0 || (to >= from && to <= from + block.nodeSize)) return
  const transaction = closeHistory(state.tr).delete(from, from + block.nodeSize)
  const destination = transaction.mapping.map(to)
  transaction.insert(destination, block)
  transaction.setSelection(Selection.near(transaction.doc.resolve(destination + (block.isTextblock ? 1 : 0))))
  view.dispatch(transaction.scrollIntoView())
  view.focus()
}

export function moveSelectedBlock(editor: Editor, direction: -1 | 1) {
  const { doc, selection } = editor.state
  const from = blockStart(editor, selection.from)
  const index = doc.resolve(from).index(0)
  const block = doc.maybeChild(index)
  const neighbor = doc.maybeChild(index + direction)
  if (!block || !neighbor || index + direction < 0) return
  moveBlock(editor, from, direction === -1 ? from - neighbor.nodeSize : from + block.nodeSize + neighbor.nodeSize)
}

export function BlockHandle({ grip, start, end }: { grip: Grip; start(event: DragEvent<HTMLButtonElement>): void; end(): void }) {
  return <button type="button" className="block-grip" title="Drag to move this block" aria-label="Drag to move this block" tabIndex={-1} draggable
    style={{ top: grip.top, left: grip.left }} onDragStart={start} onDragEnd={end}
    onClick={event => event.preventDefault()}><GripVertical size={16} /></button>
}
