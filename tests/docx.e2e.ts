import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships'
const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const editor = (page: Page) => page.getByRole('textbox', { name: /Visual document editor|DOCX editor/ })
const saved = (page: Page) => page.getByTitle('Draft saved locally')

function fixture({ landscape = false } = {}) {
  const part = landscape ? '<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr>' : ''
  const paragraph = (content: string) => '<w:p><w:r><w:t>' + content + '</w:t></w:r></w:p>'
  const row = (cells: string[]) => '<w:tr>' + cells.map(cell => '<w:tc>' + paragraph(cell) + '</w:tc>').join('') + '</w:tr>'
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8(`<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${office}/hyperlink" Target="https://example.com/source" TargetMode="External"/></Relationships>`),
    'word/document.xml': strToU8(`<w:document xmlns:w="${w}" xmlns:r="${office}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Project brief</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Initial</w:t></w:r><w:r><w:t xml:space="preserve"> café 🙂 </w:t><w:br/><w:t>second line</w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>Source</w:t></w:r></w:hyperlink></w:p>
      <w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>${row(['Planned', 'Open'])}${row(['Released', 'Closed'])}</w:tbl><w:p/>${part}</w:body></w:document>`),
  }))
}

async function openDocx(page: Page, name: string, buffer: Buffer, mimeType = 'application/octet-stream') {
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType, buffer })
}

async function action(page: Page, menu: string, label: string | RegExp) {
  await page.getByRole('button', { name: menu, exact: true }).click()
  await page.getByRole('menuitem', { name: label, exact: typeof label === 'string' }).click()
}

async function download(page: Page, label: string | RegExp) {
  const pending = page.waitForEvent('download')
  await action(page, 'Export', label)
  if (label instanceof RegExp) await page.getByRole('dialog', { name: 'Export DOCX copy' }).getByRole('button', { name: 'Download copy' }).click()
  const file = await pending
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(editor(page)).toContainText('Welcome to Folio')
})

test('DOCX restricts editing controls and recovers formatted edits and a version from the library', async ({ page }) => {
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  const original = fixture()
  await openDocx(page, 'Brief.DOCX', original)
  await expect(editor(page).getByRole('heading', { name: 'Project brief', level: 1 })).toBeVisible()
  await expect(editor(page).locator('strong')).toHaveText('Initial')
  await expect(editor(page).locator('br').first()).toBeAttached()
  await expect(editor(page).getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://example.com/source')
  await expect(page.getByRole('button', { name: 'Split Editor', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Front matter' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Document outline' }).getByRole('button', { name: /Project brief/ })).toBeVisible()
  expect(await download(page, 'Download original')).toEqual({ name: 'Brief.DOCX', bytes: original })

  await action(page, 'File', 'Version History')
  const history = page.getByRole('dialog', { name: 'Version History' })
  await history.getByRole('button', { name: 'Create version' }).click()
  await expect(history.getByRole('region', { name: 'DOCX version preview' }).getByRole('heading', { name: 'Project brief' })).toBeVisible()
  await expect(history.getByRole('button', { name: 'Markdown', exact: true })).toHaveCount(0)
  await history.getByRole('button', { name: 'Close dialog' }).click()

  await editor(page).press('ControlOrMeta+Home')
  await editor(page).press('Shift+End')
  await page.keyboard.press('ControlOrMeta+i')
  await page.getByRole('button', { name: /^Underline/ }).click()
  await expect(editor(page).locator('h1')).toHaveText('Project brief')
  await expect(editor(page).locator('h1 em u, h1 u em')).toHaveText('Project brief')
  await editor(page).press('ControlOrMeta+z')
  await expect(editor(page).locator('h1 u')).toHaveCount(0)
  await editor(page).press('ControlOrMeta+Shift+z')
  await expect(editor(page).locator('h1 u')).toHaveText('Project brief')

  await page.keyboard.press('ControlOrMeta+h')
  await page.getByRole('textbox', { name: 'Find text' }).fill('second line')
  await page.getByRole('textbox', { name: 'Replace with' }).fill('updated line')
  await expect(page.getByLabel('Search scope')).toHaveCount(0)
  await page.getByRole('button', { name: 'Replace all' }).click()
  await expect(editor(page)).toContainText('updated line')
  await page.getByRole('button', { name: 'Close find' }).click()
  await expect(saved(page)).toBeVisible()
  await page.reload()
  await expect(editor(page)).toContainText('updated line')
  await expect(editor(page).locator('h1 u')).toHaveText('Project brief')

  await action(page, 'File', 'Version History')
  await history.getByRole('button', { name: /Preview version.*Manual/ }).click()
  await history.getByRole('button', { name: 'Restore version' }).click()
  await history.getByRole('button', { name: 'Confirm restore' }).click()
  await expect(editor(page)).toContainText('second line')
  await expect(editor(page).locator('h1 u')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close Brief.DOCX' }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown source editor' })).toBeVisible()
  await page.getByRole('button', { name: 'Open document library' }).click()
  const library = page.getByRole('dialog', { name: 'Document library' })
  await expect(library.getByRole('listitem').filter({ hasText: 'Brief.DOCX' })).toContainText('DOCX')
  await library.getByRole('button', { name: 'Brief.DOCX', exact: true }).click()
  await expect(editor(page)).toContainText('second line')
  expect(await download(page, 'Download original')).toEqual({ name: 'Brief.DOCX', bytes: original })
})

test('DOCX controls edit links and rectangular tables and exported content reimports', async ({ page }) => {
  await openDocx(page, 'table.docx', fixture(), 'text/plain')
  const table = editor(page).getByRole('table')
  await expect(table.getByRole('row')).toHaveCount(2)
  await table.getByRole('cell', { name: 'Planned' }).click()
  await action(page, 'Table controls', 'Add row below')
  await action(page, 'Table controls', 'Add column after')
  await expect(table.getByRole('row')).toHaveCount(3)
  await expect(table.getByRole('row').first().getByRole('cell')).toHaveCount(3)
  await table.getByRole('row').nth(1).getByRole('cell').nth(1).click()
  await page.keyboard.insertText('Added')
  await table.getByRole('cell', { name: 'Released' }).click()
  await action(page, 'Table controls', 'Delete row')
  await table.getByRole('cell', { name: 'Open' }).click()
  await action(page, 'Table controls', 'Delete column')
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table.getByRole('cell', { name: 'Added' })).toBeVisible()
  await expect(table.getByRole('cell', { name: 'Open' })).toHaveCount(0)

  await editor(page).getByRole('link', { name: 'Source' }).click()
  await page.keyboard.press('ControlOrMeta+k')
  const link = page.getByRole('dialog', { name: 'Insert link' })
  await link.getByLabel('Destination').fill('javascript:alert(1)')
  await link.getByRole('button', { name: 'Apply' }).click()
  await expect(link.getByRole('alert')).toBeVisible()
  await link.getByLabel('Destination').fill('https://example.org/updated')
  await link.getByRole('button', { name: 'Apply' }).click()
  await expect(editor(page).getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://example.org/updated')

  await editor(page).press('ControlOrMeta+End')
  await page.keyboard.insertText('First item')
  await page.getByRole('button', { name: 'Bullet list', exact: true }).click()
  await expect(editor(page).locator('ul li')).toHaveText('First item')
  await page.getByRole('button', { name: 'Numbered list', exact: true }).click()
  await expect(editor(page).locator('ol li')).toHaveText('First item')
  await editor(page).press('Enter')
  await editor(page).press('Enter')
  await page.getByRole('button', { name: /^Paragraph style/ }).click()
  await page.getByRole('menuitem', { name: 'Heading 6' }).click()
  await page.keyboard.insertText('Details')
  await expect(editor(page).getByRole('heading', { name: 'Details', level: 6 })).toBeVisible()
  await editor(page).press('Enter')
  await action(page, 'Insert content', 'Table')
  const insertTable = page.getByRole('dialog', { name: 'Insert table' })
  await insertTable.getByRole('spinbutton', { name: 'Rows' }).fill('1')
  await insertTable.getByRole('spinbutton', { name: 'Columns' }).fill('2')
  await insertTable.getByRole('button', { name: 'Insert', exact: true }).click()
  const added = editor(page).getByRole('table').last()
  await expect(added.getByRole('columnheader')).toHaveCount(2)
  await added.getByRole('columnheader').first().click()
  await action(page, 'Table controls', 'Add column after')
  await expect(added.getByRole('columnheader')).toHaveCount(3)

  const copy = await download(page, /^Export DOCX copy/)
  expect(copy.name).toBe('table copy.docx')
  await openDocx(page, 'reimported.docx', copy.bytes, mime)
  await expect(page.getByRole('tab', { name: 'reimported.docx' })).toHaveAttribute('aria-selected', 'true')
  await expect(table.first().getByRole('row')).toHaveCount(2)
  await expect(table.first().getByRole('cell', { name: 'Added' })).toBeVisible()
  await expect(added.getByRole('columnheader')).toHaveCount(3)
  await expect(editor(page).getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://example.org/updated')
  await expect(editor(page).getByRole('heading', { name: 'Details', level: 6 })).toBeVisible()
  await expect(editor(page).locator('ol li')).toHaveText('First item')
})

test('DOCX export review identifies page layout changes and requires confirmation', async ({ page }) => {
  await openDocx(page, 'landscape.docx', fixture({ landscape: true }))
  await expect(editor(page).getByRole('heading', { name: 'Project brief' })).toBeVisible()
  await page.getByRole('button', { name: 'DOCX import notes' }).click()
  const notes = page.getByRole('dialog', { name: 'DOCX import notes' })
  await expect(notes.getByText(/page layout/i)).toBeVisible()
  await expect(notes.getByText('Approximated', { exact: true })).toBeVisible()
  await notes.getByRole('button', { name: 'Close dialog' }).click()
  await editor(page).press('ControlOrMeta+Home')
  await page.keyboard.insertText('Edited ')
  const downloads: string[] = []
  page.on('download', file => downloads.push(file.suggestedFilename()))
  await action(page, 'Export', /^Export DOCX copy/)
  const review = page.getByRole('dialog', { name: 'Export DOCX copy' })
  await expect(review.getByText(/page layout|page settings|section properties/i).first()).toBeVisible()
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(review).toHaveCount(0)
  expect(downloads).toEqual([])
  await action(page, 'Export', /^Export DOCX copy/)
  const pending = page.waitForEvent('download')
  await review.getByRole('button', { name: 'Download copy' }).click()
  await openDocx(page, 'reviewed.docx', await readFile(await (await pending).path()), mime)
  await expect(editor(page).getByRole('heading', { name: 'Edited Project brief' })).toBeVisible()
})

test('invalid and failed DOCX imports preserve the active tab and its draft', async ({ page }) => {
  await openDocx(page, 'broken.docx', Buffer.from('broken ZIP'))
  await expect(page.getByRole('tab', { name: 'broken.docx' })).toHaveCount(0)
  await expect(editor(page)).toContainText('Welcome to Folio')
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (this: IDBObjectStore, value, key) {
      if (this.name === 'document-originals' && value.reference.filename === 'quota.docx') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return add.call(this, value, key)
    }
  })
  await openDocx(page, 'quota.docx', fixture())
  await expect(page.getByText(/could not save the imported draft/i)).toBeVisible()
  await expect(page.getByRole('tab', { name: 'quota.docx' })).toHaveCount(0)
  await expect(editor(page)).toContainText('Welcome to Folio')

  await openDocx(page, 'retry.docx', fixture())
  await expect(editor(page)).toContainText('Project brief')
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value, key) {
      if (this.name === 'document-drafts' && value.format === 'docx' &&
        value.source.startsWith('Pending ') && !Reflect.get(window, 'allowDocxDraftWrite')) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return put.call(this, value, key)
    }
  })
  await editor(page).press('ControlOrMeta+Home')
  await page.keyboard.insertText('Pending ')
  await expect(page.getByTitle('Draft could not be saved locally')).toBeVisible()
  expect((await download(page, /^Export DOCX copy/)).name).toBe('retry copy.docx')
  await page.evaluate(() => Reflect.set(window, 'allowDocxDraftWrite', true))
  await action(page, 'File', /^Save draft\b/)
  await expect(saved(page)).toBeVisible()
  await page.reload()
  await expect(editor(page)).toContainText('Pending Project brief')
})

test('switching documents cancels a pending DOCX import without leaving a library entry', async ({ page }) => {
  await page.evaluate(() => {
    const arrayBuffer = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function (this: Blob) {
      if (!(this instanceof File) || this.name !== 'cancelled.docx') return arrayBuffer.call(this)
      return new Promise<ArrayBuffer>(resolve => {
        Reflect.set(window, 'releaseDocxImport', async () => resolve(await arrayBuffer.call(this)))
      })
    }
  })
  await openDocx(page, 'cancelled.docx', fixture())
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseDocxImport'))).toBe('function')
  await page.getByRole('button', { name: 'New document tab' }).click()
  await page.evaluate(async () => { await Reflect.get(window, 'releaseDocxImport')() })
  await expect(page.getByRole('tab', { name: 'Untitled document' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Open document library' }).click()
  await expect(page.getByRole('dialog', { name: 'Document library' }).getByText('cancelled.docx')).toHaveCount(0)
})

test('editing the document invalidates an open DOCX export review', async ({ page }) => {
  await openDocx(page, 'stale.docx', fixture())
  await expect(editor(page)).toContainText('Project brief')
  await editor(page).press('ControlOrMeta+Home')
  const downloads: string[] = []
  page.on('download', file => downloads.push(file.suggestedFilename()))
  await action(page, 'Export', /^Export DOCX copy/)
  const review = page.getByRole('dialog', { name: 'Export DOCX copy' })
  await expect(review.getByRole('button', { name: 'Download copy' })).toBeVisible()
  await editor(page).evaluate(element => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'Changed ')
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })
  await expect(editor(page)).toContainText('Changed Project brief')
  await review.getByRole('button', { name: 'Download copy' }).click()
  await expect(page.getByText(/document changed\. Start a new export/i)).toBeVisible()
  expect(downloads).toEqual([])
})

test('cancelling a confirmed DOCX export stops the write worker and preserves the draft', async ({ page }) => {
  await openDocx(page, 'cancel-export.docx', fixture())
  await expect(editor(page)).toContainText('Project brief')
  await editor(page).press('ControlOrMeta+Home')
  await page.keyboard.insertText('Saved ')
  await expect(saved(page)).toBeVisible()
  await page.evaluate(() => {
    const postMessage = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (message, transfer) {
      if (message.operation !== 'write' || Reflect.get(window, 'releaseDocxExport')) {
        Reflect.apply(postMessage, this, [message, transfer])
        return
      }
      Reflect.set(window, 'releaseDocxExport', () => Reflect.apply(postMessage, this, [message, transfer]))
    }
    const terminate = Worker.prototype.terminate
    Worker.prototype.terminate = function () {
      if (Reflect.get(window, 'releaseDocxExport')) Reflect.set(window, 'docxExportTerminated', true)
      terminate.call(this)
    }
  })
  const downloads: string[] = []
  page.on('download', file => downloads.push(file.suggestedFilename()))
  await action(page, 'Export', /^Export DOCX copy/)
  const review = page.getByRole('dialog', { name: 'Export DOCX copy' })
  await review.getByRole('button', { name: 'Download copy' }).click()
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseDocxExport'))).toBe('function')
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'docxExportTerminated'))).toBe(true)
  await expect(review).toHaveCount(0)
  await page.evaluate(() => Reflect.get(window, 'releaseDocxExport')())
  const copy = await download(page, /^Export DOCX copy/)
  expect(downloads).toEqual([copy.name])
  await page.reload()
  await expect(editor(page)).toContainText('Saved Project brief')
})

test('competing Folio tabs leave the stored DOCX and the losing tab’s edits recoverable', async ({ page, context }) => {
  await openDocx(page, 'competing.docx', fixture())
  await expect(editor(page)).toContainText('Project brief')
  const competing = await context.newPage()
  await competing.goto('/')
  await expect(editor(competing)).toContainText('Project brief')

  await editor(page).press('ControlOrMeta+Home')
  await page.keyboard.insertText('First edit ')
  await expect(saved(page)).toBeVisible()
  await editor(competing).press('ControlOrMeta+Home')
  await competing.keyboard.insertText('Second edit ')
  await expect(competing.getByTitle('Draft could not be saved locally')).toBeVisible()
  await expect(competing.getByText(/changed in another Folio tab/i)).toBeVisible()
  await expect(editor(competing)).toContainText('Second edit Project brief')
  expect((await download(competing, /^Export DOCX copy/)).name).toMatch(/\.docx$/)

  await competing.reload()
  await expect(editor(competing)).toContainText('First edit Project brief')
  await expect(editor(competing)).not.toContainText('Second edit')
})
