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
  test.use({ virtualWorkspace: true, delayEdits: true })

  test('preserves BOM, CRLF, and a Unicode image reference in a provider .markdown save', async ({ desktop }) => {
    const { page, command } = desktop
    const file = 'portable.markdown'
    const asset = '![Portable image](../media/caf%C3%A9%20%23%25%28final%29%252F.png)'
    const before = '# Provider fidelity\r\n\r\n' + asset + '\r\n'
    await command('addVirtualWorkspace', { markdown: '\uFEFF' + before, pixel, file })
    await command('open', { file, editor: 'folio', virtual: 1 })
    const frame = folio(page)
    const heading = frame.getByRole('heading', { name: 'Provider fidelity' })
    await expect.poll(() => frame.getByRole('img', { name: 'Portable image' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
    await heading.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
    await page.keyboard.insertText(' edited')
    const edited = before.replace('Provider fidelity', 'Provider fidelity edited')
    await expect.poll(async () => (await command<{ text: string }>('read', { file, virtual: 1 })).text).toBe(edited)
    await command('saveDocument', { file, virtual: 1 })
    expect(await command('readProviderFile', { file, encoding: 'base64' })).toBe(Buffer.from('\uFEFF' + edited).toString('base64'))
  })

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

  test('resolves root-relative paths against the document folder in a multi-root workspace', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const file = 'source.md'
    const original = '# Provider document\n\n![Provider pixel](/media/pixel.png)\n\n[Provider target](/target.md#L2)\n\n![Across boundary](../../workspace/pixel.png)\n'
    await mkdir(join(workspace, 'media'))
    await writeFile(join(workspace, 'media', 'pixel.png'), 'Local decoy')
    await writeFile(join(workspace, 'target.md'), '# Local decoy\n')
    await command('addVirtualWorkspace', { markdown: original, pixel })
    await command('open', { file, editor: 'folio', virtual: 1 })
    const frame = folio(page)
    const providerImage = frame.getByRole('img', { name: 'Provider pixel' })
    await expect(providerImage).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect.poll(() => providerImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
    const boundaryImage = frame.getByRole('img', { name: 'Across boundary' })
    await expect(boundaryImage).toBeVisible()
    expect(await boundaryImage.getAttribute('src')).toBeNull()
    expect(await command('boundaryReads')).toBe(0)
    await frame.getByRole('link', { name: 'Provider target' }).click({ modifiers: [modifier as 'Meta' | 'Control'] })
    await expect.poll(() => command('activeNativeUri')).toBe('folio-test-remote://test-server/project/target.md')
    await expect.poll(() => command('activeNativeLine')).toBe(1)

    await command('open', { file, editor: 'folio', virtual: 1 })
    await frame.getByRole('heading', { name: 'Provider document' }).click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
    await page.keyboard.insertText(' edited')
    const edited = original.replace('Provider document', 'Provider document edited')
    await expect.poll(async () => (await command<{ text: string }>('read', { file, virtual: 1 })).text).toBe(edited)
    await command('saveDocument', { file, virtual: 1 })
    expect(await command('readProviderFile', { file })).toBe(edited)
  })

  test('reopens a renamed provider document and stops editing its deleted URI', async ({ desktop }) => {
    const { page, command } = desktop
    const file = 'source.md'
    const renamed = 'renamed.md'
    const original = '# Provider lifecycle\n\n![Provider pixel](../media/pixel.png)\n'
    await command('addVirtualWorkspace', { markdown: original, pixel })
    await command('open', { file, editor: 'folio', virtual: 1 })
    const frame = folio(page)
    await expect(frame.getByRole('heading', { name: 'Provider lifecycle' })).toBeVisible()
    await command('rename', { file, to: renamed, virtual: 1 })
    expect(await command('readProviderFile', { file })).toBe(null)
    expect(await command('readProviderFile', { file: renamed })).toBe(original)
    await command('open', { file: renamed, editor: 'folio', virtual: 1 })
    await expect(frame.getByRole('heading', { name: 'Provider lifecycle' })).toBeVisible()
    await expect.poll(() => frame.getByRole('img', { name: 'Provider pixel' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)

    await command('deleteFile', { file: renamed, virtual: 1 })
    expect(await command('readProviderFile', { file: renamed })).toBe(null)
    await expect.poll(async () => await page.locator('iframe.webview:visible').count() === 0 ||
      await frame.getByText('File unavailable', { exact: true }).isVisible()).toBe(true)
  })

  test('keeps an edit pending through provider unavailability and saves it after recovery', async ({ desktop }) => {
    const { page, command } = desktop
    const file = 'source.md'
    const virtual = 1
    const original = '# Provider recovery\r\n\r\n[Next](./target.md)\r\n'
    await command('addVirtualWorkspace', { markdown: '\uFEFF' + original, pixel })
    await command('open', { file, editor: 'folio', virtual })
    const frame = folio(page)
    const heading = frame.getByRole('heading', { name: 'Provider recovery', exact: true })
    await heading.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
    await command('setProviderUnavailable', { unavailable: 1 })
    await page.keyboard.insertText(' restored')
    await expect(frame.locator('body')).toHaveAttribute('data-folio-test-stored', '1')
    await expect.poll(() => command('providerStatFailures')).toBeGreaterThanOrEqual(2)
    expect(await command<{ text: string }>('read', { file, virtual })).toMatchObject({ text: original, dirty: false })
    await page.keyboard.press(`${modifier}+s`)
    await command('setProviderUnavailable', { unavailable: 0 })
    const expected = original.replace('Provider recovery', 'Provider recovery restored')
    await expect.poll(() => command('readProviderFile', { file })).toBe('\uFEFF' + expected)
    await expect(frame.getByText('View pending Markdown', { exact: true })).toHaveCount(0)
    await frame.getByRole('link', { name: 'Next' }).click({ modifiers: [modifier as 'Meta' | 'Control'] })
    await expect.poll(() => command('activeNativeUri')).toBe('folio-test-remote://test-server/project/docs/target.md')
  })

  test('preserves overlapping native and Folio edits during a provider outage', async ({ desktop }) => {
    const { page, command } = desktop
    const file = 'source.md'
    const virtual = 1
    const original = '# Provider conflict\n'
    await command('addVirtualWorkspace', { markdown: original, pixel })
    await command('open', { file, editor: 'folio', virtual, column: 1 })
    const frame = folio(page)
    const heading = frame.getByRole('heading', { name: 'Provider conflict', exact: true })
    await expect(heading).toBeVisible()
    await command('open', { file, editor: 'native', virtual, column: 2 })
    await heading.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
    await command('setProviderUnavailable', { unavailable: 1 })
    await page.keyboard.insertText(' Folio')
    await expect.poll(() => command('providerStatFailures')).toBeGreaterThanOrEqual(2)
    await command('insert', { file, virtual, offset: original.length - 1, text: ' native' })
    await command('setProviderUnavailable', { unavailable: 0 })

    await frame.getByText('View pending Markdown', { exact: true }).click()
    await frame.getByText('View VS Code Markdown at recovery', { exact: true }).click()
    await expect(frame.getByRole('textbox', { name: 'Pending Markdown' })).toHaveValue('# Provider conflict Folio\n')
    await expect(frame.getByRole('textbox', { name: 'VS Code Markdown at recovery' })).toHaveValue('# Provider conflict native\n')
    await expect(frame.getByRole('heading', { name: 'Provider conflict native', exact: true })).toBeVisible()
    const native = await command<{ text: string }>('read', { file, virtual })
    expect(native.text).toBe('# Provider conflict native\n')
    expect(await command('readProviderFile', { file })).toBe(original)
  })

  test('keeps a host-backed draft for review when a provider outage outlasts retries', async ({ desktop }) => {
    const { page, command } = desktop
    const file = 'source.md'
    const virtual = 1
    const original = '# Provider unavailable\n'
    await command('addVirtualWorkspace', { markdown: original, pixel })
    await command('open', { file, editor: 'folio', virtual })
    const frame = folio(page)
    const heading = frame.getByRole('heading', { name: 'Provider unavailable', exact: true })
    await heading.evaluate(() => dispatchEvent(new Event('folio-test-disable-local-storage')))
    await heading.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
    await command('setProviderUnavailable', { unavailable: 1 })
    await page.keyboard.insertText(' draft')
    await expect(frame.getByText('View pending Markdown', { exact: true })).toBeVisible()
    await expect(frame.locator('body')).toHaveAttribute('data-folio-test-stored', '2')
    await command('setProviderUnavailable', { unavailable: 0 })
    await command('close')
    await command('open', { file, editor: 'folio', virtual })
    await expect(heading).toBeVisible()
    await frame.getByText('View pending Markdown', { exact: true }).click()
    await expect(frame.getByRole('textbox', { name: 'Pending Markdown' })).toHaveValue('# Provider unavailable draft\n')
    expect(await command('readProviderFile', { file })).toBe(original)
  })
})
