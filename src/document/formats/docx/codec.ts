import { canonicalDocx, docxMaxFileBytes } from './model'
import { readDocx } from './read'
import { writeDocx } from './write'
import type { DocxWorkerReply, DocxWorkerRequest } from './codecMessages'

export function processDocx(request: DocxWorkerRequest): DocxWorkerReply {
  try {
    if (request.operation === 'read') {
      const { document, issues } = readDocx(request.bytes)
      return { operation: 'read', document: canonicalDocx(document), issues }
    }
    const document = canonicalDocx(request.document)
    const bytes = writeDocx(document)
    if (bytes.byteLength > docxMaxFileBytes) throw new Error('The exported DOCX exceeds the 24 MiB package limit.')
    const roundTrip = canonicalDocx(readDocx(bytes).document)
    if (JSON.stringify(roundTrip) !== JSON.stringify(document)) throw new Error('The exported DOCX could not round-trip the supported document structure.')
    return { operation: 'write', bytes }
  } catch (error) {
    return { operation: 'error', message: error instanceof Error ? error.message : 'The DOCX package could not be processed.' }
  }
}
