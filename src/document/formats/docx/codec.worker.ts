import { canonicalDocx, docxMaxFileBytes } from './model'
import { readDocx } from './read'
import { writeDocx } from './write'
import type { DocxWorkerReply, DocxWorkerRequest } from './workerClient'

function reply(message: DocxWorkerReply, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}

self.onmessage = ({ data }: MessageEvent<DocxWorkerRequest>) => {
  try {
    if (data.operation === 'read') {
      const { document, issues } = readDocx(data.bytes)
      reply({ operation: 'read', document: canonicalDocx(document), issues })
      return
    }
    const document = canonicalDocx(data.document)
    const bytes = writeDocx(document)
    if (bytes.byteLength > docxMaxFileBytes) throw new Error('The exported DOCX exceeds the 24 MiB package limit.')
    const roundTrip = canonicalDocx(readDocx(bytes).document)
    if (JSON.stringify(roundTrip) !== JSON.stringify(document)) throw new Error('The exported DOCX could not round-trip the supported document structure.')
    reply({ operation: 'write', bytes }, [bytes.buffer])
  } catch (error) {
    reply({ operation: 'error', message: error instanceof Error ? error.message : 'The DOCX package could not be processed.' })
  }
}
