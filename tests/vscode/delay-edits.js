// Injected into a temporary test copy before Folio acquires the real VS Code API.
{
  const acquire = globalThis.acquireVsCodeApi
  const setItem = Storage.prototype.setItem
  let holding = false
  let offline = false
  let noLocalStorage = false
  let captureCheckpoint = false
  let firstCheckpoint
  let benchmark
  const checkpointTimes = new Map()
  const editTimes = new Map()
  let inputStart
  globalThis.document.addEventListener('beforeinput', () => { inputStart = performance.now() }, true)
  const delayed = []
  globalThis.addEventListener('folio-benchmark-start', () => {
    benchmark = { local: [], creation: [], host: [], edit: [], checkpointIpc: [], hostWrite: [], hostIngress: [], hostDelivery: [],
      hostFailures: 0, localFailures: 0, failures: 0, pending: 0 }
    checkpointTimes.clear()
    editTimes.clear()
  })
  globalThis.addEventListener('folio-benchmark-read', () => {
    benchmark.pending = checkpointTimes.size
    globalThis.document.body.dataset.folioBenchmark = JSON.stringify(benchmark)
  })
  globalThis.addEventListener('folio-test-hold-edits', () => { holding = true })
  globalThis.addEventListener('folio-test-hold-all', () => { offline = true; holding = true })
  globalThis.addEventListener('folio-test-disable-local-storage', () => { noLocalStorage = true })
  globalThis.addEventListener('folio-test-capture-checkpoint', () => { captureCheckpoint = true })
  Storage.prototype.setItem = function (key, value) {
    if (!key.startsWith('folio.recovery.')) return setItem.call(this, key, value)
    const start = performance.now()
    try {
      if (noLocalStorage) throw new DOMException('Recovery storage unavailable', 'QuotaExceededError')
      return setItem.call(this, key, value)
    } catch (error) {
      if (benchmark) { benchmark.failures++; benchmark.localFailures++ }
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
      const { start, sentAt } = checkpointTimes.get(message.generation)
      benchmark.host.push(performance.now() - start)
      if (typeof message.hostWriteMs === 'number') benchmark.hostWrite.push(message.hostWriteMs)
      if (typeof message.hostReceivedAt === 'number') benchmark.hostIngress.push(Math.max(0, message.hostReceivedAt - sentAt))
      if (typeof message.hostRepliedAt === 'number') benchmark.hostDelivery.push(Math.max(0, Date.now() - message.hostRepliedAt))
      checkpointTimes.delete(message.generation)
      if (!message.stored) { benchmark.failures++; benchmark.hostFailures++ }
    }
    if (benchmark && (message?.type === 'state' || message?.type === 'accepted') && editTimes.has(message.edit?.id)) {
      benchmark.edit.push(performance.now() - editTimes.get(message.edit.id))
      editTimes.delete(message.edit.id)
    }
    if (message?.type === 'stored' && message.stored) globalThis.document.body.dataset.folioTestStored = String(message.generation)
    if (message?.type === 'copied') globalThis.document.body.dataset.folioTestCopyResult = String(message.copied)
    if (message?.type === 'dismissed' && firstCheckpoint &&
      message.id === firstCheckpoint.message.draft.id && message.generation === firstCheckpoint.message.draft.generation) {
      globalThis.document.body.dataset.folioTestStaleDismissed = String(message.dismissed)
    }
  })
  globalThis.acquireVsCodeApi = () => {
    const api = acquire()
    globalThis.addEventListener('folio-test-replay-stale-checkpoint', () => {
      if (!firstCheckpoint) return
      const { id, generation } = firstCheckpoint.message.draft
      api.postMessage(firstCheckpoint)
      api.postMessage({ connection: firstCheckpoint.connection, message: { type: 'dismiss', id, generation } })
    })
    return { ...api, postMessage(message, transfer) {
      const start = performance.now()
      if (benchmark && message.message.type === 'checkpoint') {
        checkpointTimes.set(message.message.draft.generation, { start, sentAt: Date.now() })
        if (inputStart !== undefined) benchmark.creation.push(start - inputStart)
        inputStart = undefined
      }
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
      if (captureCheckpoint && message.message.type === 'checkpoint') {
        firstCheckpoint = message
        captureCheckpoint = false
      }
    } }
  }
}
