// Injected into a temporary test copy before Folio acquires the real VS Code API.
{
  const acquire = globalThis.acquireVsCodeApi
  const setItem = Storage.prototype.setItem
  let holding = false
  let offline = false
  let noLocalStorage = false
  let benchmark
  const checkpointTimes = new Map()
  const editTimes = new Map()
  const delayed = []
  globalThis.addEventListener('folio-benchmark-start', () => {
    benchmark = { local: [], host: [], edit: [], checkpointIpc: [], failures: 0 }
    checkpointTimes.clear()
    editTimes.clear()
  })
  globalThis.addEventListener('folio-benchmark-read', () => {
    globalThis.document.body.dataset.folioBenchmark = JSON.stringify(benchmark)
  })
  globalThis.addEventListener('folio-test-hold-edits', () => { holding = true })
  globalThis.addEventListener('folio-test-hold-all', () => { offline = true; holding = true })
  globalThis.addEventListener('folio-test-disable-local-storage', () => { noLocalStorage = true })
  Storage.prototype.setItem = function (key, value) {
    if (!key.startsWith('folio.recovery.')) return setItem.call(this, key, value)
    const start = performance.now()
    try {
      if (noLocalStorage) throw new DOMException('Recovery storage unavailable', 'QuotaExceededError')
      return setItem.call(this, key, value)
    } catch (error) {
      if (benchmark) benchmark.failures++
      throw error
    } finally { benchmark?.local.push(performance.now() - start) }
  }
  globalThis.addEventListener('folio-test-release-edits', () => {
    holding = false
    offline = false
    for (const post of delayed.splice(0)) post()
  })
  globalThis.addEventListener('message', event => {
    const message = event.data?.message
    if (benchmark && message?.type === 'stored' && checkpointTimes.has(message.generation)) {
      benchmark.host.push(performance.now() - checkpointTimes.get(message.generation))
      checkpointTimes.delete(message.generation)
      if (!message.stored) benchmark.failures++
    }
    if (benchmark && message?.type === 'state' && editTimes.has(message.edit?.id)) {
      benchmark.edit.push(performance.now() - editTimes.get(message.edit.id))
      editTimes.delete(message.edit.id)
    }
    if (message?.type === 'stored' && message.stored) globalThis.document.body.dataset.folioTestStored = String(message.generation)
    if (message?.type === 'copied') globalThis.document.body.dataset.folioTestCopyResult = String(message.copied)
  })
  globalThis.acquireVsCodeApi = () => {
    const api = acquire()
    return { ...api, postMessage(message, transfer) {
      const start = performance.now()
      if (benchmark && message.message.type === 'checkpoint') checkpointTimes.set(message.message.draft.generation, start)
      if (message.message.type === 'checkpoint' && typeof message.message.draft.baseRevision === 'number') {
        globalThis.document.body.dataset.folioTestPacked = String(message.message.draft.generation)
      }
      if (benchmark && message.message.type === 'edit') editTimes.set(message.message.id, start)
      if (message.message.type === 'copy') {
        globalThis.document.body.dataset.folioTestCopied = JSON.stringify(message.message.text)
      }
      if (holding && (message.message.type === 'edit' || (offline && message.message.type === 'checkpoint'))) {
        delayed.push(() => api.postMessage(message, transfer))
      }
      else api.postMessage(message, transfer)
      if (benchmark && message.message.type === 'checkpoint') benchmark.checkpointIpc.push(performance.now() - start)
    } }
  }
}
