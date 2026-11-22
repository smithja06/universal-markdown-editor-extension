import { findTextMatches, type SearchOptions, type TextMatch } from '../core/search'

export function createSearch(createWorker: () => Worker) {
  return function search(texts: string[], term: string, options: SearchOptions, signal: AbortSignal): Promise<TextMatch[]> {
    if (signal.aborted) return Promise.reject(new Error('Search cancelled.'))
    if (!options.regex) return Promise.resolve(findTextMatches(texts, term, options))
    // Compile only. Keep matching and potentially expensive backtracking in the worker.
    try { findTextMatches([], term, options) }
    catch { return Promise.reject(new Error('Enter a valid regular expression.')) }
    return new Promise((resolve, reject) => {
      const worker = createWorker()
      const cleanup = () => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
        worker.terminate()
      }
      const fail = (message: string) => { cleanup(); reject(new Error(message)) }
      const abort = () => fail('Search cancelled.')
      let timeout = setTimeout(() => fail('Regular expression search could not start.'), 10_000)
      signal.addEventListener('abort', abort, { once: true })
      worker.onmessage = ({ data }: MessageEvent<{ ready?: boolean; matches?: TextMatch[]; error?: string }>) => {
        if (data.ready) {
          clearTimeout(timeout)
          timeout = setTimeout(() => fail('The regular expression took too long. Try a simpler pattern.'), 1500)
          worker.postMessage({ texts, term, options })
          return
        }
        if (data.error) { fail(data.error); return }
        cleanup()
        resolve(data.matches ?? [])
      }
      worker.onerror = () => fail('Regular expression search could not start.')
    })
  }
}

export const browserSearch = /* @__PURE__ */ createSearch(() => new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' }))
