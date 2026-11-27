import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { readDocx } from '../../src/document/formats/docx/read'
import { writeDocx } from '../../src/document/formats/docx/write'
import { createWorkbook } from '../../src/document/formats/spreadsheet/model'
import { processSpreadsheet } from '../../src/document/formats/spreadsheet/xlsx'
import { encodeJournal, journalPath } from '../../extension/src/verifiedReplace'
import { test } from './desktop'

function folio(page: Page) {
  return page.locator('iframe.webview:visible').first().contentFrame().locator('iframe#active-frame').contentFrame()
}

const word = (heading: string) => writeDocx({ type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: heading }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Body text for the native save fixture.' }] },
] })

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function holdOpen(path: string) {
  const holder = spawn('powershell.exe', ['-NoProfile', '-Command',
    `$s=[IO.File]::Open('${path}','Open','Read','ReadWrite'); Write-Output ready; Start-Sleep 60; $s.Close()`])
  await new Promise(resolve => holder.stdout.once('data', resolve))
  return async () => {
    holder.kill()
    await new Promise(resolve => holder.once('exit', resolve))
  }
}

async function confirmSave(page: Page, command: (method: string) => Promise<unknown>, title: RegExp, choice = 'Save and Replace') {
  await command('startSave')
  const dialog = page.locator('.monaco-dialog-box')
  await expect(dialog).toContainText(title)
  await dialog.getByRole('button', { name: choice, exact: true }).click()
  await expect.poll(() => command('saveOutcome')).toBe('completed')
}

async function editCell(page: Page, address: string, value: string) {
  const frame = folio(page)
  await frame.getByRole('gridcell', { name: new RegExp(`^${address}(?: |$)`) }).dblclick()
  const input = frame.getByRole('textbox', { name: 'Edit ' + address, exact: true })
  await input.fill(value)
  await input.press('Enter')
}

const headings = (bytes: Uint8Array) => JSON.stringify(readDocx(Uint8Array.from(bytes)).document)

test.describe('native binary Save on a qualified local NTFS workspace', () => {
  test.use({ customDialogs: true, simpleFileDialog: true })

  test('DOCX Save confirms once, writes in place and refuses locked or externally changed files', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const path = join(workspace, 'native.docx')
    const original = word('Native save')
    await writeFile(path, original)
    await command('open', { file: 'native.docx', editor: 'folio.docx' })
    const frame = folio(page)
    await frame.getByRole('heading', { name: 'Native save' }).click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' edited')
    await expect(frame.getByText('Unsaved · draft recoverable', { exact: true })).toBeVisible()
    await expect.poll(() => command('activeTabDirty')).toBe(true)

    await confirmSave(page, command, /Replace native\.docx with the Folio draft\?/, 'Cancel')
    expect(await readFile(path)).toEqual(Buffer.from(original))
    await expect.poll(() => command('activeTabDirty')).toBe(true)

    await confirmSave(page, command, /Word page layout, styles and fonts/)
    await expect.poll(() => command('activeTabDirty')).toBe(false)
    await expect(frame.getByText('Saved to file', { exact: true })).toBeVisible()
    const saved = await readFile(path)
    expect(headings(saved)).toContain('Native save edited')

    // The confirmation applies to the version Folio wrote. A file held open by another app is never written.
    await frame.getByRole('heading', { name: 'Native save edited' }).click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' twice')
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    const release = await holdOpen(path)
    try {
      await command('save')
      await expect(frame.getByText(/Another app has this file open/).first()).toBeVisible()
      await expect.poll(() => command('activeTabDirty')).toBe(true)
    } finally { await release() }
    expect(await readFile(path)).toEqual(saved)
    await command('save')
    await expect.poll(() => command('activeTabDirty')).toBe(false)
    expect(headings(await readFile(path))).toContain('Native save edited twice')
    await expect(page.locator('.monaco-dialog-box')).toHaveCount(0)

    await frame.getByRole('heading', { name: 'Native save edited twice' }).click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' thrice')
    const external = word('Changed in another app')
    await writeFile(path, external)
    await expect(frame.getByText(/DOCX on disk changed/).first()).toBeVisible()
    await command('save')
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    expect(await readFile(path)).toEqual(Buffer.from(external))
    await expect(frame.getByRole('heading', { name: 'Native save edited twice thrice' })).toBeVisible()
  })

  test('DOCX Save As creates only new files and never replaces an existing one', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const path = join(workspace, 'source.docx')
    const original = word('Save As source')
    await writeFile(path, original)
    const occupied = join(workspace, 'occupied.docx')
    await writeFile(occupied, 'keep these bytes')
    await command('open', { file: 'source.docx', editor: 'folio.docx' })
    const frame = folio(page)
    await frame.getByRole('heading', { name: 'Save As source' }).click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' revised')
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    const input = page.locator('.quick-input-widget input:visible')

    await command('saveAs')
    await input.fill(occupied)
    await input.press('Enter')
    // The simple dialog asks inside the quick input. Confirming replacement still cannot make Folio overwrite the file.
    await expect(page.locator('.quick-input-widget')).toContainText('already exists')
    await input.press('Enter')
    await expect.poll(() => command('saveAsOutcome')).toBe('completed')
    expect(await readFile(occupied, 'utf8')).toBe('keep these bytes')
    await expect(frame.getByText(/does not replace an existing DOCX/).first()).toBeVisible()
    await expect.poll(() => command('activeTabDirty')).toBe(true)

    const destination = join(workspace, 'revised copy.docx')
    await command('saveAs')
    await input.fill(destination)
    await input.press('Enter')
    await expect.poll(() => command('saveAsOutcome')).toBe('completed')
    expect(headings(await readFile(destination))).toContain('Save As source revised')
    expect(await readFile(path)).toEqual(Buffer.from(original))
  })

  test('DOCX reopens an interrupted save as an unsaved draft and finishes it on Save', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const path = join(workspace, 'interrupted.docx')
    const previous = Uint8Array.from(word('Before the interrupted save'))
    const replacement = Uint8Array.from(word('Content being saved'))
    // Every byte of a stopped in-place write matches the previous or the replacement file at that offset.
    const length = Math.max(previous.length, replacement.length)
    // The packages share their leading ZIP entries, so the write stopped well inside the replacement bytes.
    const stop = Math.floor(replacement.length * 0.7)
    const partial = Uint8Array.from({ length }, (_, index) => index < stop ? replacement[index]
      : index < previous.length ? previous[index] : replacement[index])
    expect(sha(partial)).not.toBe(sha(previous))
    await writeFile(path, partial)
    const journals = join(dirname(workspace), 'profile', 'User', 'globalStorage', 'smithja06.folio-markdown-editor', 'save-journals')
    await mkdir(journals, { recursive: true })
    const journal = journalPath(journals, path)
    await writeFile(journal, encodeJournal({ version: 1, path, expected: sha(previous), next: sha(replacement), created: Date.now(), previous, replacement }))

    await command('open', { file: 'interrupted.docx', editor: 'folio.docx' })
    const frame = folio(page)
    await expect(frame.getByText(/previous Folio save of this DOCX was interrupted/).first()).toBeVisible()
    await expect(frame.getByRole('heading', { name: 'Content being saved' })).toBeVisible()
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    await confirmSave(page, command, /Replace interrupted\.docx/)
    await expect.poll(() => command('activeTabDirty')).toBe(false)
    expect(headings(await readFile(path))).toContain('Content being saved')
    await expect(readFile(journal)).rejects.toHaveProperty('code', 'ENOENT')
  })

  test('XLSX Save writes in place and Undo past the save point keeps a recoverable draft', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const workbook = createWorkbook('xlsx')
    workbook.sheets[0].cells.A1 = { kind: 'text', value: 'Opened' }
    const wasm = new Uint8Array(await readFile('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
    const written = processSpreadsheet({ operation: 'write', workbook }, wasm)
    if (written.operation !== 'write') throw new Error(written.message)
    const path = join(workspace, 'native.xlsx')
    await writeFile(path, written.bytes)
    await command('open', { file: 'native.xlsx', editor: 'folio.xlsx' })
    const frame = folio(page)
    await expect(frame.getByRole('gridcell', { name: 'A1 Opened' })).toBeVisible()
    await editCell(page, 'A1', 'Saved value')
    await expect(frame.getByText('Unsaved · draft recoverable', { exact: true })).toBeVisible()
    await confirmSave(page, command, /Replace native\.xlsx with the Folio draft\?/)
    await expect.poll(() => command('activeTabDirty')).toBe(false)
    await expect(frame.getByText('Saved to file', { exact: true })).toBeVisible()
    const reread = processSpreadsheet({ operation: 'read', bytes: Uint8Array.from(await readFile(path)) }, wasm)
    if (reread.operation !== 'read') throw new Error(reread.message)
    expect(reread.workbook.sheets[0].cells.A1?.value).toBe('Saved value')

    await command('undo')
    await expect(frame.getByRole('gridcell', { name: 'A1 Opened' })).toBeVisible()
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    await expect(frame.getByText('Unsaved · draft recoverable', { exact: true })).toBeVisible()
    await command('save')
    await expect.poll(() => command('activeTabDirty')).toBe(false)
    const restored = processSpreadsheet({ operation: 'read', bytes: Uint8Array.from(await readFile(path)) }, wasm)
    if (restored.operation !== 'read') throw new Error(restored.message)
    expect(restored.workbook.sheets[0].cells.A1?.value).toBe('Opened')
  })

  test('CSV Save keeps literal values, the dialect and untouched bytes', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const path = join(workspace, 'ledger.csv')
    await writeFile(path, '﻿id;formula;note\r\n0042;=SUM(1,2);"two\r\nlines"\r\n')
    await command('open', { file: 'ledger.csv', editor: 'folio.csv' })
    const frame = folio(page)
    await expect(frame.getByRole('gridcell', { name: 'A2 0042' })).toBeVisible()
    await editCell(page, 'A2', '0043')
    await confirmSave(page, command, /Replace ledger\.csv with the Folio draft\?/)
    await expect.poll(() => command('activeTabDirty')).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('﻿id;formula;note\r\n0043;=SUM(1,2);"two\r\nlines"\r\n')
  })
})
