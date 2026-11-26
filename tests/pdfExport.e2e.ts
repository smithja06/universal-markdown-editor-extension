import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { writeDocx } from '../src/document/formats/docx/write'
import { openPdf } from '../src/document/formats/pdf/engine'
import { nodePdfRuntime } from './fixtures/pdfRuntime'

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=='

async function open(page: Page, name: string, data: string | Uint8Array, mimeType = 'text/plain') {
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType, buffer: Buffer.from(data) })
  await expect(page.locator('.toast')).toContainText('Opened ' + name)
}

async function exportDialog(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export PDF…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export PDF' })
  await expect(dialog.getByText(/Preview validated · \d+ pages?/)).toBeVisible({ timeout: 30_000 })
  return dialog
}

async function downloadPdf(page: Page, dialog: ReturnType<Page['getByRole']>) {
  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download PDF' }).click()
  const download = await pending
  const bytes = new Uint8Array(await readFile(await download.path()))
  const handle = await openPdf(bytes, await nodePdfRuntime())
  try {
    const pages = await Promise.all(Array.from({ length: handle.pageCount }, (_, index) => handle.text(index).then(text => text.text)))
    const size = (await handle.page(0)).getViewport({ scale: 1 })
    return { name: download.suggestedFilename(), text: pages.join('\n'), pages: handle.pageCount, width: size.width, height: size.height, bytes }
  } finally { await handle.destroy() }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: /Visual document editor/ })).toContainText('Welcome to Folio')
})

test('Markdown exports a validated PDF with page options, diagram, table, image and disclosures', async ({ page }) => {
  const source = ['# Quarterly report', '', 'Body with **bold** and a [link](https://example.com/q).', '', '| Region | Total |', '| --- | ---: |', '| North | 12 |', '| South | 9 |', '',
    '```mermaid', 'graph TD; Start-->Finish', '```', '', `![Pixel](${pixel})`, '', '![Remote](https://example.invalid/remote.png)', '', 'Inline $E=mc^2$ math.', ''].join('\n')
  await open(page, 'Report.md', source, 'text/markdown')
  const dialog = await exportDialog(page)
  await expect(dialog.getByText('Fidelity review')).toBeVisible()
  await expect(dialog.locator('.export-diagnostics')).toContainText('printed as TeX source text')
  await expect(dialog.locator('.export-diagnostics')).toContainText('Folio does not download remote images')
  await expect(dialog.locator('.export-diagnostics')).toContainText('diagram printed as raster images')
  await expect(dialog.getByRole('region', { name: 'PDF preview' })).toBeVisible()
  await expect(dialog.locator('.pdf-page canvas').first()).toBeAttached()
  await dialog.getByRole('combobox', { name: 'Page size' }).selectOption('a4')
  await dialog.getByRole('combobox', { name: 'Orientation' }).selectOption('landscape')
  await expect(dialog.getByText(/Preview validated/)).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue('Report.pdf')
  const pdf = await downloadPdf(page, dialog)
  expect(pdf.name).toBe('Report.pdf')
  expect(pdf.width).toBeCloseTo(841.89, 0)
  expect(pdf.height).toBeCloseTo(595.28, 0)
  for (const expected of ['Quarterly report', 'bold', 'Region', 'North', '12', 'E=mc^2', 'Image unavailable: Remote']) expect(pdf.text).toContain(expected)
  expect(new TextDecoder('latin1').decode(pdf.bytes)).toMatch(/\/Subtype\s*\/Image/)
  await expect(page.locator('.toast')).toContainText('Download requested for Report.pdf')
  // The source draft is unchanged by export.
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source editor' })).toContainText('graph TD; Start-->Finish')
})

test('TXT exports literal Unicode text with fixed wrapping and cancelling leaves no download', async ({ page }) => {
  const text = '# not a heading\n\n  indented line\n**literal** → ✓ café Ωmega\n' + 'wrap'.repeat(60) + '\n'
  await open(page, 'notes.txt', text)
  let downloads = 0
  page.on('download', () => { downloads++ })
  let dialog = await exportDialog(page)
  await expect(dialog.locator('.export-diagnostics')).toContainText('monospaced font')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  expect(downloads).toBe(0)
  dialog = await exportDialog(page)
  await dialog.getByRole('textbox', { name: 'File name' }).fill('bad/name.pdf')
  await expect(dialog.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'File name' }).fill('notes export.pdf')
  const pdf = await downloadPdf(page, dialog)
  expect(pdf.name).toBe('notes export.pdf')
  expect(pdf.width).toBeCloseTo(612, 0)
  for (const expected of ['# not a heading', '**literal** → ✓ café Ωmega', 'indented line']) expect(pdf.text).toContain(expected)
  expect(pdf.text.replace(/\s+/g, '')).toContain('wrap'.repeat(60))
})

test('DOCX exports its structured content as PDF and keeps the original package', async ({ page }) => {
  const original = writeDocx({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Project brief' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Bold start', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and café 🙂' }] },
    { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Planned' }] }] },
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open' }] }] },
    ] }] },
  ] })
  await open(page, 'Brief.docx', original, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  const dialog = await exportDialog(page)
  await expect(dialog.locator('.export-diagnostics')).toContainText('Word pagination')
  await expect(dialog.locator('.export-diagnostics')).toContainText('🙂')
  const pdf = await downloadPdf(page, dialog)
  expect(pdf.name).toBe('Brief.pdf')
  for (const expected of ['Project brief', 'Bold start', 'café', 'Planned', 'Open']) expect(pdf.text).toContain(expected)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Download original' }).click()
  expect(new Uint8Array(await readFile(await (await pending).path()))).toEqual(original)
})
