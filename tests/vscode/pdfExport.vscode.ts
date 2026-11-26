import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { writeDocx } from '../../src/document/formats/docx/write'
import { openPdf } from '../../src/document/formats/pdf/engine'
import { nodePdfRuntime } from '../fixtures/pdfRuntime'
import { test } from './desktop'

test.use({ simpleFileDialog: true })

function folio(page: Page) {
  return page.locator('iframe.webview:visible').first().contentFrame().locator('iframe#active-frame').contentFrame()
}

async function exportDialog(page: Page) {
  const frame = folio(page)
  await frame.getByRole('button', { name: 'Export', exact: true }).click()
  await frame.getByRole('menuitem', { name: 'Export PDF…' }).click()
  const dialog = frame.getByRole('dialog', { name: 'Export PDF' })
  await expect(dialog.getByText(/Preview validated · \d+ pages?/)).toBeVisible({ timeout: 30_000 })
  return dialog
}

async function saveTo(page: Page, dialog: Awaited<ReturnType<typeof exportDialog>>, path: string) {
  await dialog.getByRole('button', { name: 'Save PDF copy…' }).click()
  const input = page.locator('.quick-input-widget input:visible')
  await expect(input).toBeVisible()
  await input.fill(path)
  await input.press('Enter')
  await expect(input).toBeHidden()
}

async function pdfText(path: string) {
  const handle = await openPdf(new Uint8Array(await readFile(path)), await nodePdfRuntime())
  try { return (await Promise.all(Array.from({ length: handle.pageCount }, (_, index) => handle.text(index).then(page => page.text)))).join('\n') }
  finally { await handle.destroy() }
}

test('Markdown exports a reviewed PDF copy to a new file without changing the document', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const source = '# Native report\r\n\r\n| A | B |\r\n| --- | --- |\r\n| one | two |\r\n'
  await writeFile(join(workspace, 'report.md'), source)
  await command('open', { file: 'report.md', editor: 'folio' })
  const dialog = await exportDialog(page)
  await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue('report.pdf')
  const target = join(workspace, 'report.pdf')
  await saveTo(page, dialog, target)
  await expect(folio(page).getByText('Saved PDF copy report.pdf').first()).toBeVisible()
  const text = await pdfText(target)
  for (const expected of ['Native report', 'one', 'two']) expect(text).toContain(expected)
  expect(await readFile(join(workspace, 'report.md'), 'utf8')).toBe(source)
  expect(await command('activeTabDirty')).toBe(false)
})

test('TXT and DOCX export PDF copies, and cancelling the save dialog writes nothing', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  await writeFile(join(workspace, 'notes.txt'), '**literal** café → ✓\n')
  await command('open', { file: 'notes.txt', editor: 'folio.txt' })
  let dialog = await exportDialog(page)
  await dialog.getByRole('button', { name: 'Save PDF copy…' }).click()
  const input = page.locator('.quick-input-widget input:visible')
  await expect(input).toBeVisible()
  await input.press('Escape')
  await expect(input).toBeHidden()
  await expect(dialog).toBeVisible()
  expect((await readdir(workspace)).filter(name => name.endsWith('.pdf'))).toEqual([])
  await saveTo(page, dialog, join(workspace, 'notes.pdf'))
  await expect(dialog).toHaveCount(0)
  expect(await pdfText(join(workspace, 'notes.pdf'))).toContain('**literal** café → ✓')
  await command('close')

  const original = writeDocx({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Word export' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Body text', marks: [{ type: 'italic' }] }] }] })
  await writeFile(join(workspace, 'brief.docx'), original)
  await command('open', { file: 'brief.docx', editor: 'folio.docx' })
  await expect(folio(page).getByRole('heading', { name: 'Word export' })).toBeVisible()
  dialog = await exportDialog(page)
  await expect(dialog.locator('.export-diagnostics')).toContainText('Word pagination')
  await saveTo(page, dialog, join(workspace, 'brief.pdf'))
  await expect(dialog).toHaveCount(0)
  const text = await pdfText(join(workspace, 'brief.pdf'))
  expect(text).toContain('Word export')
  expect(text).toContain('Body text')
  expect(new Uint8Array(await readFile(join(workspace, 'brief.docx')))).toEqual(original)
  expect(await command('activeTabDirty')).toBe(false)
})

test('a native edit after review blocks the stale PDF copy', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  await writeFile(join(workspace, 'stale.md'), '# Before\n')
  await command('open', { file: 'stale.md', editor: 'folio' })
  const dialog = await exportDialog(page)
  await command('insert', { file: 'stale.md', offset: '# Before'.length, text: ' and after' })
  await expect(folio(page).getByRole('heading', { name: 'Before and after' })).toBeAttached()
  await dialog.getByRole('button', { name: 'Save PDF copy…' }).click()
  await expect(dialog.getByRole('alert')).toContainText('changed after this preview')
  await expect(page.locator('.quick-input-widget input:visible')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Review current revision' }).click()
  const fresh = folio(page).getByRole('dialog', { name: 'Export PDF' })
  await expect(fresh.getByText(/Preview validated/)).toBeVisible({ timeout: 30_000 })
  await saveTo(page, fresh, join(workspace, 'stale.pdf'))
  await expect(fresh).toHaveCount(0)
  expect(await pdfText(join(workspace, 'stale.pdf'))).toContain('Before and after')
})
