import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration as VisualDecoration, DecorationSet } from '@tiptap/pm/view'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration as SourceDecoration, EditorView } from '@codemirror/view'
import type { MatchRange } from '../core/search'

interface Highlight extends MatchRange { current: boolean }
const visualKey = new PluginKey<DecorationSet>('folioFind')
const sourceEffect = StateEffect.define<Highlight[]>()
const findClass = (current: boolean) => current ? 'folio-find-hit folio-find-current' : 'folio-find-hit'

export const VisualSearchDecorations = Extension.create({
  name: 'folioFind',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: visualKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, previous) {
          const ranges: Highlight[] | undefined = transaction.getMeta(visualKey)
          if (!ranges) return transaction.docChanged ? DecorationSet.empty : previous
          return DecorationSet.create(transaction.doc, ranges.map(range => VisualDecoration.inline(range.from, range.to, { class: findClass(range.current) })))
        },
      },
      props: { decorations: state => visualKey.getState(state) },
    })]
  },
})

export const sourceSearchDecorations = StateField.define<ReturnType<typeof SourceDecoration.set>>({
  create: () => SourceDecoration.none,
  update(previous, transaction) {
    const effect = transaction.effects.find(effect => effect.is(sourceEffect))
    if (!effect) return transaction.docChanged ? SourceDecoration.none : previous
    const ranges = effect.value as Highlight[]
    return SourceDecoration.set(ranges.map(range => SourceDecoration.mark({ class: findClass(range.current) }).range(range.from, range.to)), true)
  },
  provide: field => EditorView.decorations.from(field),
})

export function highlightVisualSearch(editor: Editor, ranges: Highlight[]) {
  if (!ranges.length && !visualKey.getState(editor.state)?.find().length) return
  editor.view.dispatch(editor.state.tr.setMeta(visualKey, ranges).setMeta('addToHistory', false))
}

export function highlightSourceSearch(editor: EditorView, ranges: Highlight[], scroll?: number) {
  if (!ranges.length && scroll === undefined && !editor.state.field(sourceSearchDecorations).size) return
  editor.dispatch({ effects: [sourceEffect.of(ranges), ...(scroll === undefined ? [] : [EditorView.scrollIntoView(scroll, { y: 'center' })])] })
}
