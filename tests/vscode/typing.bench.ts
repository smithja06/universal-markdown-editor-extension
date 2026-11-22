import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { test } from './desktop'

const unit = 'This paragraph represents ordinary Markdown with **formatting**, [a link](./notes.md), and wrapped text. '.repeat(9) + '\n\n'
const metrics = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const round = (n: number) => Math.round(n * 100) / 100
  return { n: sorted.length, p50: round(sorted[Math.ceil(sorted.length * 0.5) - 1]), p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]) }
}
interface HostMetrics { rss: number; heapUsed: number; cpu: number }
interface Samples {
  local: number[]; host: number[]; edit: number[]; checkpointIpc: number[]; hostWrite: number[]; hostIngress: number[]; hostDelivery: number[]
  failures: number
}

test.use({ delayEdits: true })

for (const size of [100_000, 500_000, 1_000_000, 2_000_000]) {
  test(`measures typing and checkpoint latency at ${size} bytes`, async ({ desktop }) => {
    test.setTimeout(120_000)
    const { page, workspace, command, read } = desktop
    const file = 'benchmark.md'
    const source = '# Benchmark\n\n' + unit.repeat(Math.floor(size / unit.length)).slice(0, size - 15).padEnd(size - 15, ' ') + '\n\n'
    await writeFile(join(workspace, file), source)
    await command('open', { file, editor: 'folio' })
    const frame = page.locator('iframe.webview').first().contentFrame().locator('iframe#active-frame').contentFrame()
    await frame.getByRole('button', { name: 'Markdown Source', exact: true }).click({ timeout: 60_000 })
    const editor = frame.getByRole('textbox', { name: 'Markdown source editor' })
    await editor.focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await page.keyboard.insertText('warmup')
    await expect.poll(async () => (await read(file)).text.endsWith('warmup'), { timeout: 30_000 }).toBe(true)

    await editor.evaluate(() => dispatchEvent(new Event('folio-benchmark-start')))
    const before = await command<HostMetrics>('hostMetrics')
    const time: number[] = []
    for (const character of 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz01') {
      const start = performance.now()
      await page.keyboard.insertText(character)
      time.push(performance.now() - start)
    }
    await expect.poll(async () => (await read(file)).text.endsWith('abcdefghijklmnopqrstuvwxyz01'), { timeout: 30_000 }).toBe(true)
    await expect(frame.getByRole('status').filter({ hasText: 'Unsaved in VS Code' })).toBeVisible()
    const after = await command<HostMetrics>('hostMetrics')
    const samples = await editor.evaluate(() => {
      dispatchEvent(new Event('folio-benchmark-read'))
      return JSON.parse(document.body.dataset.folioBenchmark!) as Samples
    })
    expect(samples.edit.length).toBeGreaterThan(0)
    expect(samples.failures).toBe(0)
    // Inputs are issued serially without waiting for acknowledgement between keystrokes.
    console.log(JSON.stringify({
      bytes: Buffer.byteLength(source), input: metrics(time), local: metrics(samples.local),
      host: metrics(samples.host), acknowledgement: metrics(samples.edit), checkpointIpc: metrics(samples.checkpointIpc),
      hostWrite: metrics(samples.hostWrite), hostIngress: metrics(samples.hostIngress), hostDelivery: metrics(samples.hostDelivery),
      hostCpuMs: (after.cpu - before.cpu) / 1000,
      hostRssMiB: (after.rss - before.rss) / 1024 ** 2,
      hostHeapMiB: (after.heapUsed - before.heapUsed) / 1024 ** 2,
    }))
  })
}
