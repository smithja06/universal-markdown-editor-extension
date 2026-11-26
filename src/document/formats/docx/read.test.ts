import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readDocx } from './read'

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships'
const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'

function types(type = wordType) {
  return `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="xml" ContentType="application/xml"/>
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Override PartName="/word/document.xml" ContentType="${type}"/>
  </Types>`
}

function relationships(content: string) {
  return `<Relationships xmlns="${packageRelationships}">${content}</Relationships>`
}

function rel(id: string, kind: string, target: string, external = false) {
  return `<Relationship Id="${id}" Type="${relationship}/${kind}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`
}

function document(body: string) {
  return `<w:document xmlns:w="${word}" xmlns:r="${relationship}"><w:body>${body}</w:body></w:document>`
}

function paragraph(content: string) {
  return `<w:p><w:r><w:t>${content}</w:t></w:r></w:p>`
}

function fixture(body: string, files: Record<string, string> = {}, level: 0 | 6 = 0) {
  return zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml': types(),
    '_rels/.rels': relationships(rel('rId1', 'officeDocument', 'word/document.xml')),
    'word/document.xml': document(body),
    ...files,
  }).map(([name, xml]) => [name, strToU8(xml)])), { level })
}

describe('DOCX import', () => {
  it('preserves heading level, Unicode and whitespace, marks, explicit breaks and empty paragraphs', () => {
    const bytes = fixture(`
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Résumé 日本語</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/><w:i/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">  Sample &amp; 🐕 </w:t></w:r><w:r><w:br/><w:t>Second line</w:t></w:r></w:p>
      <w:p/>`)
    expect(readDocx(bytes)).toEqual({
      document: { type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Résumé 日本語' }] },
        { type: 'paragraph', content: [
          { type: 'text', text: '  Sample & 🐕 ', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] },
          { type: 'hardBreak' },
          { type: 'text', text: 'Second line' },
        ] },
        { type: 'paragraph' },
      ] },
      issues: [{
        code: 'body-content',
        feature: 'Document body',
        location: 'Document body',
        effect: 'preserved',
        message: 'Preserved 2 paragraphs and 1 heading.',
      }],
    })
  })

  it('preserves safe links as inert destinations and reports unsafe links with their location', () => {
    const bytes = fixture(`<w:p>
      <w:hyperlink r:id="safe"><w:r><w:t>Read more</w:t></w:r></w:hyperlink>
      <w:hyperlink r:id="blocked"><w:r><w:t>Local file</w:t></w:r></w:hyperlink>
    </w:p>`, {
      'word/_rels/document.xml.rels': relationships(
        rel('safe', 'hyperlink', 'https://example.com/reference', true) + rel('blocked', 'hyperlink', 'file:///example.txt', true),
      ),
    })
    expect(readDocx(bytes)).toEqual({
      document: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Read more', marks: [{ type: 'link', attrs: { href: 'https://example.com/reference' } }] },
        { type: 'text', text: 'Local file' },
      ] }] },
      issues: [
        expect.objectContaining({ feature: 'Hyperlinks', effect: 'omitted', location: expect.any(String) }),
        expect.objectContaining({ feature: 'Document body', effect: 'preserved' }),
      ],
    })
  })

  it('resolves ordered and unordered numbering and preserves their order among paragraphs', () => {
    const item = (id: number, text: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
    const bytes = fixture(item(7, 'First') + item(7, 'Second') + paragraph('Between') + item(8, 'Bullet'), {
      'word/_rels/document.xml.rels': relationships(rel('rId1', 'numbering', 'numbering.xml')),
      'word/numbering.xml': `<w:numbering xmlns:w="${word}">
        <w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:start w:val="4"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
        <w:abstractNum w:abstractNumId="12"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
        <w:num w:numId="7"><w:abstractNumId w:val="10"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="6"/></w:lvlOverride></w:num>
        <w:num w:numId="8"><w:abstractNumId w:val="12"/></w:num>
      </w:numbering>`,
    }, 6)
    expect(readDocx(bytes).document.content).toEqual([
      { type: 'orderedList', attrs: { start: 6 }, content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] },
      ] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Between' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet' }] }] }] },
    ])
  })

  it('preserves Word’s external hyperlinks with a separate Unicode fragment', () => {
    const result = readDocx(fixture('<w:p><w:hyperlink r:id="rId1" w:anchor="résumé"><w:r><w:t>Reference</w:t></w:r></w:hyperlink></w:p>', {
      'word/_rels/document.xml.rels': relationships(rel('rId1', 'hyperlink', 'https://example.com/café?a=1&amp;b=2', true)),
    }))
    expect(result.document.content?.[0]?.content).toEqual([
      { type: 'text', text: 'Reference', marks: [{ type: 'link', attrs: { href: 'https://example.com/café?a=1&b=2#résumé' } }] },
    ])
    expect(result.issues).toEqual([expect.objectContaining({ effect: 'preserved' })])
  })

  it('preserves the link label and reports conflicting external fragments', () => {
    const result = readDocx(fixture('<w:p><w:hyperlink r:id="rId1" w:anchor="fragment"><w:r><w:t>Reference</w:t></w:r></w:hyperlink></w:p>', {
      'word/_rels/document.xml.rels': relationships(rel('rId1', 'hyperlink', 'https://example.com/#other', true)),
    }))
    expect(result.document.content?.[0]?.content).toEqual([{ type: 'text', text: 'Reference' }])
    expect(result.issues[0]).toMatchObject({ code: 'hyperlink-fragment', feature: 'Hyperlinks', effect: 'omitted' })
  })

  it('preserves rectangular tables and first-row headers', () => {
    const row = (a: string, b: string, header = false) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}<w:tc>${paragraph(a)}</w:tc><w:tc>${paragraph(b)}</w:tc></w:tr>`
    expect(readDocx(fixture(`<w:tbl>${row('A', 'B', true)}${row('C', 'D')}</w:tbl>`)).document.content).toEqual([
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'D' }] }] },
        ] },
      ] },
    ])
  })

  it('integrates a root relationship targeting a differently named Word part', () => {
    const bytes = fixture('', {
      '[Content_Types].xml': types().replace('/word/document.xml', '/writer/main.xml'),
      '_rels/.rels': relationships(rel('rId1', 'officeDocument', 'writer/main.xml')),
      'writer/main.xml': document(paragraph('Actual main part')),
    })
    expect(readDocx(bytes).document.content?.[0]?.content?.[0]?.text).toBe('Actual main part')
  })

  it('accepts ordinary directory entries alongside typed OPC parts', () => {
    expect(readDocx(fixture(paragraph('Body'), { 'word/media/': '' })).document.content?.[0]?.content?.[0]?.text).toBe('Body')
  })

  it('supports Strict Word namespaces and leading slash targets', () => {
    const strict = 'http://purl.oclc.org/ooxml/'
    const bytes = fixture('', {
      '_rels/.rels': relationships(rel('rId1', 'officeDocument', '/word/document.xml')
        .replace(relationship, strict + 'officeDocument/relationships')),
      'word/document.xml': document(paragraph('Strict Word')).replace(word, strict + 'wordprocessingml/main'),
    })
    expect(readDocx(bytes).document.content?.[0]?.content?.[0]?.text).toBe('Strict Word')
  })

  it('rejects a main relationship with an unrelated type namespace', () => {
    const bytes = fixture('', {
      '_rels/.rels': relationships(rel('rId1', 'officeDocument', 'word/document.xml').replace(relationship, packageRelationships)),
    })
    expect(() => readDocx(bytes)).toThrow(/Word DOCX main/i)
  })

  it('recognizes OOXML core properties as omitted document metadata', () => {
    const bytes = fixture(paragraph('Body'), {
      '_rels/.rels': relationships(rel('rId1', 'officeDocument', 'word/document.xml')
        + rel('rId2', 'core-properties', 'docProps/core.xml').replace(relationship, packageRelationships + '/metadata')),
      'docProps/core.xml': '<properties/>',
    })
    expect(readDocx(bytes).issues).toEqual([
      expect.objectContaining({ feature: 'Document properties', effect: 'omitted' }),
      expect.objectContaining({ feature: 'Document body', effect: 'preserved' }),
    ])
  })

  it.each([
    ['XLSX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', /Word|DOCX/i],
    ['macro-enabled Word', 'application/vnd.ms-word.document.macroEnabled.main+xml', /macro/i],
  ])('rejects a %s package', (_label, type, reason) => {
    expect(() => readDocx(fixture('', { '[Content_Types].xml': types(type) }))).toThrow(reason)
  })

  it('rejects a Word file with active document protection', () => {
    expect(() => readDocx(fixture(paragraph('Protected'), {
      'word/_rels/document.xml.rels': relationships(rel('rId1', 'settings', 'settings.xml')),
      'word/settings.xml': `<w:settings xmlns:w="${word}"><w:documentProtection w:enforcement="1" w:edit="readOnly"/></w:settings>`,
    }))).toThrow(/protected/i)
  })

  it('rejects a truncated ZIP', () => {
    expect(() => readDocx(fixture(paragraph('Body')).slice(0, -5))).toThrow(/ZIP/i)
  })

  it('rejects damaged bytes in the original archive', () => {
    const bytes = fixture(paragraph('Body'))
    bytes[60] ^= 1
    expect(() => readDocx(bytes)).toThrow(/ZIP/i)
  })

  it('rejects package paths with parent segments', () => {
    expect(() => readDocx(fixture('', { 'word/../other.xml': 'contents' }))).toThrow(/path/i)
  })

  it('rejects a relationship that leaves the package', () => {
    expect(() => readDocx(fixture('', {
      'word/_rels/document.xml.rels': relationships(rel('rId1', 'styles', '../../wrong.xml')),
    }))).toThrow(/path|outside/i)
  })

  it('rejects an external main document relationship', () => {
    expect(() => readDocx(fixture('', {
      '_rels/.rels': relationships(rel('rId1', 'officeDocument', 'https://example.com/document.xml', true)),
    }))).toThrow(/main document|external/i)
  })

  it('reports known unsupported relationships without fetching or interpreting their targets', () => {
    const result = readDocx(fixture(paragraph('Body'), {
      'word/_rels/document.xml.rels': relationships(rel('rId1', 'image', 'https://example.com/image.png', true)),
    }))
    expect(result.issues).toEqual([
      expect.objectContaining({ feature: 'Images and drawings', effect: 'omitted' }),
      expect.objectContaining({ feature: 'Document body', effect: 'preserved' }),
    ])
  })

  it('rejects drawings whose text boxes contain visible document text', () => {
    const body = `<w:p><w:r><w:pict><w:txbxContent>${paragraph('Text in shape')}</w:txbxContent></w:pict></w:r></w:p>`
    expect(() => readDocx(fixture(body))).toThrow(/text box/i)
  })

  it('rejects document type declarations', () => {
    expect(() => readDocx(fixture('', { 'word/document.xml': '<!DOCTYPE document>' + document(paragraph('Body')) }))).toThrow(/DTD/i)
  })

  it('rejects XML that exceeds the element depth budget', () => {
    expect(() => readDocx(fixture('<w:p>'.repeat(70) + '</w:p>'.repeat(70)))).toThrow(/depth/i)
  })

  it('rejects an archive beyond the compression ratio budget', () => {
    expect(() => readDocx(fixture(paragraph('a'.repeat(256 * 1024)), {}, 6))).toThrow(/compression/i)
  })

  it('rejects source changes when their content cannot be determined confidently', () => {
    expect(() => readDocx(fixture('<w:p><w:ins><w:r><w:t>Inserted text</w:t></w:r></w:ins></w:p>'))).toThrow(/tracked changes/i)
  })

  it('reports run formatting outside the supported subset', () => {
    const result = readDocx(fixture('<w:p><w:r><w:rPr><w:color w:val="00FF00"/></w:rPr><w:t>Body</w:t></w:r></w:p>'))
    expect(result.issues).toEqual([
      expect.objectContaining({ feature: 'Text formatting', effect: 'approximated', location: expect.any(String) }),
      expect.objectContaining({ feature: 'Document body', effect: 'preserved' }),
    ])
  })

  it('preserves paired complex-script bold and italic and tabs without approximation', () => {
    const result = readDocx(fixture('<w:p><w:r><w:rPr><w:b/><w:bCs/><w:i/><w:iCs/></w:rPr><w:t>مرحبا</w:t><w:tab/><w:t>World</w:t></w:r></w:p>'))
    expect(result.document.content?.[0]?.content).toEqual([
      { type: 'text', text: 'مرحبا\tWorld', marks: [{ type: 'bold' }, { type: 'italic' }] },
    ])
    expect(result.issues).toEqual([expect.objectContaining({ feature: 'Document body', effect: 'preserved' })])
  })

  it('combines adjacent text and tab units from a single Word run before applying the editor node limit', () => {
    const result = readDocx(fixture(`<w:p><w:r><w:t>Start</w:t>${'<w:tab/>'.repeat(100_001)}<w:t>End</w:t></w:r></w:p>`))
    expect(result.document.content?.[0]?.content).toEqual([{ type: 'text', text: `Start${'\t'.repeat(100_001)}End` }])
  })

  it('keeps grid column widths and reports geometry it cannot edit', () => {
    const kept = readDocx(fixture(`<w:tbl><w:tblGrid><w:gridCol w:w="4200"/></w:tblGrid><w:tr><w:tc>${paragraph('Cell')}</w:tc></w:tr></w:tbl>`))
    expect(kept.document.content?.[0].content?.[0].content?.[0].attrs).toEqual({ colwidth: [280] })
    expect(kept.issues.map(issue => issue.feature)).not.toContain('Table formatting')
    const result = readDocx(fixture(`<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc>${paragraph('Cell')}</w:tc></w:tr></w:tbl>`))
    expect(result.issues).toEqual([
      expect.objectContaining({ feature: 'Table formatting', effect: 'approximated' }),
      expect.objectContaining({ feature: 'Document body', effect: 'preserved' }),
    ])
    expect(result.document.content?.[0].content?.[0].content?.[0].attrs).toBeUndefined()
  })

  it('rejects merged tables instead of dropping cell content', () => {
    expect(() => readDocx(fixture(`<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${paragraph('Merged')}</w:tc></w:tr></w:tbl>`))).toThrow(/merged|complex/i)
  })
})
