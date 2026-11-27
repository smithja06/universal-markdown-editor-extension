// Writes a synthetic DOCX with every formatting control Folio edits, for checking in Microsoft Word.
// Usage: npm run interop:docx, then scripts/interop/word-check.ps1 on the file. No personal documents are used.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JSONContent } from '@tiptap/core'
import { canonicalDocx } from '../../src/document/formats/docx/model'
import { readDocx } from '../../src/document/formats/docx/read'
import { writeDocx } from '../../src/document/formats/docx/write'

const out = process.env.FOLIO_INTEROP_OUT ?? join('test-results', 'interop', 'docx')
const text = (value: string, ...marks: NonNullable<JSONContent['marks']>): JSONContent => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) })
const style = (attrs: Record<string, string>) => ({ type: 'textStyle', attrs })

const document: JSONContent = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [text('Centered heading')] },
  { type: 'paragraph', attrs: { textAlign: 'right', indent: '48px' }, content: [
    text('Georgia 14 pt blue struck', { type: 'strike' }, style({ fontFamily: 'Georgia', fontSize: '18.67px', color: '#2869a9' })),
  ] },
  { type: 'paragraph', content: [text('Yellow highlight', style({ backgroundColor: '#ffff00' }))] },
  { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [text('Lemon shading', style({ backgroundColor: '#fff0a5' }))] },
  { type: 'paragraph', attrs: { indent: '144px' }, content: [text('Inter 10.5 pt', style({ fontFamily: 'Inter Variable', fontSize: '14px' }))] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('Centered list item', { type: 'bold' })] }] }] },
] }

mkdirSync(out, { recursive: true })
const bytes = writeDocx(document)
const reread = readDocx(bytes)
if (JSON.stringify(canonicalDocx(reread.document)) !== JSON.stringify(canonicalDocx(document))) throw new Error('Folio did not reopen the fixture exactly.')
if (reread.issues.some(issue => issue.effect !== 'preserved')) throw new Error('Folio reported approximations for its own fixture.')
writeFileSync(join(out, 'folio-formatting.docx'), bytes)
console.log('wrote ' + join(out, 'folio-formatting.docx') + ' and verified the Folio reopen')
