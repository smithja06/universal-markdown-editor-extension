// Injected into a temporary test copy before Folio acquires the real VS Code API.
{
  const acquire = globalThis.acquireVsCodeApi
  let holding = false
  const delayed = []
  globalThis.addEventListener('folio-test-hold-edits', () => { holding = true })
  globalThis.addEventListener('folio-test-release-edits', () => {
    holding = false
    for (const post of delayed.splice(0)) post()
  })
  globalThis.acquireVsCodeApi = () => {
    const api = acquire()
    return { ...api, postMessage(message, transfer) {
      if (holding && message.type === 'edit') delayed.push(() => api.postMessage(message, transfer))
      else api.postMessage(message, transfer)
    } }
  }
}
