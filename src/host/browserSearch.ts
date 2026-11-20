import { findTextMatches, type SearchOptions, type TextMatch } from '../core/search'

export function browserSearch(texts: string[], term: string, options: SearchOptions, signal: AbortSignal): Promise<TextMatch[]> {
  if (signal.aborted) return Promise.reject(new Error('Search cancelled.'))
  if (!options.regex) return Promise.resolve(findTextMatches(texts, term, options))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const fail = (message: string) => { cleanup(); reject(new Error(message)) }
    const abort = () => fail('Search cancelled.')
    const timeout = setTimeout(() => fail('The regular expression took too long. Try a simpler pattern.'), 1500)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<{ matches?: TextMatch[]; error?: string }>) => {
      if (data.error) { fail(data.error); return }
      cleanup()
      resolve(data.matches ?? [])
    }
    worker.onerror = () => fail('Regular expression search could not start.')
    worker.postMessage({ texts, term, options })
  })
}
