// Inline the worker so it runs from a blob: URL under the VS Code webview CSP.
import PdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline'

export function createPdfjsWorker(): Worker {
  return new PdfjsWorker()
}
