import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { activeContentPdf, malformedPdf, passwordPdf, pdfFixture, searchablePages } from './fixtures/pdfFixtures'

const editor = (page: Page) => page.getByRole('textbox', { name: /Visual document editor/ })
const viewer = (page: Page) => page.getByRole('region', { name: /\.pdf$/i }).first()
const pageRegion = (page: Page, number: number, total: number) => page.getByRole('region', { name: `Page ${number} of ${total}` })

async function openPdfFile(page: Page, name: string, bytes: Uint8Array) {
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) })
}

async function action(page: Page, menu: string, label: string | RegExp) {
  await page.getByRole('button', { name: menu, exact: true }).click()
  await page.getByRole('menuitem', { name: label, exact: typeof label === 'string' }).click()
}

/** Counts dark pixels on a rendered page canvas. */
function inkOnPage(page: Page, number: number) {
  return page.locator(`.pdf-page[data-page-number="${number}"] canvas`).evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let dark = 0
    for (let index = 0; index < data.length; index += 16) if (data[index] < 128) dark++
    return dark
  })
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await expect(editor(page)).toContainText('Welcome to Folio')
})

test('PDF opens read-only with navigation, zoom, fit, search, copy, original download and reload', async ({ page }) => {
  const bytes = pdfFixture(searchablePages)
  await openPdfFile(page, 'Report.pdf', bytes)
  await expect(page.getByRole('status').filter({ hasText: 'Opened Report.pdf' })).toBeVisible()
  await expect(pageRegion(page, 1, 3)).toBeVisible()
  await expect(page.locator('.pdf-page[data-page-number="1"] canvas')).toBeAttached()
  await expect.poll(() => inkOnPage(page, 1)).toBeGreaterThan(20)
  await expect(page.locator('.statusbar')).toContainText('Read-only PDF')
  await expect(page.locator('.statusbar')).toContainText('3 pages')
  await expect(page.getByRole('toolbar', { name: 'PDF navigation' }).getByText('of 3')).toBeVisible()
  // Text editing controls are replaced by PDF controls.
  await expect(page.getByRole('button', { name: /^Bold/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('2')
  await page.getByRole('textbox', { name: 'Page number' }).fill('3')
  await page.getByRole('textbox', { name: 'Page number' }).press('Enter')
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('3')
  await page.locator('.pdf-scroll').focus()
  await page.keyboard.press('Home')
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('1')
  await page.keyboard.press('PageDown')
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('2')

  const width = () => page.locator('.pdf-page[data-page-number="1"]').evaluate(element => element.getBoundingClientRect().width)
  const zoom = page.getByRole('combobox', { name: 'Zoom' })
  await zoom.selectOption('1')
  await expect.poll(width).toBeCloseTo(612, -1)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).toHaveValue('1.25')
  await expect.poll(width).toBeCloseTo(765, -1)
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await expect(zoom).toHaveValue('0.75')
  await zoom.selectOption('fit-page')
  const scrollHeight = await page.locator('.pdf-scroll').evaluate(element => element.clientHeight)
  await expect.poll(async () => page.locator('.pdf-page[data-page-number="1"]').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(scrollHeight)
  await zoom.selectOption('fit-width')
  const scrollWidth = await page.locator('.pdf-scroll').evaluate(element => element.clientWidth)
  await expect.poll(width).toBeGreaterThan(scrollWidth - 60)

  await page.keyboard.press('ControlOrMeta+f')
  const find = page.getByRole('searchbox', { name: 'Find in PDF' }).or(page.getByRole('textbox', { name: 'Find in PDF' }))
  await expect(find).toBeFocused()
  await find.fill('NEEDLE')
  const status = page.locator('.pdf-find-status')
  await expect(status).toHaveText('1 of 2')
  await find.press('Enter')
  await expect(status).toHaveText('2 of 2')
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('3')
  await expect.poll(() => page.evaluate(() => (CSS as unknown as { highlights: Map<string, { size: number }> }).highlights.get('folio-pdf-active')?.size ?? 0)).toBeGreaterThan(0)
  await find.press('Shift+Enter')
  await expect(status).toHaveText('1 of 2')
  await find.fill('absent words')
  await expect(status).toHaveText('No matches in the embedded text')
  await find.press('Escape')

  await page.getByRole('button', { name: 'Copy page text' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Search target appears here: needle')
  // Native selection on the text layer copies the embedded text.
  await page.locator('.pdf-page[data-page-number="1"] .textLayer span').first().evaluate(span => {
    const range = document.createRange()
    range.selectNodeContents(span)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
  })
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Folio PDF fixture page one')

  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download original' }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('Report.pdf')
  expect(new Uint8Array(await readFile(await download.path()))).toEqual(bytes)

  await page.reload()
  await expect(pageRegion(page, 1, 3)).toBeVisible()
  await expect.poll(() => inkOnPage(page, 1)).toBeGreaterThan(20)
  // Read-only PDFs keep the immutable original and offer no editable history.
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Version History' })).toBeDisabled()
  await page.keyboard.press('Escape')
})

test('dropped image-only PDF renders and explains that search is unavailable', async ({ page }) => {
  const bytes = pdfFixture([null, null])
  const transfer = await page.evaluateHandle(data => {
    const file = new File([new Uint8Array(data)], 'Scan.pdf', { type: 'application/pdf' })
    const value = new DataTransfer()
    value.items.add(file)
    return value
  }, Array.from(bytes))
  await page.locator('main.canvas').dispatchEvent('dragover', { dataTransfer: transfer })
  await page.locator('main.canvas').dispatchEvent('drop', { dataTransfer: transfer })
  await expect(pageRegion(page, 1, 2)).toBeVisible()
  await expect.poll(() => inkOnPage(page, 1)).toBeGreaterThan(200)
  await expect(page.locator('.pdf-page[data-page-number="1"] .pdf-textless')).toHaveText('No searchable text on this page')
  await page.getByRole('button', { name: 'Find in PDF' }).click()
  await page.getByRole('textbox', { name: 'Find in PDF' }).fill('anything')
  await expect(page.locator('.pdf-find-status')).toHaveText(/has no embedded text.*cannot find words shown only in page images/)
})

test('invalid, encrypted and oversized PDFs leave the current document intact', async ({ page }) => {
  await openPdfFile(page, 'Broken.pdf', malformedPdf())
  await expect(page.getByRole('status').filter({ hasText: /not a readable PDF/ })).toBeVisible()
  await openPdfFile(page, 'Locked.pdf', passwordPdf())
  await expect(page.getByRole('status').filter({ hasText: /password-protected/ })).toBeVisible()
  await openPdfFile(page, 'Renamed.pdf', new TextEncoder().encode('PK\u0003\u0004 not a pdf'))
  await expect(page.getByRole('status').filter({ hasText: /not a readable PDF|PDF header/ })).toBeVisible()
  await expect(editor(page)).toContainText('Welcome to Folio')
  await page.getByRole('button', { name: 'Open document library' }).click()
  await expect(page.getByRole('dialog').getByText(/Broken|Locked|Renamed/)).toHaveCount(0)
})

test('a PDF import that cannot be stored opens nothing and can be retried', async ({ page }) => {
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (this: IDBObjectStore, value, key) {
      if (this.name === 'document-originals' && value.reference.filename === 'Quota.pdf' && !Reflect.get(window, 'allowPdfOriginal')) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      return add.call(this, value, key)
    }
  })
  await openPdfFile(page, 'Quota.pdf', pdfFixture([['Stored later']]))
  await expect(page.getByText(/could not save the imported draft/i)).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Quota.pdf' })).toHaveCount(0)
  await expect(editor(page)).toContainText('Welcome to Folio')
  await page.evaluate(() => Reflect.set(window, 'allowPdfOriginal', true))
  await openPdfFile(page, 'Quota.pdf', pdfFixture([['Stored later']]))
  await expect(pageRegion(page, 1, 1)).toBeVisible()
  await page.reload()
  await expect(pageRegion(page, 1, 1)).toBeVisible()
})

test('PDF active content stays inert and the library can delete and reopen documents', async ({ page }) => {
  let popups = 0
  page.on('popup', () => { popups++ })
  page.on('dialog', dialog => { popups++; void dialog.dismiss() })
  await openPdfFile(page, 'Active.pdf', activeContentPdf())
  await expect(pageRegion(page, 1, 1)).toBeVisible()
  await expect(page.getByRole('note')).toContainText('does not run them')
  await expect(page.getByRole('note')).toContainText('cannot be filled')
  await expect(page.locator('.pdf-page a, .pdf-page input, .annotationLayer')).toHaveCount(0)
  const box = await page.locator('.pdf-page[data-page-number="1"]').boundingBox()
  await page.mouse.click(box!.x + box!.width * 0.3, box!.y + box!.height * 0.17)
  await page.waitForTimeout(300)
  expect(popups).toBe(0)
  expect(await page.evaluate(() => (globalThis as { folioPdfScriptRan?: boolean }).folioPdfScriptRan)).toBeUndefined()

  await action(page, 'File', 'Document library')
  const library = page.getByRole('dialog', { name: 'Document library' })
  await expect(library.getByText('Active.pdf')).toBeVisible()
  await expect(library.getByText(/^PDF ·/)).toBeVisible()
  await library.getByRole('button', { name: 'Close dialog' }).click()
  await openPdfFile(page, 'Second.pdf', pdfFixture([['Second document']]))
  await expect(page.locator('.toast')).toContainText('Opened Second.pdf')
  await expect(pageRegion(page, 1, 1)).toBeVisible()
  await page.getByRole('tab', { name: /Active\.pdf/ }).click()
  await expect(page.getByRole('note')).toContainText('does not run them')
  await expect(viewer(page)).toBeVisible()

  await action(page, 'File', 'Document library')
  await library.getByRole('button', { name: 'Delete Second.pdf' }).click()
  await library.getByRole('button', { name: 'Move to Trash' }).click()
  await expect(library.getByText('Second.pdf')).toHaveCount(0)
  await library.getByRole('button', { name: 'Trash', exact: true }).click()
  await library.getByRole('button', { name: 'Restore Second.pdf' }).click()
  await library.getByRole('button', { name: 'All documents', exact: true }).click()
  await library.getByRole('button', { name: 'Second.pdf', exact: true }).click()
  await expect(pageRegion(page, 1, 1)).toBeVisible()
  await expect.poll(() => inkOnPage(page, 1)).toBeGreaterThan(20)
})
