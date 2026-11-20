import { getSchema } from '@tiptap/core'
import { history, undo, undoDepth } from '@tiptap/pm/history'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { openMarkdown, rebaseMarkdown } from '../document/markdown'
import { createExtensions } from './schema'
import { validateSource } from './sourceDiagnostics'
import { visualProjection } from './visualProjection'
import { dividerWidth, minimumPaneWidth, splitLimits } from './useSplitLayout'
import { splitAnchors } from './splitScroll'

const schema = getSchema(createExtensions())

describe('split document projections', () => {
  it('maps the visual selection and undo through a source edit in the same paragraph', () => {
    const original = openMarkdown('Original ending.\n', schema)
    let visual = EditorState.create({ doc: original.document, plugins: [history()] })
    visual = visual.apply(visual.tr.insertText('Visual ', 1))
    visual = visual.apply(visual.tr.setSelection(TextSelection.create(visual.doc, 1, 7)))
    const next = rebaseMarkdown(openMarkdown('Visual Original source ending.\n', schema), visual.doc)
    const projected = visualProjection(visual, next.document, false)
    expect(projected.steps).toHaveLength(1)
    expect(projected.mapping.map(7)).toBe(7)
    visual = visual.apply(projected)
    expect(visual.doc.textContent).toBe('Visual Original source ending.')
    expect(visual.selection.from).toBe(1)
    expect(visual.selection.to).toBe(7)
    expect(undoDepth(visual)).toBe(1)
    expect(undo(visual, change => { visual = visual.apply(change) })).toBe(true)
    expect(visual.doc.textContent).toBe('Original source ending.')
  })

  it('pairs content blocks across front matter, preserved directives and blank visual paragraphs', () => {
    const source = '---\nname: Test\n---\n\n# Start\n\n:::widget\nOpaque.\n:::\n\n## Later\n'
    const session = openMarkdown(source, schema)
    const [heading, opaque, later] = session.document.children
    const empty = schema.nodes.paragraph.create()
    const visual = schema.topNodeType.create(null, [heading, empty, opaque, later])
    expect(splitAnchors(visual, session)).toEqual([
      { visual: 0, source: source.indexOf('# Start') },
      { visual: heading.nodeSize + empty.nodeSize, source: source.indexOf(':::widget') },
      { visual: heading.nodeSize + empty.nodeSize + opaque.nodeSize, source: source.indexOf('## Later') },
    ])
  })
})

describe('preview readiness', () => {
  it.each([
    ['~~~~js\n~~~\n', 'code fence'],
    ['$$\nx^2\n', 'block equation'],
    [':::widget\ncontent\n', 'directive'],
    ['---\ntitle: Unfinished\n', 'YAML front matter'],
  ])('keeps incomplete Markdown available for editing', (source, issue) => {
    expect(validateSource(source)[0]?.message).toContain(issue)
  })

  it('ignores delimiter-like text in closed code fences and ordinary paragraphs', () => {
    const source = '---\ntitle: Safe\n---\n\n~~~~md\n~~~\n$$\n:::widget\n~~~~\n\nA stray $ or [ is regular text.\n'
    expect(validateSource(source)).toEqual([])
  })

  it('treats fence markers inside an opaque HTML block as content', () => {
    expect(validateSource('<pre>\n~~~\n</pre>\n\nNew valid Markdown.\n')).toEqual([])
  })
})

it('clamps side-by-side panes to the available width and stacks below their minimum', () => {
  const threshold = minimumPaneWidth * 2 + dividerWidth
  expect(splitLimits(threshold - 1).stacked).toBe(true)
  expect(splitLimits(threshold)).toEqual({ min: 0.5, max: 0.5, stacked: false })
  expect(splitLimits(1000).min * (1000 - dividerWidth)).toBeCloseTo(minimumPaneWidth)
})
