import { Extension } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const textblockSelector = 'p, h1, h2, h3, h4, h5, h6, pre'
/** Containers whose padding or gaps hold no text. A click there goes to the nearest line. */
const blankContainers = new Set(['UL', 'OL', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'TABLE', 'TBODY', 'TR'])

function clamp(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/** The text block closest to a point: vertical distance first, then horizontal. */
function nearestTextblock(view: EditorView, x: number, y: number) {
  let best: { element: HTMLElement; rect: DOMRect; score: number } | undefined
  for (const element of view.dom.querySelectorAll<HTMLElement>(textblockSelector)) {
    if (element.closest('[contenteditable="false"]')) continue
    const rect = element.getBoundingClientRect()
    if (!rect.height) continue
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
    const score = dy * 100_000 + dx
    if (!best || score < best.score) best = { element, rect, score }
  }
  return best
}

/**
 * Places the caret on the nearest line when a click lands beside the text, in the editor's padding or in the space
 * between paragraphs. Without this, the browser resolves such points to the start of the next block.
 */
export function placeCaretNear(view: EditorView, x: number, y: number, extend: boolean) {
  const block = nearestTextblock(view, x, y)
  if (!block) return false
  const { rect } = block
  const found = view.posAtCoords({ left: clamp(x, rect.left + 1, rect.right - 1), top: clamp(y, rect.top + 2, rect.bottom - 2) })
  if (!found) return false
  const { doc, selection } = view.state
  const position = clamp(found.pos, 0, doc.content.size)
  const next = extend ? TextSelection.create(doc, selection.anchor, position) : TextSelection.create(doc, position)
  view.dispatch(view.state.tr.setSelection(next).scrollIntoView())
  view.focus()
  return true
}

export const CaretPlacement = Extension.create({
  name: 'folioCaretPlacement',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      // Backspace at the start of an indented paragraph or heading removes one indentation step, as in Word.
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        const { $from } = selection
        if (!selection.empty || $from.parentOffset !== 0) return false
        const parent = $from.parent
        if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') return false
        const current = Number.parseInt(parent.attrs.indent ?? '0', 10)
        if (!(current > 0)) return false
        const next = Math.max(0, current - 24)
        return editor.commands.command(({ tr }) => {
          tr.setNodeAttribute($from.before(), 'indent', next ? `${next}px` : null)
          return true
        })
      },
    }
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            if (event.button !== 0 || event.detail > 1 || event.ctrlKey || event.metaKey || event.altKey || !view.editable) return false
            const target = event.target as HTMLElement | null
            if (!target || target.closest(textblockSelector) || target.closest('[contenteditable="false"]')) return false
            // Table column resizing starts from a cell border. prosemirror-tables marks the editor while a handle is active.
            if (view.dom.classList.contains('resize-cursor') || target.closest('.column-resize-handle')) return false
            if (target !== view.dom && !blankContainers.has(target.tagName)) return false
            if (!placeCaretNear(view, event.clientX, event.clientY, event.shiftKey)) return false
            event.preventDefault()
            return true
          },
        },
      },
    })]
  },
})
