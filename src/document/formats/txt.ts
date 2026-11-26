import { newTextContent, type LineEnding, type TxtContent } from './content'

export const maxTxtImportBytes = 16 * 1024 * 1024
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export class TxtInputError extends Error {
  constructor(readonly code: 'size-limit' | 'invalid-text', message: string) { super(message) }
}

export function containsBinaryControls(text: string) {
  // eslint-disable-next-line no-control-regex -- Preserve tabs, newlines, vertical tabs and form feeds.
  return /[\x00-\x08\x0e-\x1f\x7f]/.test(text)
}

export function decodeTxt(bytes: Uint8Array): TxtContent {
  if (bytes.length > maxTxtImportBytes) throw new TxtInputError('size-limit', 'TXT imports are limited to 16 MiB.')
  const text = utf8.decode(bytes)
  const bom = text.startsWith('\ufeff')
  const body = bom ? text.slice(1) : text
  if (containsBinaryControls(body)) throw new TxtInputError('invalid-text', 'The file appears to contain binary data.')
  const lineEnding = (body.match(/\r\n|\r|\n/)?.[0] as LineEnding | undefined) ?? '\n'
  const source = body.replace(/\r\n?/g, '\n')
  return { ...newTextContent(), source, bom, lineEnding, mixedLineEndings: source.replace(/\n/g, lineEnding) !== body }
}
