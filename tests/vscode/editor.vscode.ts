import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type FrameLocator, type Page } from '@playwright/test'
import { test } from './desktop'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const end = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'
const endOfLine = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'

function folio(page: Page, index = 0) {
  return page.locator('iframe.webview').nth(index).contentFrame().locator('iframe#active-frame').contentFrame()
}

function visual(frame: FrameLocator) { return frame.getByRole('textbox', { name: 'Visual document editor' }) }
function source(frame: FrameLocator) { return frame.getByRole('textbox', { name: 'Markdown source editor' }) }

test('opens optionally, keeps exact BOM and CRLF, and saves through native undo and redo', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  const file = 'roundtrip.md'
  const path = join(workspace, file)
  const untouched = 'A  *word* and [reference][id].\r\n\r\n<section data-custom="literal">keep me</section>\r\n\r\n[id]: /target "Title"\r\n'
  const original = `# Initial heading\r\n\r\n${untouched}`
  await writeFile(path, '\uFEFF' + original)

  await command('open', { file, editor: 'default' })
  expect(await command<string>('activeNativeUri')).toBe((await read(file)).uri)
  await expect(page.locator('iframe.webview')).toHaveCount(0)

  await command('open', { file, editor: 'folio' })
  const frame = folio(page)
  const heading = visual(frame).getByRole('heading', { name: 'Initial heading' })
  await expect(heading).toBeVisible()
  expect(await heading.evaluate(async () => (await indexedDB.databases()).some(database => database.name === 'folio-workspace'))).toBe(false)
  await heading.click()
  await page.keyboard.press(endOfLine)
  await page.keyboard.insertText(' edited')
  const changed = `# Initial heading edited\r\n\r\n${untouched}`
  await expect.poll(async () => (await read(file)).text).toBe(changed)
  await expect.poll(async () => (await read(file)).dirty).toBe(true)

  await frame.getByRole('button', { name: 'Split Editor', exact: true }).click()
  await expect(source(frame)).toContainText('Initial heading edited')
  await expect(source(frame).locator('.md-heading').filter({ hasText: 'Initial heading edited' }).first()).toBeVisible()
  await frame.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  await frame.getByRole('button', { name: 'Split Editor', exact: true }).click()
  await expect(source(frame)).toContainText('<section data-custom="literal">keep me</section>')
  await source(frame).focus()
  await page.keyboard.press(end)
  await page.keyboard.insertText('Rapid')
  await page.keyboard.insertText(' source')
  await page.keyboard.insertText(' edits')
  const final = changed + 'Rapid source edits'
  await expect.poll(async () => (await read(file)).text).toBe(final)

  await command('undo')
  await expect.poll(async () => (await read(file)).text).not.toBe(final)
  await command('redo')
  await expect.poll(async () => (await read(file)).text).toBe(final)
  await expect(source(frame)).toContainText('Rapid source edits')
  await source(frame).focus()
  await page.keyboard.press(`${modifier}+z`)
  await expect.poll(async () => (await read(file)).text).not.toBe(final)
  await page.keyboard.press(`${modifier}+Shift+z`)
  await expect.poll(async () => (await read(file)).text).toBe(final)
  await page.keyboard.press(`${modifier}+s`)
  await expect.poll(() => readFile(path, 'utf8')).toBe('\uFEFF' + final)
  await expect.poll(async () => (await read(file)).dirty).toBe(false)

  await command('close')
  await command('open', { file, editor: 'native' })
  expect(await command<string>('activeNativeUri')).toBe((await read(file)).uri)
  expect((await read(file)).text).toBe(final)
})

test('follows live VS Code light, dark and high-contrast themes across Folio', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'scrollbars.md'
  await writeFile(join(workspace, file), '# Scrollbars\n\n' + 'Scrollable Markdown paragraph.\n\n'.repeat(80))
  await command('open', { file, editor: 'folio' })
  const frame = folio(page)
  await expect(visual(frame).getByRole('heading', { name: 'Scrollbars' })).toBeVisible()
  await frame.getByRole('button', { name: 'Split Editor', exact: true }).click()
  await frame.getByRole('button', { name: 'Toggle document properties' }).click()
  await frame.getByRole('tab', { name: 'Appearance' }).click()

  await expect(frame.getByText('Colors follow the VS Code theme.')).toBeVisible()
  const scrollers = ['.visual-scroll', '.source-editor .cm-scroller', '.property-panel']
  for (const [theme, appearance, bodyClass, thumb] of [
    ['Light+', 'light', 'vscode-light', 'rgb(139, 139, 139)'],
    ['Dark+', 'dark', 'vscode-dark', 'rgb(113, 131, 120)'],
    ['Default High Contrast', 'dark', 'vscode-high-contrast', 'rgb(113, 131, 120)'],
    ['Default High Contrast Light', 'light', 'vscode-high-contrast-light', 'rgb(139, 139, 139)'],
  ]) {
    await command('theme', { theme })
    await expect(frame.locator('body')).toHaveClass(new RegExp(`(?:^| )${bodyClass}(?: |$)`))
    const app = frame.locator('.app')
    await expect(app).toHaveAttribute('data-theme', appearance)
    const colors = await app.evaluate(element => {
      const probe = document.createElement('span')
      element.append(probe)
      const tokens = ['editor-background', 'editor-foreground', 'focusBorder', 'menu-background', 'editor-selectionBackground']
      const values = tokens.map(token => {
        probe.style.color = `var(--vscode-${token})`
        return getComputedStyle(probe).color
      })
      probe.remove()
      return values
    })
    const [background, foreground, focus, menu, selection] = colors
    await expect(app).toHaveCSS('background-color', background)
    await expect(visual(frame)).toHaveCSS('color', foreground)
    for (const scroller of scrollers) await expect(frame.locator(scroller)).toHaveCSS('scrollbar-color', `${thumb} ${background}`)
    const view = frame.getByRole('button', { name: 'View', exact: true })
    await view.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(view).toBeFocused()
    await expect(view).toHaveCSS('outline-color', focus)
    await view.click()
    await expect(frame.locator('.dropdown')).toHaveCSS('background-color', menu)
    await page.keyboard.press('Escape')
    const markdown = source(frame)
    expect(await markdown.evaluate(element => getComputedStyle(element, '::selection').backgroundColor)).toBe(selection)
  }
})

test('shares one buffer between Folio panels and reloads clean external changes', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  const file = 'shared.markdown'
  const path = join(workspace, file)
  await writeFile(path, '# Shared document\n')
  await command('open', { file, editor: 'folio', column: 1 })
  await expect(visual(folio(page))).toContainText('Shared document')
  await command('open', { file, editor: 'folio', column: 2 })
  await expect(visual(folio(page, 1))).toContainText('Shared document')

  await command('insert', { file, offset: 2, text: 'Native ' })
  await expect(visual(folio(page))).toContainText('Native Shared document')
  await expect(visual(folio(page, 1))).toContainText('Native Shared document')
  await command('save')
  await expect.poll(async () => (await read(file)).dirty).toBe(false)

  await writeFile(path, '# External disk update\n')
  await expect(visual(folio(page))).toContainText('External disk update')
  await expect(visual(folio(page, 1))).toContainText('External disk update')
})

test.describe('stale edits', () => {
  test.use({ delayEdits: true })

  test('keeps an overlapping stale Folio edit recoverable without overwriting the native buffer', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const file = 'conflict.md'
    const original = '# Shared\n'
    await writeFile(join(workspace, file), original)
    await command('open', { file, editor: 'folio', column: 1 })
    const frame = folio(page)
    await expect(visual(frame)).toContainText('Shared')
    await command('open', { file, editor: 'native', column: 2 })

    const heading = visual(frame).getByRole('heading', { name: 'Shared' })
    await heading.evaluate(() => { dispatchEvent(new Event('folio-test-hold-edits')) })
    await heading.click()
    await page.keyboard.press(endOfLine)
    await page.keyboard.insertText(' Folio')
    await expect(visual(frame)).toContainText('Shared Folio')
    expect((await read(file)).text).toBe(original)

    await command('insert', { file, offset: original.length - 1, text: ' native' })
    const native = '# Shared native\n'
    await expect.poll(async () => (await read(file)).text).toBe(native)
    await visual(frame).evaluate(() => { dispatchEvent(new Event('folio-test-release-edits')) })
    await frame.getByText('View pending Markdown', { exact: true }).click()
    await expect(frame.getByRole('textbox', { name: 'Pending Markdown' })).toHaveValue('# Shared Folio\n')
    await expect(visual(frame)).toContainText('Shared native')
    expect((await read(file)).text).toBe(native)
    await frame.getByRole('button', { name: 'Discard pending draft' }).click()
    await expect(frame.getByRole('button', { name: 'Discard pending draft' })).toHaveCount(0)
  })

  test('rebases a stale Folio edit when the native change is in another range', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const file = 'independent.md'
    const original = '# Shared\n\nKeep this line.\n'
    await writeFile(join(workspace, file), original)
    await command('open', { file, editor: 'folio', column: 1 })
    const frame = folio(page)
    await expect(visual(frame)).toContainText('Shared')
    await command('open', { file, editor: 'native', column: 2 })

    const heading = visual(frame).getByRole('heading', { name: 'Shared' })
    await heading.evaluate(() => { dispatchEvent(new Event('folio-test-hold-edits')) })
    await heading.click()
    await page.keyboard.press(endOfLine)
    await page.keyboard.insertText(' Folio')
    await expect(visual(frame)).toContainText('Shared Folio')
    expect((await read(file)).text).toBe(original)

    await command('insert', { file, offset: original.indexOf('Keep'), text: 'Native: ' })
    await visual(frame).evaluate(() => { dispatchEvent(new Event('folio-test-release-edits')) })
    await expect.poll(async () => (await read(file)).text).toBe('# Shared Folio\n\nNative: Keep this line.\n')
    await expect(visual(frame)).toContainText('Native: Keep this line.')
    await expect(frame.getByRole('button', { name: 'Discard pending draft' })).toHaveCount(0)
  })
})

test('reopens a renamed file and stops editing a deleted resource', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'before.md'
  const renamed = 'after.md'
  await writeFile(join(workspace, file), '# Same file\n')
  await command('open', { file, editor: 'folio' })
  await expect(visual(folio(page))).toContainText('Same file')
  await command('rename', { file, to: renamed })
  expect(await readFile(join(workspace, renamed), 'utf8')).toBe('# Same file\n')
  await command('open', { file: renamed, editor: 'folio' })
  await expect(visual(folio(page))).toContainText('Same file')

  await unlink(join(workspace, renamed))
  await expect.poll(async () => await page.locator('iframe.webview').count() === 0 ||
    await folio(page).getByText('File unavailable', { exact: true }).isVisible()).toBe(true)
})
