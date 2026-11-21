// Injected into a temporary test copy before Folio acquires the real VS Code API.
{
  const acquire = globalThis.acquireVsCodeApi
  const setItem = Storage.prototype.setItem
  let holding = false
  let offline = false
  let noLocalStorage = false
  const delayed = []
  globalThis.addEventListener('folio-test-hold-edits', () => { holding = true })
  globalThis.addEventListener('folio-test-hold-all', () => { offline = true; holding = true })
  globalThis.addEventListener('folio-test-disable-local-storage', () => { noLocalStorage = true })
  Storage.prototype.setItem = function (key, value) {
    if (noLocalStorage && key.startsWith('folio.recovery.')) throw new DOMException('Recovery storage unavailable', 'QuotaExceededError')
    return setItem.call(this, key, value)
  }
  globalThis.addEventListener('folio-test-release-edits', () => {
    holding = false
    offline = false
    for (const post of delayed.splice(0)) post()
  })
  globalThis.addEventListener('message', event => {
    const message = event.data?.message
    if (message?.type === 'stored' && message.stored) globalThis.document.body.dataset.folioTestStored = String(message.generation)
    if (message?.type === 'copied') globalThis.document.body.dataset.folioTestCopyResult = String(message.copied)
  })
  globalThis.acquireVsCodeApi = () => {
    const api = acquire()
    return { ...api, postMessage(message, transfer) {
      if (message.message.type === 'copy') {
        globalThis.document.body.dataset.folioTestCopied = JSON.stringify(message.message.text)
      }
      if (holding && (message.message.type === 'edit' || (offline && message.message.type === 'checkpoint'))) {
        delayed.push(() => api.postMessage(message, transfer))
      }
      else api.postMessage(message, transfer)
    } }
  }
}
