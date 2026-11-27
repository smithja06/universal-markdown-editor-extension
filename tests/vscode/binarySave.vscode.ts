import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { readDocx } from '../../src/document/formats/docx/read'
import { writeDocx } from '../../src/document/formats/docx/write'
import { createSheet, createWorkbook } from '../../src/document/formats/spreadsheet/model'
import { builtinThemes } from '../../src/document/formats/spreadsheet/themes'
import { processSpreadsheet } from '../../src/document/formats/spreadsheet/xlsx'
import { encodeJournal, journalPath } from '../../extension/src/verifiedReplace'
import { extensionId, test } from './desktop'

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

  test('DOCX Save keeps font, size, color, highlight, strikethrough, alignment and indentation', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const path = join(workspace, 'styled.docx')
    await writeFile(path, word('Styled heading'))
    await command('open', { file: 'styled.docx', editor: 'folio.docx' })
    const frame = folio(page)
    const heading = frame.getByRole('heading', { name: 'Styled heading' })
    await heading.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    // Narrow windows move these toolbar menus into More formatting.
    const choose = async (menu: RegExp, item: string, compact: string) => {
      const trigger = frame.getByRole('button', { name: menu })
      if (await trigger.isVisible()) {
        await trigger.click()
        await frame.getByRole('menuitem', { name: item, exact: true }).click()
      } else {
        await frame.getByRole('button', { name: 'More formatting', exact: true }).click()
        await frame.getByRole('menuitem', { name: compact, exact: true }).click()
      }
    }
    await choose(/^Font family/, 'Georgia', 'Font family – Georgia')
    await choose(/^Font size in points/, '14', 'Font size – 14 pt')
    await choose(/^Text color/, 'Ocean', 'Text color – Ocean')
    await choose(/^Text highlight/, 'Lemon', 'Text highlight – Lemon')
    await choose(/^Alignment/, 'Align center', 'Align center')
    await frame.getByRole('button', { name: 'More formatting', exact: true }).click()
    await frame.getByRole('menuitem', { name: /^Increase indentation/ }).click()
    const strike = frame.getByRole('button', { name: 'Strikethrough', exact: true })
    if (await strike.isVisible()) await strike.click()
    else {
      await frame.getByRole('button', { name: 'More formatting', exact: true }).click()
      await frame.getByRole('menuitem', { name: 'Strikethrough', exact: true }).click()
    }
    await expect(heading.locator('s')).toHaveText('Styled heading')
    await expect(heading).toHaveCSS('text-align', 'center')
    await expect.poll(() => command('activeTabDirty')).toBe(true)

    await confirmSave(page, command, /Replace styled\.docx with the Folio draft\?/)
    await expect.poll(() => command('activeTabDirty')).toBe(false)
    const saved = readDocx(Uint8Array.from(await readFile(path)))
    expect(saved.document.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1, textAlign: 'center', indent: '24px' } })
    expect(saved.document.content?.[0].content?.[0].marks).toEqual([
      { type: 'strike' },
      { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '18.67px', color: '#2869a9', backgroundColor: '#fff0a5' } },
    ])
    expect(saved.issues.filter(issue => issue.effect !== 'preserved')).toEqual([])
  })

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
    const journals = join(dirname(workspace), 'profile', 'User', 'globalStorage', extensionId, 'save-journals')
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

  test('XLSX Save and Save As keep sheets, styles, merges, rules, theme and formulas', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const wasm = new Uint8Array(await readFile('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
    const workbook = createWorkbook('xlsx')
    workbook.theme = builtinThemes.find(theme => theme.name === 'Forest')!
    const [summary] = workbook.sheets
    summary.name = 'Summary'
    const data = createSheet('Data 2026')
    workbook.sheets.push(data, createSheet('Notes'))
    Object.assign(summary.cells, {
      A1: { kind: 'text', value: 'Saved title', style: { bold: true, font: 'Georgia', size: 16, fill: '#3a6b35', color: '#ffffff' } },
      A2: { kind: 'text', value: '00420' },
      A3: { kind: 'number', value: 19.99, style: { numberFormat: '"$"#,##0.00', borders: { bottom: { color: '#9b3240', style: 'double' } } } },
      A4: { kind: 'formula', value: "=SUM('Data 2026'!B1:B2)", cached: 30 },
      C1: { kind: 'number', value: 12 },
    })
    summary.merges = [{ row: 6, col: 1, endRow: 6, endCol: 3 }]
    summary.cells.A6 = { kind: 'text', value: 'Merged', style: { horizontal: 'center' } }
    summary.rules = [{ id: crypto.randomUUID(), range: { row: 1, col: 3, endRow: 1, endCol: 3 }, operator: 'greater', value: '10', valueType: 'number', color: '#f7dddf' }]
    data.cells.B1 = { kind: 'number', value: 10 }
    data.cells.B2 = { kind: 'number', value: 20 }
    const written = processSpreadsheet({ operation: 'write', workbook }, wasm)
    if (written.operation !== 'write') throw new Error(written.message)
    const path = join(workspace, 'native-rich.xlsx')
    await writeFile(path, written.bytes)
    await command('open', { file: 'native-rich.xlsx', editor: 'folio.xlsx' })
    const frame = folio(page)
    await expect(frame.getByRole('gridcell', { name: 'A2 00420' })).toBeVisible()
    await editCell(page, 'C2', 'Edited in Folio')
    await confirmSave(page, command, /Replace native-rich\.xlsx with the Folio draft\?/)
    await expect.poll(() => command('activeTabDirty')).toBe(false)
    const destination = join(workspace, 'native-rich save as.xlsx')
    await editCell(page, 'C3', 'Save As copy')
    await command('saveAs')
    const input = page.locator('.quick-input-widget input:visible')
    await input.fill(destination)
    await input.press('Enter')
    await expect.poll(() => command('saveAsOutcome')).toBe('completed')
    for (const [file, extra] of [[path, undefined], [destination, 'Save As copy']] as const) {
      const read = processSpreadsheet({ operation: 'read', bytes: Uint8Array.from(await readFile(file)) }, wasm)
      if (read.operation !== 'read') throw new Error(read.message)
      const sheet = read.workbook.sheets[0]
      expect(read.workbook.sheets.map(item => item.name)).toEqual(['Summary', 'Data 2026', 'Notes'])
      expect(read.workbook.theme?.name).toBe('Forest')
      expect(sheet.cells.A2).toMatchObject({ kind: 'text', value: '00420' })
      expect(sheet.cells.A1.style).toMatchObject({ bold: true, font: 'Georgia', size: 16 })
      expect(sheet.cells.A1.style?.fill?.toLowerCase()).toBe('#3a6b35')
      expect(sheet.cells.A3.style?.numberFormat).toBe('"$"#,##0.00')
      expect(sheet.cells.A3.style?.borders?.bottom?.style).toBe('double')
      expect(sheet.cells.A4).toMatchObject({ kind: 'formula', value: "=SUM('Data 2026'!B1:B2)" })
      expect(sheet.merges).toEqual([{ row: 6, col: 1, endRow: 6, endCol: 3 }])
      expect(sheet.rules).toHaveLength(1)
      expect(sheet.cells.C2?.value).toBe('Edited in Folio')
      if (extra) expect(sheet.cells.C3?.value).toBe(extra)
      else expect(sheet.cells.C3).toBeUndefined()
    }
    if (process.env.FOLIO_INTEROP_OUT) {
      await mkdir(process.env.FOLIO_INTEROP_OUT, { recursive: true })
      await copyFile(path, join(process.env.FOLIO_INTEROP_OUT, 'folio-native-save.xlsx'))
      await copyFile(destination, join(process.env.FOLIO_INTEROP_OUT, 'folio-native-save-as.xlsx'))
    }
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
