import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { test } from './desktop'

function folio(page: Page) {
  return page.locator('iframe.webview:visible').first().contentFrame().locator('iframe#active-frame').contentFrame()
}

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('exposes Folio commands only for the active Folio editor and routes the native shortcut', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'commands.md'
  await writeFile(join(workspace, file), '# Native commands\n')
  await command('open', { file, editor: 'native' })
  await command('showPalette')
  const palette = page.locator('.quick-input-widget input:visible')
  await palette.fill('>Folio: Show Split Editor', { timeout: 10_000 })
  await expect(page.getByRole('option', { name: /Folio: Show Split Editor/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await command('open', { file, editor: 'folio' })
  const frame = folio(page)
  await expect(frame.getByRole('heading', { name: 'Native commands' })).toBeVisible()
  await frame.getByRole('textbox', { name: 'Visual document editor' }).focus()
  await page.keyboard.press(`${modifier}+Shift+p`)
  await palette.fill('>Folio: Show Split Editor', { timeout: 10_000 })
  await page.getByRole('option', { name: /Folio: Show Split Editor/ }).click()
  await expect(frame.getByRole('button', { name: 'Split Editor', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await frame.getByRole('textbox', { name: 'Visual document editor' }).focus()
  await page.keyboard.press(`${modifier}+Alt+Shift+m`)
  await expect(frame.getByRole('button', { name: 'Markdown Source', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('previews workspace images and opens Markdown links without rewriting relative paths', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  await mkdir(join(workspace, 'assets'))
  await writeFile(join(workspace, 'assets', 'a pixel.png'), Buffer.from(pixel, 'base64'))
  await writeFile(join(workspace, 'target.md'), '# Destination\n\n## Detail\n\nFirst section.\n\n## Detail\n\nSecond section.\n')
  const original = '# Resources\n\n![Example](./assets/a%20pixel.png)\n\n[Target](/target.md#detail-1)\n\n![Outside](../outside.png)\n'
  const file = 'resources.md'
  await writeFile(join(workspace, file), original)
  await command('open', { file, editor: 'folio' })
  const frame = folio(page)
  await expect.poll(() => frame.getByRole('img', { name: 'Example' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
  await expect.poll(() => frame.getByRole('img', { name: 'Outside' }).getAttribute('src')).toBeNull()
  await frame.getByRole('heading', { name: 'Resources' }).click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await page.keyboard.insertText(' edited')
  const edited = original.replace('# Resources', '# Resources edited')
  await expect.poll(async () => (await read(file)).text).toBe(edited)
  await frame.getByRole('link', { name: 'Target' }).click({ modifiers: [modifier as 'Meta' | 'Control'] })
  const uri = (await read('target.md')).uri
  await expect.poll(() => command('activeNativeUri')).toBe(uri)
  await expect.poll(() => command('activeNativeLine')).toBe(6)
  await command('saveDocument', { file })
  expect(await readFile(join(workspace, file), 'utf8')).toBe(edited)
  await command('open', { file, editor: 'folio' })
  await frame.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await frame.locator('.md-link').filter({ hasText: '/target.md#detail-1' }).click({ modifiers: [modifier as 'Meta' | 'Control'] })
  await expect.poll(() => command('activeNativeUri')).toBe(uri)
})

test.describe('provider-native resources', () => {
  test.use({ virtualWorkspace: true })

  test('resolves images and Markdown links through a non-file workspace provider', async ({ desktop }) => {
    const { page, command } = desktop
    const original = '# Provider document\n\n![Remote asset](../media/pixel.png)\n\n![Same asset](../media/pixel.png)\n\n![Symlink](./secret-link.png)\n\n![Replaced](../media/race.png)\n\n[Next](./target.md#L1)\n'
    await command('addVirtualWorkspace', { markdown: original, pixel })
    await command('open', { file: 'source.md', editor: 'folio', virtual: 1 })
    const frame = folio(page)
    for (const name of ['Remote asset', 'Same asset']) {
      await expect.poll(() => frame.getByRole('img', { name, exact: true }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
    }
    for (const name of ['Symlink', 'Replaced']) {
      await expect(frame.getByRole('img', { name })).toBeVisible()
      expect(await frame.getByRole('img', { name }).getAttribute('src')).toBeNull()
    }
    expect(await command('pixelReads')).toBe(1)
    expect(await command('unsafeReads')).toBe(0)
    await frame.getByRole('link', { name: 'Next' }).click({ modifiers: [modifier as 'Meta' | 'Control'] })
    await expect.poll(() => command('activeNativeUri')).toBe('folio-test-remote://test-server/project/docs/target.md')
    await command('saveDocument', { file: 'source.md', virtual: 1 })
    const document = await command<{ text: string }>('read', { file: 'source.md', virtual: 1 })
    expect(document.text).toBe(original)
  })
})
