import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { activeContentPdf, malformedPdf, pdfFixture, searchablePages } from '../fixtures/pdfFixtures'
import { test } from './desktop'

function folio(page: Page) {
  return page.locator('iframe.webview:visible').first().contentFrame().locator('iframe#active-frame').contentFrame()
}

test('PDF opens only through the opt-in viewer and supports navigation, zoom, search and copy without writes', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'report.pdf'
  const bytes = pdfFixture(searchablePages)
  await writeFile(join(workspace, file), bytes)
  await command('open', { file, editor: 'default' })
  await expect.poll(() => command('activeCustomEditor')).not.toBe('folio.pdf')
  await expect(page.locator('iframe.webview:visible')).toHaveCount(0)
  await command('open', { file, editor: 'folio.pdf' })
  await expect.poll(() => command('activeCustomEditor')).toBe('folio.pdf')
  const frame = folio(page)
  await expect(frame.getByRole('region', { name: 'Page 1 of 3' })).toBeVisible()
  await expect(frame.locator('.pdf-page[data-page-number="1"] canvas')).toBeAttached()
  await expect.poll(() => frame.locator('.pdf-page[data-page-number="1"] canvas').evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
    let dark = 0
    for (let index = 0; index < data.length; index += 16) if (data[index] < 128) dark++
    return dark
  })).toBeGreaterThan(20)
  await expect(frame.getByText('Read-only PDF')).toBeVisible()

  await frame.getByRole('button', { name: 'Next page' }).click()
  await expect(frame.getByRole('textbox', { name: 'Page number' })).toHaveValue('2')
  const zoom = frame.getByRole('combobox', { name: 'Zoom' })
  await zoom.selectOption('1')
  await frame.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).toHaveValue('1.25')
  await zoom.selectOption('fit-page')
  await zoom.selectOption('fit-width')

  await frame.locator('.pdf-scroll').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ControlOrMeta+f')
  const find = frame.getByRole('textbox', { name: 'Find in PDF' })
  await expect(find).toBeFocused()
  await find.fill('needle')
  await expect(frame.locator('.pdf-find-status')).toHaveText('1 of 2')
  await find.press('Enter')
  await expect(frame.locator('.pdf-find-status')).toHaveText('2 of 2')
  await expect(frame.getByRole('textbox', { name: 'Page number' })).toHaveValue('3')
  await find.press('Escape')

  await command('setClipboard', { text: 'before' })
  await frame.getByRole('button', { name: 'Copy page text' }).click()
  await expect.poll(() => command<string>('clipboard')).toContain('Another needle near the end')
  await frame.locator('.pdf-page[data-page-number="1"] .textLayer span').first().evaluate(span => {
    span.scrollIntoView()
    const range = document.createRange()
    range.selectNodeContents(span)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
  })
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => command<string>('clipboard')).toBe('Folio PDF fixture page one')

  expect(await command('activeTabDirty')).toBe(false)
  expect(new Uint8Array(await readFile(join(workspace, file)))).toEqual(bytes)
})

test('PDF viewer reports external replacement and deletion, reloads safely and disposes on close', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'changing.pdf'
  await writeFile(join(workspace, file), pdfFixture([['Version one']]))
  await command('open', { file, editor: 'folio.pdf' })
  const frame = folio(page)
  await expect(frame.getByRole('region', { name: 'Page 1 of 1' })).toBeVisible()
  await writeFile(join(workspace, file), pdfFixture([['Version two'], ['Added page']]))
  await expect(frame.getByRole('alert')).toContainText('changed on disk')
  await expect(frame.getByRole('region', { name: 'Page 1 of 1' })).toBeVisible()
  await frame.getByRole('button', { name: 'Reload from disk' }).click()
  await expect(frame.getByRole('region', { name: 'Page 1 of 2' })).toBeVisible()
  await expect(frame.getByRole('alert')).toHaveCount(0)
  await rm(join(workspace, file))
  await expect(frame.getByRole('alert')).toContainText('moved or deleted')
  await expect(frame.getByRole('region', { name: 'Page 2 of 2' })).toBeAttached()
  expect(await command('activeTabDirty')).toBe(false)
  await command('close')
  await expect(page.locator('iframe.webview:visible')).toHaveCount(0)
  expect(await command('openTabs')).toBe(0)
})

test('PDF viewer explains malformed files and keeps embedded actions inert', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  await writeFile(join(workspace, 'broken.pdf'), malformedPdf())
  await command('open', { file: 'broken.pdf', editor: 'folio.pdf' })
  await expect(folio(page).getByRole('alert')).toContainText('not a readable PDF')
  await command('close')
  await writeFile(join(workspace, 'active.pdf'), activeContentPdf())
  await command('open', { file: 'active.pdf', editor: 'folio.pdf' })
  const frame = folio(page)
  await expect(frame.getByRole('note')).toContainText('does not run them')
  await expect(frame.locator('.pdf-page a, .pdf-page input, .annotationLayer')).toHaveCount(0)
  const box = await frame.locator('.pdf-page[data-page-number="1"]').boundingBox()
  await page.mouse.click(box!.x + box!.width * 0.3, box!.y + box!.height * 0.17)
  await page.waitForTimeout(500)
  expect(await command('openTabs')).toBe(1)
  expect(await frame.locator('body').evaluate(() => (globalThis as { folioPdfScriptRan?: boolean }).folioPdfScriptRan)).toBeUndefined()
})

test.describe('PDF workspace boundaries', () => {
  test.use({ virtualWorkspace: true })

  test('PDF declines a non-file filesystem provider', async ({ desktop }) => {
    const { page, command } = desktop
    const file = 'provider.pdf'
    await command('addVirtualWorkspace', { file, markdown: '', pixel: '', base64: Buffer.from(pdfFixture([['Provider']])).toString('base64') })
    await command('open', { file, editor: 'folio.pdf', virtual: 1 })
    await expect(folio(page).getByRole('alert')).toContainText('requires a trusted workspace and a local file')
  })
})

test.describe('PDF Restricted Mode', () => {
  test.use({ restricted: true })

  test('keeps Folio PDF unavailable in an untrusted workspace', async ({ desktop }) => {
    const { page, command, workspace } = desktop
    await writeFile(join(workspace, 'restricted.pdf'), pdfFixture([['Restricted']]))
    expect(await command('workspaceTrust')).toBe(false)
    await command('open', { file: 'restricted.pdf', editor: 'default' })
    await command('editorChoices')
    const choices = page.locator('.quick-input-widget:visible')
    await expect(choices).toBeVisible()
    await expect(choices.getByText('Folio PDF Viewer', { exact: true })).toHaveCount(0)
    expect(await command('folioActive')).toBe(false)
  })
})
