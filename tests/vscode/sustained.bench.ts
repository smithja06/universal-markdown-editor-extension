import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect } from '@playwright/test'
import { test } from './desktop'

const paragraph = 'This Markdown paragraph contains **emphasis**, [a link](./notes.md), and wrapped text.' +
  ' Ordinary prose follows to exercise editing and wrapping without filling the whole page with rich inline nodes.'.repeat(6)
const keystrokes = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz01'.repeat(2)
const modes = ['Markdown Source', 'Visual Editor', 'Split Editor'] as const
const sizes = [100_000, 500_000, 1_000_000, 2_000_000, 5_000_000]
const interval = 75

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const percentile = (p: number) => sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100 : null
  return { n: sorted.length, p50: percentile(0.5), p95: percentile(0.95) }
}

interface HostMetrics { rss: number; heapUsed: number; cpu: number }
interface MemorySample { keys: number; hostRssMiB: number; hostHeapMiB: number; webHeapMiB: number | null }
interface Samples {
  local: number[]; creation: number[]; host: number[]; edit: number[]; checkpointIpc: number[]; hostWrite: number[]
  hostIngress: number[]; hostDelivery: number[]; hostFailures: number; localFailures: number; pending: number
}

test.use({ delayEdits: true })

for (const size of sizes) {
  for (const mode of modes) {
    test(`sustained ${mode} at ${size} bytes`, async ({ desktop }) => {
      test.setTimeout(180_000)
      const { page, workspace, command } = desktop
      const file = 'sustained.md'
      const path = join(workspace, file)
      const defaultCount = mode === 'Markdown Source' || size === 100_000 ? keystrokes.length : size <= 500_000 ? 48 : size <= 2_000_000 ? 32 : 16
      const long = process.env.FOLIO_BENCHMARK_LONG === '1'
      const input = long ? keystrokes.repeat(3) : keystrokes.slice(0, defaultCount)
      const header = '# Benchmark'
      const ending = '\n'
      const bodyBytes = size - header.length - ending.length - 2
      const section = paragraph + '\n\n'
      const source = header + '\n\n' + section.repeat(Math.floor(bodyBytes / section.length)) + 'x'.repeat(bodyBytes % section.length) + ending
      await writeFile(path, source)
      const frame = page.locator('iframe.webview').first().contentFrame().locator('iframe#active-frame').contentFrame()
      const visual = frame.getByRole('textbox', { name: 'Visual document editor' })
      const sourcePane = frame.getByRole('textbox', { name: 'Markdown source editor' })
      const heading = visual.getByRole('heading', { name: 'Benchmark', exact: true })
      const opened = performance.now()
      await command('open', { file, editor: 'folio' })
      await expect(heading).toBeVisible({ timeout: 60_000 })
      const startupMs = performance.now() - opened
      let switchMs = 0
      if (mode !== 'Visual Editor') {
        const switching = performance.now()
        await frame.getByRole('button', { name: mode, exact: true }).click()
        await expect(sourcePane).toBeEditable({ timeout: 60_000 })
        switchMs = performance.now() - switching
      }
      const editor = mode === 'Markdown Source' ? sourcePane : visual
      if (mode === 'Markdown Source') await sourcePane.focus()
      else await heading.click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
      const memory = () => editor.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null)
      const sample = () => editor.evaluate(() => {
        dispatchEvent(new Event('folio-benchmark-read'))
        return JSON.parse(document.body.dataset.folioBenchmark!) as Samples
      })
      const webHeapBefore = await memory()
      const before = await command<HostMetrics>('hostMetrics')
      await editor.evaluate(() => dispatchEvent(new Event('folio-benchmark-start')))
      const time: number[] = []
      const memorySamples: MemorySample[] = []
      const started = performance.now()
      for (const character of input) {
        const start = performance.now()
        await page.keyboard.insertText(character)
        time.push(performance.now() - start)
        if (long && time.length % keystrokes.length === 0 && time.length < input.length) {
          const webHeap = await memory()
          const { rss, heapUsed } = await command<HostMetrics>('hostMetrics')
          memorySamples.push({ keys: time.length, hostRssMiB: rss / 1024 ** 2, hostHeapMiB: heapUsed / 1024 ** 2,
            webHeapMiB: webHeap === null ? null : webHeap / 1024 ** 2 })
        }
        const remaining = interval - (performance.now() - start)
        if (remaining > 0) await delay(remaining)
      }
      await expect(frame.getByRole('status').filter({ hasText: 'Unsaved in VS Code' })).toBeVisible({ timeout: 40_000 })
      await expect.poll(async () => (await sample()).pending, { timeout: 30_000 }).toBe(0)
      const elapsedMs = performance.now() - started
      const after = await command<HostMetrics>('hostMetrics')
      const webHeapAfter = await memory()
      const samples = await sample()
      const expected = source.replace(header, header + input + '!')
      await command('enableAutosave')
      await editor.focus()
      const autosave = performance.now()
      await page.keyboard.insertText('!')
      let saved = false
      let prefix = ''
      const expires = performance.now() + 12_000
      while (!saved && performance.now() < expires) {
        const current = await readFile(path, 'utf8')
        saved = current === expected
        prefix = current.slice(0, header.length + input.length + 1)
        if (!saved) await delay(150)
      }
      const nativePrefix = saved ? undefined : (await desktop.read(file)).text.slice(0, header.length + input.length + 1)
      const result = {
        mode, bytes: Buffer.byteLength(source), interval, startupMs, switchMs, elapsedMs,
        autosaveMs: saved ? performance.now() - autosave : null, ...(saved ? {} : { savedPrefix: prefix, nativePrefix }),
        input: stats(time), creation: stats(samples.creation), local: stats(samples.local), host: stats(samples.host),
        hostWrite: stats(samples.hostWrite), hostIngress: stats(samples.hostIngress), hostDelivery: stats(samples.hostDelivery),
        acknowledgement: stats(samples.edit), checkpointIpc: stats(samples.checkpointIpc),
        hostFailures: samples.hostFailures, localFailures: samples.localFailures,
        hostCpuMs: (after.cpu - before.cpu) / 1000, hostCpuPct: (after.cpu - before.cpu) / elapsedMs / 10,
        hostRssBeforeMiB: before.rss / 1024 ** 2, hostRssAfterMiB: after.rss / 1024 ** 2,
        hostHeapBeforeMiB: before.heapUsed / 1024 ** 2, hostHeapAfterMiB: after.heapUsed / 1024 ** 2,
        webHeapBeforeMiB: webHeapBefore === null ? null : webHeapBefore / 1024 ** 2,
        webHeapAfterMiB: webHeapAfter === null ? null : webHeapAfter / 1024 ** 2,
        ...(long ? { memorySamples } : {}),
      }
      console.log('FOLIO_SUSTAINED ' + JSON.stringify(result))
      expect(samples.edit.length).toBeGreaterThan(0)
      expect(samples.hostFailures).toBe(0)
      expect(samples.localFailures).toBe(0)
      expect(samples.local).toHaveLength(input.length)
      expect(samples.host).toHaveLength(input.length)
      expect(saved, 'autosave writes the exact accumulated Markdown').toBe(true)
    })
  }
}
