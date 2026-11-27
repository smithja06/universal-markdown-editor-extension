import { Editor } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'
import { createExtensions } from '../editor/schema'
import { markdownProcessor, openMarkdown, writeMarkdown } from './markdown'
import { decodeMarkdown, encodeMarkdown, markdownFilename } from './files'

const sample = '\uFEFF---\r\ntitle: "Test"\r\ncustom: [a, b]\r\n---\r\n\r\nA title\r\n=======\r\n\r\nA  *word* and [reference][id].\r\n\r\n<section data-unknown="yes">keep me</section>\r\n\r\n[id]: /target "Title"\r\n'

function open(source: string) {
  const editor = new Editor({ extensions: createExtensions() })
  const session = openMarkdown(source, editor.schema)
  editor.commands.setContent(session.document)
  editor.view.dispatch(editor.state.tr.setDocAttribute('frontMatter', session.document.attrs.frontMatter))
  return { editor, session }
}

describe('Markdown source preservation', () => {
  it('preserves authored markup around a selected span replaced by an inline image', () => {
    const original = 'A  _word_ stays. Figure: replace and more.\r\n'
    const { editor, session } = open(original)
    const reference = '../media/caf%C3%A9%20%23%25%28final%29%252F.png'
    const from = editor.state.doc.textContent.indexOf('replace') + 1
    expect(from).toBeGreaterThan(0)
    const image = editor.schema.nodes.image.create({ src: reference, alt: 'Picked image' })
    editor.view.dispatch(editor.state.tr.replaceWith(from, from + 'replace'.length, image))
    expect(writeMarkdown(session, editor.state.doc).source).toBe(original.replace('replace', `![Picked image](${reference})`))
    editor.destroy()
  })

  it('preserves list delimiters and chooses the intended repeated text when inserting an image', () => {
    const original = '+ A  _word_ stays. Figure: replace and replace.\n\nKeep   this.\n'
    const { editor, session } = open(original)
    const reference = '../media/asset.png'
    const image = editor.schema.nodes.image.create({ src: reference, alt: 'Picked image' })
    const position = { from: -1 }
    editor.state.doc.descendants((node, offset) => {
      if (node.isText && node.text?.includes('replace')) position.from = offset + node.text.lastIndexOf('replace')
    })
    expect(position.from).toBeGreaterThan(0)
    editor.view.dispatch(editor.state.tr.replaceWith(position.from, position.from + 'replace'.length, image))
    expect(writeMarkdown(session, editor.state.doc).source).toBe(original.replace('and replace.', `and ![Picked image](${reference}).`))
    editor.destroy()
  })

  it('writes ordinary visual edits as native Markdown', () => {
    const { editor, session } = open('')
    const headings = Array.from({ length: 6 }, (_, index) => ({
      type: 'heading', attrs: { level: index + 1 }, content: [{ type: 'text', text: 'Heading ' + (index + 1) }],
    }))
    editor.commands.setContent({
      type: 'doc', content: [
        ...headings,
        { type: 'paragraph', content: [
          { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'removed', marks: [{ type: 'strike' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: '/page' } }] },
          { type: 'text', text: ' ' },
          { type: 'image', attrs: { src: './image.png', alt: 'Photo' } },
        ] },
        { type: 'horizontalRule' },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'End.' }] },
      ],
    })
    expect(writeMarkdown(session, editor.state.doc).source).toBe(
      '# Heading 1\n\n## Heading 2\n\n### Heading 3\n\n#### Heading 4\n\n##### Heading 5\n\n###### Heading 6\n\n**Bold** *italic* ~~removed~~ [link](/page) ![Photo](./image.png)\n\n---\n\nEnd.\n',
    )
    editor.destroy()
  })

  it('keeps advanced inline marks inside native headings, lists, and callouts', () => {
    const { editor, session } = open('# Title\n\n- First\n  1. Nested\n\n> [!TIP]\n> Tip body\n')
    editor.chain().setTextSelection({ from: 1, to: 6 }).toggleUnderline().setColor('#16724f').run()
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Nested') editor.chain().setTextSelection({ from: pos, to: pos + node.nodeSize }).toggleSuperscript().run()
      if (node.isText && node.text === 'Tip body') editor.chain().setTextSelection({ from: pos, to: pos + node.nodeSize }).toggleSubscript().run()
    })
    const source = writeMarkdown(session, editor.state.doc).source
    expect(source).toMatch(/^# .*<u>.*Title/)
    expect(source).toContain('1. <sup>Nested</sup>')
    expect(source).toContain('> <sub>Tip body</sub>')
    expect(source).not.toContain('data-folio-block')
    const reopened = open(source)
    expect(reopened.editor.state.doc.firstChild?.firstChild?.marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['textStyle', 'underline']))
    expect(writeMarkdown(reopened.session, reopened.editor.state.doc).source).toBe(source)
    editor.destroy()
    reopened.editor.destroy()
  })

  it.each(['# Welcome to Folio\n', 'Welcome to Folio\n================\n'])('preserves native heading syntax when choosing left alignment in %j', source => {
    const { editor, session } = open(source)
    editor.commands.setTextAlign('left')
    expect(writeMarkdown(session, editor.state.doc).source).toBe(source)
    editor.commands.setTextAlign('right')
    expect(writeMarkdown(session, editor.state.doc).source).toBe('<h1 style="text-align: right;">Welcome to Folio</h1>\n')
    editor.destroy()
  })

  it('uses native Markdown when editing a heading with a redundant imported left alignment', () => {
    const source = '<h1 style="text-align: left;">Welcome to Folio</h1>\n\n<p style="text-align: center;">Centered</p>\n'
    const { editor, session } = open(source)
    expect(writeMarkdown(session, editor.state.doc).source).toBe(source)
    editor.commands.insertContentAt(1, 'Hello! ')
    expect(writeMarkdown(session, editor.state.doc).source).toBe('# Hello! Welcome to Folio\n\n<p style="text-align: center;">Centered</p>\n')
    editor.destroy()
  })

  it('keeps legacy source exact until an edit and then writes the smallest block HTML', () => {
    const legacy = "<div data-folio-block='1'>\n  <p data-folio-style='title'>Hello</p>\n</div>\n"
    const { editor, session } = open(legacy)
    expect(editor.state.doc.firstChild?.attrs.displayStyle).toBe('title')
    expect(writeMarkdown(session, editor.state.doc).source).toBe(legacy)
    editor.commands.insertContentAt(6, ' world')
    const source = writeMarkdown(session, editor.state.doc).source
    expect(source).toBe('<p data-folio-style="title">Hello world</p>\n')
    const reopened = open(source)
    expect(reopened.editor.state.doc.firstChild?.attrs.displayStyle).toBe('title')
    expect(writeMarkdown(reopened.session, reopened.editor.state.doc).source).toBe(source)
    editor.destroy()
    reopened.editor.destroy()
  })

  it.each(['Plan', '42'])('uses a standard inline image after resizing a legacy width-only image named %s', alt => {
    const legacy = `<div data-folio-block="1"><p>Sketch <span data-folio-image="" class="document-image"><img src="/p.png" alt="${alt}" width="120"></span> for review.</p></div>\n`
    const { editor, session } = open(legacy)
    expect(editor.state.doc.firstChild?.child(1).attrs.width).toBe('120')
    expect(writeMarkdown(session, editor.state.doc).source).toBe(legacy)

    editor.chain().setNodeSelection(8).updateAttributes('image', { width: '160' }).run()
    const { source } = writeMarkdown(session, editor.state.doc)
    expect(source).toBe(`Sketch <img src="/p.png" alt="${alt}" width="160"> for review.\n`)
    editor.destroy()

    const reopened = open(source)
    expect(reopened.editor.state.doc.firstChild?.child(1)).toMatchObject({ type: { name: 'image' }, attrs: { src: '/p.png', alt, width: '160' } })
    expect(writeMarkdown(reopened.session, reopened.editor.state.doc).source).toBe(source)
    reopened.editor.destroy()
  })

  it('keeps inline image HTML opaque when its attributes cannot be round-tripped', () => {
    const images = ['<img src="/p.png" alt="Plan" width="100%">', '<img src="/p.png" alt="Plan" data-custom="keep">',
      '<img src="java&#x09;script:unsupported" alt="Plan">', '<img src="/p.png" width="120">']
    const source = `Sketch ${images.join(' and ')} for review.\n`
    const { editor, session } = open(source)
    const inline = editor.state.doc.firstChild?.children.filter(node => node.type.name === 'rawInline')
    expect(inline?.map(node => node.attrs.value)).toEqual(images)
    editor.commands.insertContentAt(1, 'Updated ')
    expect(writeMarkdown(session, editor.state.doc).source).toBe('Updated ' + source)
    editor.destroy()
  })

  it.each([' width="120"', ''])('preserves an explicit empty HTML image title after adjacent formatting%s', width => {
    const image = `<img src="/p.png" alt="Plan"${width} title="">`
    const { editor, session } = open(`Text ${image} tail.\n`)
    editor.chain().setTextSelection({ from: 1, to: 5 }).toggleBold().run()
    const { source } = writeMarkdown(session, editor.state.doc)
    expect(source).toContain('**Text**')
    expect(source).toContain('title=""')
    const reopened = open(source)
    expect(reopened.editor.state.doc.firstChild?.children.find(node => node.type.name === 'image')?.attrs.title).toBe('')
    reopened.editor.destroy()
    editor.destroy()
  })

  it('keeps Markdown quote and list markers around visual edits to styled paragraphs', () => {
    const legacy = '<div data-folio-block="1"><blockquote><p style="text-align: center;">A quote</p></blockquote></div>\n\n<div data-folio-block="1"><ul><li><p style="margin-left: 2em;">A list item</p></li></ul></div>\n'
    const { editor, session } = open(legacy)
    expect(editor.state.doc.child(0).firstChild?.attrs.textAlign).toBe('center')
    expect(editor.state.doc.child(1).firstChild?.firstChild?.attrs.indent).toBe('2em')
    expect(writeMarkdown(session, editor.state.doc).source).toBe(legacy)

    editor.commands.insertContentAt(2, 'Updated ')
    editor.commands.insertContentAt(editor.state.doc.child(0).nodeSize + 3, 'Updated ')
    const { source } = writeMarkdown(session, editor.state.doc)
    expect(source).toBe('> <p style="text-align: center;">Updated A quote</p>\n\n- <p style="margin-left: 2em;">Updated A list item</p>\n')
    editor.destroy()

    const reopened = open(source)
    expect(reopened.editor.state.doc.child(0).firstChild?.attrs.textAlign).toBe('center')
    expect(reopened.editor.state.doc.child(1).firstChild?.firstChild?.attrs.indent).toBe('2em')
    expect(writeMarkdown(reopened.session, reopened.editor.state.doc).source).toBe(source)
    reopened.editor.destroy()
  })

  it('makes supported imported HTML editable and retains unfamiliar HTML and directives', () => {
    const source = 'See <u>linked</u> and <kbd data-key="ctrl">Ctrl</kbd>.\n\n<p style="text-align: center">Centered</p>\n\n<p data-custom="keep">Unknown paragraph</p>\n\n:::widget{mode="wide"}\nPrivate content.\n:::\n'
    const { editor, session } = open(source)
    expect(editor.state.doc.firstChild?.child(1).marks[0]?.type.name).toBe('underline')
    expect(editor.state.doc.child(1).attrs.textAlign).toBe('center')
    expect(editor.state.doc.child(2).attrs.value).toContain('data-custom="keep"')
    expect(editor.state.doc.child(3).attrs.value).toContain(':::widget')
    editor.commands.insertContentAt(1, 'Also ')
    expect(writeMarkdown(session, editor.state.doc).source).toBe('Also ' + source)
    editor.destroy()
  })

  it('keeps an empty visual document as empty Markdown', () => {
    const { editor, session } = open('')
    editor.commands.insertContent('temporary')
    editor.commands.clearContent()
    expect(writeMarkdown(session, editor.state.doc).source).toBe('')
    editor.destroy()
  })

  it('disambiguates dividers at the start of a document from YAML front matter', () => {
    const { editor, session } = open('')
    editor.commands.setContent({ type: 'doc', content: [
      { type: 'horizontalRule' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Between dividers' }] },
      { type: 'horizontalRule' },
    ] })
    const { source } = writeMarkdown(session, editor.state.doc)
    const reopened = open(source)
    expect(reopened.session.frontMatter).toBeUndefined()
    expect(reopened.editor.state.doc.children.map(node => node.type.name)).toEqual(['horizontalRule', 'paragraph', 'horizontalRule'])
    expect(source).not.toContain('<hr')
    editor.destroy()
    reopened.editor.destroy()
  })

  it('preserves unsupported tags nested inside a supported mark with the same tag name', () => {
    const source = 'See <span style="color: red">a <span data-custom="keep">b</span> c</span>.\n'
    const { editor, session } = open(source)
    const paragraph = editor.state.doc.firstChild!
    expect(paragraph.children.find(node => node.text === ' c')?.marks[0]?.attrs.color).toBe('red')
    editor.commands.insertContentAt(1, 'Also ')
    expect(writeMarkdown(session, editor.state.doc).source).toBe('Also ' + source)
    editor.destroy()
  })

  it('preserves inherited typography in nested HTML spans', () => {
    const { editor, session } = open('Intro <span style="color: red"><span style="font-size: 20px">styled</span></span>.\n')
    const inner = editor.state.doc.firstChild?.children.find(node => node.text === 'styled')
    expect(inner?.marks[0]?.attrs).toMatchObject({ color: 'red', fontSize: '20px' })
    editor.commands.insertContentAt(1, 'New ')
    const source = writeMarkdown(session, editor.state.doc).source
    expect(source).toBe('New Intro <span style="color: red"><span style="font-size: 20px">styled</span></span>.\n')
    editor.destroy()
  })

  it('reopens resize, alignment and captions without wrapping the whole block in legacy markup', () => {
    const { editor, session } = open('![Picture](/p.png)\n')
    editor.chain().setNodeSelection(1).updateAttributes('image', { width: '120', align: 'right', caption: 'A caption' }).run()
    const { source } = writeMarkdown(session, editor.state.doc)
    expect(source).toContain('width="120"')
    expect(source).not.toContain('data-folio-block')
    const reopened = open(source)
    expect(reopened.editor.state.doc.firstChild?.firstChild?.attrs).toMatchObject({ width: '120', align: 'right', caption: 'A caption', src: '/p.png' })
    editor.destroy()
    reopened.editor.destroy()
  })

  it('returns the original bytes after repeated unchanged projections', () => {
    const file = decodeMarkdown(new TextEncoder().encode(sample))
    let projection = file.source
    for (let index = 0; index < 3; index++) {
      const { editor, session } = open(projection)
      projection = writeMarkdown(session, editor.state.doc).source
      editor.destroy()
    }
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(encodeMarkdown({ ...file, source: projection }))).toBe(sample)
  })

  it('keeps unrelated source and inline references when a visual edit changes a paragraph', () => {
    const { editor, session } = open(decodeMarkdown(new TextEncoder().encode(sample)).source)
    const from = editor.state.doc.child(0).nodeSize + 1
    editor.commands.insertContentAt(from, 'New ')
    const markdown = writeMarkdown(session, editor.state.doc).source
    expect(markdown).toContain('A title\n=======')
    expect(markdown).toContain('New A  *word* and [reference][id].')
    expect(markdown).toContain('<section data-unknown="yes">keep me</section>')
    expect(markdown).toContain('[id]: /target "Title"')
    editor.destroy()
  })

  it('separates only the adjacent lists that would merge and leaves other blocks clean', () => {
    const { editor, session } = open('Intro\n')
    const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    editor.commands.setContent({ type: 'doc', content: [
      paragraph('Heading text'),
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph('Done')] }, { type: 'taskItem', attrs: { checked: false }, content: [paragraph('Open')] }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('A note')] }] },
      paragraph('Next section'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Plain item')] }] },
    ] })
    const { source, protectedBoundaries } = writeMarkdown(session, editor.state.doc)
    expect(protectedBoundaries).toBe(true)
    expect(source.match(/<!--folio:boundary-->/g)).toHaveLength(1)
    expect(source).toMatch(/- \[ \] Open\n\n<!--folio:boundary-->\n\n- A note\n\nNext section\n\n- Plain item\n$/)
    expect(source.startsWith('Heading text\n\n- [x] Done\n- [ ] Open\n')).toBe(true)
    const reopened = open(source).editor
    expect(Array.from({ length: reopened.state.doc.childCount }, (_, index) => reopened.state.doc.child(index).type.name))
      .toEqual(['paragraph', 'taskList', 'bulletList', 'paragraph', 'bulletList'])
    editor.destroy()
    reopened.destroy()
  })

  it('writes new lists tight unless an item holds several paragraphs', () => {
    const { editor, session } = open('Intro\n')
    const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const item = (...texts: string[]) => ({ type: 'listItem', content: texts.map(paragraph) })
    editor.commands.setContent({ type: 'doc', content: [
      { type: 'bulletList', content: [item('One'), { type: 'listItem', content: [paragraph('Two'), { type: 'bulletList', content: [item('Nested')] }] }] },
      paragraph('Between'),
      { type: 'orderedList', attrs: { start: 1 }, content: [item('First', 'Second paragraph'), item('Next')] },
    ] })
    const { source } = writeMarkdown(session, editor.state.doc)
    expect(source).toBe('- One\n- Two\n  - Nested\n\nBetween\n\n1. First\n\n   Second paragraph\n\n2. Next\n')
    const reopened = open(source).editor
    expect(reopened.state.doc.child(2).child(0).childCount).toBe(2)
    expect(reopened.state.doc.child(0).child(1).child(1).type.name).toBe('bulletList')
    editor.destroy()
    reopened.destroy()
  })

  it('edits portable blocks and reopens rich formatting and special blocks', () => {
    const { editor, session } = open('A styled line\n\n- [x] Completed\n  - Nested\n\n| A | B |\n| :- | -: |\n| 1 | 2 |\n\n> [!TIP]\n> Try this\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n$$\nx^2\n$$\n\n```js special\nlet x = 1\n```\n')
    editor.chain().setTextSelection({ from: 1, to: 9 }).setColor('#16724f').toggleUnderline().setTextAlign('right').run()
    const markdown = writeMarkdown(session, editor.state.doc).source
    const reopened = open(markdown).editor
    expect(reopened.state.doc.child(0).attrs.textAlign).toBe('right')
    expect(reopened.state.doc.child(0).firstChild?.marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['textStyle', 'underline']))
    expect(Array.from({ length: reopened.state.doc.childCount }, (_, index) => reopened.state.doc.child(index).type.name)).toEqual(['paragraph', 'taskList', 'table', 'callout', 'mermaid', 'blockMath', 'codeBlock'])
    expect(markdown).toContain('```js special')
    editor.destroy()
    reopened.destroy()
  })

  it('preserves references when their definition is removed in visual mode', () => {
    const { editor, session } = open('Text [example][label].\n\n[label]: https://example.com\n')
    const from = editor.state.doc.child(0).nodeSize
    editor.commands.deleteRange({ from, to: editor.state.doc.content.size })
    expect(writeMarkdown(session, editor.state.doc).source).toContain('[example][label]')
    editor.destroy()
  })

  it('normalizes download filenames without changing an existing Markdown extension', () => {
    expect(markdownFilename('  Notes: week 1  ')).toBe('Notes- week 1.md')
    expect(markdownFilename('Notes.markdown')).toBe('Notes.markdown')
  })

  it('keeps a new visual paragraph outside an unclosed opaque block', () => {
    const { editor, session } = open('<pre>\nThis input consumes everything after it.\n')
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'New paragraph.' }] })
    const { source } = writeMarkdown(session, editor.state.doc)
    const reopened = open(source).editor
    expect(reopened.state.doc.childCount).toBe(2)
    expect(reopened.state.doc.child(0).attrs.value).toBe('<pre>\nThis input consumes everything after it.')
    expect(reopened.state.doc.child(1).textContent).toBe('New paragraph.')
    editor.destroy()
    reopened.destroy()
  })

  it('closes an unfinished code fence when a new visual block follows it', () => {
    const { editor, session } = open('```js\nconst draft = true\n')
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'A second block.' }] })
    const { source } = writeMarkdown(session, editor.state.doc)
    const reopened = open(source).editor
    expect(source).toContain('const draft = true\n```')
    expect(reopened.state.doc.child(1).textContent).toBe('A second block.')
    editor.destroy()
    reopened.destroy()
  })

  it('keeps nested bold and code as editable marks', () => {
    const { editor } = open('**Run `npm test` here.**\n')
    expect(editor.state.doc.firstChild?.child(1).marks.map(mark => mark.type.name)).toEqual(expect.arrayContaining(['bold', 'code']))
    editor.destroy()
  })

  it('preserves authored block indentation, gaps, and missing final newline after editing', () => {
    const { editor, session } = open('Start here.\n\n\n  ## Indented heading')
    editor.commands.insertContentAt(1, 'First: ')
    expect(writeMarkdown(session, editor.state.doc).source).toBe('First: Start here.\n\n\n  ## Indented heading')
    editor.destroy()
  })

  it('keeps untouched source slices while reconciling a long document', () => {
    const content = Array.from({ length: 350 }, (_, index) => 'Section ' + index + '\n---------\n\nA  _line_ with a hard break.  \nSecond line.').join('\n\n') + '\n'
    const { editor, session } = open(content)
    const pos = editor.state.doc.firstChild!.nodeSize + 1
    editor.commands.insertContentAt(pos, 'Start: ')
    expect(writeMarkdown(session, editor.state.doc).source).toBe(content.replace('A  _line_', 'Start: A  _line_'))
    editor.destroy()
  })

  it.each([
    { before: '  ## A simple title  ## ', after: '  ## A revised simple title  ## ' },
    { before: ' A simple paragraph.', after: ' A revised simple paragraph.' },
  ])('keeps isolated plain text edits local to their Markdown block', ({ before, after }) => {
    const preserved = '  **Leave this authored spacing and spelling alone**\n\n'.repeat(450)
    const source = before + '\n\n' + preserved
    const { editor, session } = open(source)
    const parse = vi.spyOn(markdownProcessor, 'parse')
    try {
      editor.view.dispatch(editor.state.tr.insertText('revised ', 3))
      const written = writeMarkdown(session, editor.state.doc)
      expect(written.source).toBe(after + '\n\n' + preserved)
      expect(parse.mock.calls.length).toBe(0)

      const reopened = openMarkdown(written.source, editor.schema)
      expect(reopened.document.firstChild?.textContent).toBe(editor.state.doc.firstChild?.textContent)
    } finally {
      parse.mockRestore()
      editor.destroy()
    }
  })

  it('checks the whole document when visual plain text introduces Markdown syntax', () => {
    const { editor, session } = open('A simple paragraph.\n\n**Preserved**\n')
    try {
      editor.view.dispatch(editor.state.tr.insertText('1. ', 1))
      const written = writeMarkdown(session, editor.state.doc)
      const reopened = openMarkdown(written.source, editor.schema)
      expect(reopened.document.firstChild?.type.name).toBe('paragraph')
      expect(reopened.document.firstChild?.textContent).toBe('1. A simple paragraph.')
      expect(written.source.endsWith('\n\n**Preserved**\n')).toBe(true)
    } finally {
      editor.destroy()
    }
  })
})

describe('Markdown table column widths', () => {
  it('writes resized columns as an HTML table that reopens with the same widths', () => {
    const { editor, session } = open('# Widths\n\n| Item | Cost |\n| --- | --- |\n| Tea | 3 |\n')
    const tr = editor.state.tr
    editor.state.doc.descendants((node, position) => {
      if (node.type.spec.tableRole?.includes('cell') && ['Item', 'Tea'].includes(node.textContent)) tr.setNodeMarkup(position, undefined, { ...node.attrs, colwidth: [200] })
    })
    editor.view.dispatch(tr)
    const { source } = writeMarkdown(session, editor.state.doc)
    expect(source).toContain('<th colwidth="200">')
    const reopened = open(source)
    const widths: unknown[] = []
    reopened.editor.state.doc.descendants(node => { if (node.type.spec.tableRole?.includes('cell')) widths.push(node.attrs.colwidth) })
    expect(widths).toEqual([[200], null, [200], null])
    editor.destroy()
    reopened.editor.destroy()
  })

  it('keeps a table with an invalid width attribute as raw HTML', () => {
    const { editor } = open('<table><tbody><tr><td colwidth="wide"><p>x</p></td></tr></tbody></table>\n')
    expect(editor.state.doc.firstChild?.type.name).toBe('rawBlock')
    editor.destroy()
  })
})
