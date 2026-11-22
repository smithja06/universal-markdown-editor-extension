import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { test } from './desktop'

interface HostMemory { rss: number; heapUsed: number }

test('samples retained memory after repeated Folio view disposal', async ({ desktop }) => {
  test.setTimeout(180_000)
  const { page, workspace, command } = desktop
  const webviews = page.locator('iframe.webview')
  const paragraph = 'Ordinary Markdown with **emphasis** and [a relative link](./other.md).' +
    ' A sentence of plain text keeps the fixture close to the sustained typing workload.'.repeat(10) + '\n\n'
  const body = paragraph.repeat(Math.floor(1_000_000 / paragraph.length))
  const mib = (bytes: number) => Math.round(bytes / 1024 ** 2 * 100) / 100
  const cdp = await page.context().newCDPSession(page)

  async function cycle(index: number) {
    const file = `retention-${index}.md`
    const title = `Retention ${index}`
    await writeFile(join(workspace, file), `# ${title}\n\n${body}`)
    for (const column of [1, 2]) await command('open', { file, editor: 'folio', column })
    await expect(webviews).toHaveCount(2)
    for (let view = 0; view < 2; view++) {
      const frame = webviews.nth(view).contentFrame().locator('iframe#active-frame').contentFrame()
      await expect(frame.getByRole('heading', { name: title, exact: true })).toBeVisible()
    }
    await command('closeFolio', { file })
    await expect(webviews).toHaveCount(0)
  }

  async function sample(cycles: number) {
    await cdp.send('HeapProfiler.collectGarbage')
    const renderer = await cdp.send('Runtime.getHeapUsage')
    const host = await command<HostMemory>('hostMetrics', { collectGarbage: 1 })
    return { cycles, hostRssMiB: mib(host.rss), hostHeapMiB: mib(host.heapUsed), workbenchHeapMiB: mib(renderer.usedSize) }
  }

  try {
    await cycle(0)
    const samples = [await sample(0)]
    for (let index = 1; index <= 16; index++) {
      await cycle(index)
      if (index % 4 === 0) samples.push(await sample(index))
    }
    console.log('FOLIO_RETENTION ' + JSON.stringify(samples))
  } finally { await cdp.detach() }
})
