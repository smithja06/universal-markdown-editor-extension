import { findTextMatches, type SearchOptions } from '../core/search'

self.onmessage = ({ data }: MessageEvent<{ texts: string[]; term: string; options: SearchOptions }>) => {
  try { self.postMessage({ matches: findTextMatches(data.texts, data.term, data.options) }) }
  catch { self.postMessage({ error: 'Enter a valid regular expression.' }) }
}
self.postMessage({ ready: true })
