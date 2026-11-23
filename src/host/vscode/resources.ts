import type { LiveDocumentTransport } from './liveDocument'
import type { FolioHost } from '../contracts'
import { concurrentWorkspaceImages, type HostMessage } from './protocol'

type PickerReply = Extract<HostMessage, { type: 'imagePickerResult' }>

export function createWorkspaceResources(transport: LiveDocumentTransport): NonNullable<FolioHost['resources']> & { dispose(): void } {
  let nextId = 1
  let disposed = false
  const pending = new Map<number, (ok: boolean, image?: string) => void>()
  const pickerRequests = new Map<number, (reply?: PickerReply) => void>()
  const requested = new Map<string, Promise<string | undefined>>()
  const waiting: { reference: string; resolve(image?: string): void }[] = []
  let activeImages = 0
  const unlisten = transport.listen(message => {
    if (message.type === 'resourceResult') pending.get(message.id)?.(message.ok, message.image)
    if (message.type === 'imagePickerResult') pickerRequests.get(message.id)?.(message)
  })

  function pick(revision: number, signal: AbortSignal, selection?: number) {
    return new Promise<PickerReply | undefined>((resolve, reject) => {
      if (disposed || signal.aborted) { resolve(undefined); return }
      const id = nextId++
      function finish(reply?: PickerReply) {
        pickerRequests.delete(id)
        signal.removeEventListener('abort', cancel)
        if (reply?.error) reject(new Error(reply.error))
        else resolve(reply?.reference ? reply : undefined)
      }
      function cancel() {
        try { transport.post({ type: 'cancelWorkspaceImage', id }) } catch { /* The connection may have closed. */ }
        finish()
      }
      pickerRequests.set(id, finish)
      signal.addEventListener('abort', cancel, { once: true })
      try {
        transport.post(selection === undefined ? { type: 'pickWorkspaceImage', id, revision } :
          { type: 'confirmWorkspaceImage', id, revision, selection })
      } catch { finish({ type: 'imagePickerResult', id, error: 'Folio could not reach the VS Code image picker.' }) }
    })
  }

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
    async pickWorkspaceImage(revision, signal) {
      const result = await pick(revision, signal)
      if (!result?.reference || signal.aborted) return
      if (!result.preview) throw new Error('VS Code could not preview the selected image.')
      const image = new Image()
      const cancel = () => image.removeAttribute('src')
      signal.addEventListener('abort', cancel, { once: true })
      try {
        image.src = result.preview
        await image.decode()
        if (!signal.aborted) return { id: result.id, reference: result.reference }
      } catch (error) {
        if (!signal.aborted) throw new Error('The selected raster image could not be decoded.', { cause: error })
      } finally { signal.removeEventListener('abort', cancel) }
    },
    async confirmWorkspaceImage(selection, revision, signal) {
      if (!await pick(revision, signal, selection) && !signal.aborted) throw new Error('The workspace image selection is no longer available. Browse again.')
    },
    dispose() {
      disposed = true
      unlisten()
      for (const item of waiting.splice(0)) item.resolve()
      requested.clear()
      for (const finish of pending.values()) finish(false)
      for (const finish of pickerRequests.values()) finish()
    },
  }
}
