import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const textEditor = (page: Page) => page.getByRole('textbox', { name: 'Plain text editor' })
const draftSaved = (page: Page) => page.getByTitle('Draft saved locally')

async function openText(page: Page, name: string, buffer: Buffer) {
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/octet-stream', buffer })
}

async function action(page: Page, menu: string, label: string | RegExp) {
  await page.getByRole('button', { name: menu, exact: true }).click()
  await page.getByRole('menuitem', { name: label, exact: typeof label === 'string' }).click()
}

async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download')
  await action(page, 'Export', label)
  const file = await pending
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Visual document editor' })).toContainText('Welcome to Folio')
})

test('TXT stays literal through find, undo, redo, and reload and exports exact bytes', async ({ page }) => {
  const original = Buffer.from('\ufeff# Heading\r\n**bold** café 🙂  \r\n\r\n')
  await openText(page, 'Unicode.TXT', original)
  await expect(textEditor(page)).toBeVisible()
  await expect(textEditor(page).locator('.cm-line').first()).toHaveText('# Heading')
  await expect(page.getByRole('button', { name: 'Split Editor', exact: true })).toHaveCount(0)
  expect(await download(page, 'Download original')).toEqual({ name: 'Unicode.TXT', bytes: original })
  expect((await download(page, 'Export TXT copy…')).bytes).toEqual(original)

  await page.keyboard.press('ControlOrMeta+h')
  await page.getByRole('textbox', { name: 'Find text' }).fill('**bold**')
  await page.getByRole('textbox', { name: 'Replace with' }).fill('`plain`')
  await page.getByRole('button', { name: 'Replace all' }).click()
  await expect(textEditor(page)).toContainText('`plain`')
  await page.getByRole('button', { name: 'Close find' }).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(textEditor(page)).toContainText('**bold**')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(textEditor(page)).toContainText('`plain`')
  await expect(draftSaved(page)).toBeVisible()
  await page.reload()
  await expect(textEditor(page)).toContainText('`plain`')
  expect((await download(page, 'Export TXT copy…')).bytes).toEqual(Buffer.from('\ufeff# Heading\r\n`plain` café 🙂  \r\n\r\n'))
  expect((await download(page, 'Download original')).bytes).toEqual(original)
})

test('editing mixed newlines requires a choice and a restored version exports the untouched bytes', async ({ page }) => {
  const original = Buffer.from('alpha\r\nbeta\rgamma\n')
  await openText(page, 'mixed.txt', original)
  expect((await download(page, 'Export TXT copy…')).bytes).toEqual(original)
  await action(page, 'File', 'Version History')
  const history = page.getByRole('dialog', { name: 'Version History' })
  await history.getByRole('button', { name: 'Create version' }).click()
  await expect(history.getByRole('region', { name: 'Plain text version preview' })).toContainText('alpha')
  await history.getByRole('button', { name: 'Close dialog' }).click()
  await textEditor(page).press('ControlOrMeta+Home')
  await page.keyboard.insertText('edited ')
  await action(page, 'Export', 'Export TXT copy…')
  const review = page.getByRole('dialog', { name: 'Export TXT copy' })
  await expect(review.getByText(/mixed line endings/i)).toBeVisible()
  await expect(review.getByRole('button', { name: 'Download copy' })).toBeDisabled()
  await review.getByLabel('Line endings').selectOption({ label: 'CR' })
  const pending = page.waitForEvent('download')
  await review.getByRole('button', { name: 'Download copy' }).click()
  expect(await readFile(await (await pending).path())).toEqual(Buffer.from('edited alpha\rbeta\rgamma\r'))
  await action(page, 'File', 'Version History')
  await history.getByRole('button', { name: /Preview version.*Manual/ }).click()
  await history.getByRole('button', { name: 'Restore version' }).click()
  await history.getByRole('button', { name: 'Confirm restore' }).click()
  await expect(textEditor(page)).not.toContainText('edited')
  await page.reload()
  expect((await download(page, 'Export TXT copy…')).bytes).toEqual(original)
})

test('failed imports leave the active tab intact and a failed draft stays editable and downloadable', async ({ page }) => {
  await openText(page, 'bad.txt', Buffer.from([0xff, 0xfe, 0x41, 0]))
  await expect(page.getByText(/valid UTF-8/i)).toBeVisible()
  await expect(page.getByRole('tab', { name: 'bad.txt' })).toHaveCount(0)
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (this: IDBObjectStore, value, key) {
      if (this.name === 'document-originals' && value.reference.filename === 'quota.txt') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      if (this.name === 'document-drafts' && value.title === 'quota-markdown') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return add.call(this, value, key)
    }
  })
  await openText(page, 'quota.txt', Buffer.from('this import must roll back\n'))
  await expect(page.getByText(/could not save the imported draft/i)).toBeVisible()
  await expect(page.getByRole('tab', { name: 'quota.txt' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Dismiss notification' }).click()
  await openText(page, 'quota-markdown.md', Buffer.from('# this import must roll back\n'))
  await expect(page.getByText(/could not save the imported draft/i)).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Getting started' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'quota-markdown' })).toHaveCount(0)
  await openText(page, 'retry.txt', Buffer.from('content\n'))
  await expect(textEditor(page)).toBeVisible()
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value, key) {
      if (this.name === 'document-drafts' && value.source.startsWith('pending') && !Reflect.get(window, 'allowDraftWrite')) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return put.call(this, value, key)
    }
  })
  await textEditor(page).press('ControlOrMeta+Home')
  await page.keyboard.insertText('pending ')
  await expect(page.getByTitle('Draft could not be saved locally')).toBeVisible()
  expect((await download(page, 'Export TXT copy…')).bytes).toEqual(Buffer.from('pending content\n'))
  await page.evaluate(() => Reflect.set(window, 'allowDraftWrite', true))
  await action(page, 'File', /^Save draft\b/)
  await expect(draftSaved(page)).toBeVisible()
  await page.reload()
  await expect(textEditor(page)).toContainText('pending content')
})

test('drop, tab switching, and reopen keep TXT literal and preserve the Markdown view', async ({ page }) => {
  await page.getByRole('button', { name: 'Split Editor', exact: true }).click()
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(['# a literal heading\n'], 'dropped.txt', { type: 'text/plain' }))
    return data
  })
  await page.getByRole('tabpanel', { name: 'Getting started' }).dispatchEvent('drop', { dataTransfer: transfer })
  await expect(textEditor(page)).toContainText('# a literal heading')
  await expect(page.getByRole('tab', { name: 'dropped.txt' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Getting started' }).click()
  await expect(page.getByRole('button', { name: 'Split Editor', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('textbox', { name: 'Markdown source editor' })).toBeVisible()
  await page.getByRole('button', { name: 'Close dropped.txt' }).click()
  await page.getByRole('button', { name: 'Open document library' }).click()
  const library = page.getByRole('dialog', { name: 'Document library' })
  await expect(library.getByRole('listitem').filter({ hasText: 'dropped.txt' })).toContainText('TXT')
  await library.getByRole('button', { name: 'dropped.txt', exact: true }).click()
  await expect(textEditor(page)).toContainText('# a literal heading')
  await action(page, 'File', 'New text document')
  await textEditor(page).press('ControlOrMeta+Home')
  await page.keyboard.insertText('new\n')
  expect((await download(page, 'Export TXT copy…')).bytes).toEqual(Buffer.from('new\n'))
})

test('an edit during export preparation invalidates its pending download', async ({ page }) => {
  const bytes = Buffer.from('one\r\ntwo\rthree\n')
  await openText(page, 'changing.txt', bytes)
  await expect(textEditor(page)).toBeVisible()
  await page.evaluate(size => {
    const arrayBuffer = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function (this: Blob) {
      if (this.size !== size) return arrayBuffer.call(this)
      const waiting = new Promise<void>(resolve => Reflect.set(window, 'releaseExportBytes', resolve))
      return waiting.then(() => arrayBuffer.call(this))
    }
  }, bytes.length)
  const downloads: string[] = []
  page.on('download', file => downloads.push(file.suggestedFilename()))
  await action(page, 'Export', 'Export TXT copy…')
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseExportBytes'))).toBe('function')
  await textEditor(page).press('ControlOrMeta+Home')
  await page.keyboard.insertText('changed ')
  await page.evaluate(() => Reflect.get(window, 'releaseExportBytes')())
  await expect(page.getByText(/document changed\. Start a new export/i)).toBeVisible()
  expect(downloads).toEqual([])
})

test('cancelling a confirmed mixed-newline export stops delivery while bytes are pending', async ({ page }) => {
  const bytes = Buffer.from('one\r\ntwo\rthree\n')
  await openText(page, 'cancel-export.txt', bytes)
  await textEditor(page).press('ControlOrMeta+Home')
  await page.keyboard.insertText('changed ')
  await action(page, 'Export', 'Export TXT copy…')
  const review = page.getByRole('dialog', { name: 'Export TXT copy' })
  await review.getByLabel('Line endings').selectOption({ label: 'LF (Unix)' })
  await page.evaluate(size => {
    const arrayBuffer = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function (this: Blob) {
      if (this.size !== size) return arrayBuffer.call(this)
      return new Promise<ArrayBuffer>(resolve => Reflect.set(window, 'releaseExportBytes', async () => resolve(await arrayBuffer.call(this))))
    }
  }, bytes.length)
  const downloads: string[] = []
  page.on('download', file => downloads.push(file.suggestedFilename()))
  await review.getByRole('button', { name: 'Download copy' }).click()
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseExportBytes'))).toBe('function')
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(async () => {
    const release = Reflect.get(window, 'releaseExportBytes')
    Reflect.deleteProperty(window, 'releaseExportBytes')
    await release()
  })
  await expect(review).toHaveCount(0)
  // A fresh export completes after the cancelled result settles, so only its download can arrive.
  await action(page, 'Export', 'Export TXT copy…')
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseExportBytes'))).toBe('function')
  await page.evaluate(() => Reflect.get(window, 'releaseExportBytes')())
  await expect(review).toBeVisible()
  expect(downloads).toEqual([])
})
