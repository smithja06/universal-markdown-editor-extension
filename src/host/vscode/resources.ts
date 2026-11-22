import type { LiveDocumentTransport } from './liveDocument'
import type { FolioHost } from '../contracts'
import { concurrentWorkspaceImages } from './protocol'

export function createWorkspaceResources(transport: LiveDocumentTransport): NonNullable<FolioHost['resources']> & { dispose(): void } {
  let nextId = 1
  let disposed = false
  const pending = new Map<number, (ok: boolean, image?: string) => void>()
  const requested = new Map<string, Promise<string | undefined>>()
  const waiting: { reference: string; resolve(image?: string): void }[] = []
  let activeImages = 0
  const unlisten = transport.listen(message => {
    if (message.type === 'resourceResult') pending.get(message.id)?.(message.ok, message.image)
  })

  function request(operation: 'image' | 'open', reference: string) {
    return new Promise<string | undefined>((resolve, reject) => {
      if (disposed) { resolve(undefined); return }
      const id = nextId++
      const timeout = setTimeout(() => {
        if (operation === 'open') {
          try { transport.post({ type: 'cancelResource', id }) } catch { /* The host also checks its deadline. */ }
        }
        finish(false)
      }, 10_000)
      function finish(ok: boolean, image?: string) {
        clearTimeout(timeout)
        pending.delete(id)
        if (ok || operation === 'image') resolve(image)
        else reject(new Error('VS Code could not open this workspace Markdown link.'))
      }
      pending.set(id, finish)
      try { transport.post({ type: 'resource', id, operation, reference }) }
      catch { finish(false) }
    })
  }

  function startImages() {
    while (!disposed && waiting.length && activeImages < concurrentWorkspaceImages) {
      const { reference, resolve } = waiting.shift()!
      activeImages++
      void request('image', reference).then(image => {
        requested.delete(reference)
        activeImages--
        resolve(image)
        startImages()
      })
    }
  }

  return {
    image(reference, signal) {
      if (signal.aborted || disposed) return Promise.resolve(undefined)
      const existing = requested.get(reference)
      if (existing) return existing
      const result = new Promise<string | undefined>(resolve => {
        waiting.push({ reference, resolve })
      })
      requested.set(reference, result)
      startImages()
      return result
    },
    async openMarkdown(reference) { await request('open', reference) },
    dispose() {
      disposed = true
      unlisten()
      for (const item of waiting.splice(0)) item.resolve()
      requested.clear()
      for (const finish of pending.values()) finish(false)
    },
  }
}
