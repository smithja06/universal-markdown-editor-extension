import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { createSheet, createWorkbook } from '../../src/document/formats/spreadsheet/model'
import { processSpreadsheet } from '../../src/document/formats/spreadsheet/xlsx'
import { accentAtHue, accentHex } from '../../src/appearance'
import { test } from './desktop'

function folio(page: Page) {
  return page.locator('iframe.webview:visible').first().contentFrame().locator('iframe#active-frame').contentFrame()
}

async function editCell(page: Page, address: string, value: string) {
  const frame = folio(page)
  await frame.getByRole('gridcell', { name: new RegExp(`^${address}(?: |$)`) }).dblclick()
  const input = frame.getByRole('textbox', { name: 'Edit ' + address, exact: true })
  await input.fill(value)
  await input.press('Enter')
}

async function saveReviewedCopy(page: Page, format: 'CSV' | 'XLSX' | 'PNG', target: string) {
  const frame = folio(page)
  await frame.getByRole('button', { name: 'Export copies' }).click()
  await frame.getByRole('menuitem', { name: format === 'PNG' ? 'Export selected range as PNG…' : `Export ${format} copy…` }).click()
  const review = frame.getByRole('dialog', { name: format === 'PNG' ? 'Export range as PNG' : `Export ${format} copy` })
  await expect(review).toBeVisible()
  if (format === 'CSV') await review.getByRole('radio', { name: 'Spreadsheet-safe copy' }).check()
  if (format !== 'PNG') await review.getByRole('checkbox', { name: /I reviewed the copy options/ }).check()
  await review.getByRole('button', { name: 'Export copy', exact: true }).click()
  const input = page.locator('.quick-input-widget input:visible')
  await expect(input).toBeVisible()
  await input.fill(target)
  await input.press('Enter')
  await expect(input).toBeHidden()
}

test('CSV keeps the native text editor default and Folio edits literal cells with native undo, redo and revert', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const file = 'transactions.csv'
  const path = join(workspace, file)
  const original = '\ufeff0042;"=SUM(1,2)"\r\n0007;"split\r\nline"\r\n'
  await writeFile(path, original)
  await command('open', { file, editor: 'default' })
  await expect.poll(() => command('activeNativeUri')).toMatch(/transactions\.csv$/)
  await command('open', { file, editor: 'folio.csv' })
  await expect.poll(() => command('activeCustomEditor')).toBe('folio.csv')
  const frame = folio(page)
  await expect(frame.getByRole('gridcell', { name: 'A1 0042' })).toBeVisible()
  await expect(frame.getByRole('gridcell', { name: 'B1 =SUM(1,2)' })).toBeVisible()
  await editCell(page, 'A1', '0009')
  await expect.poll(() => command('activeTabDirty')).toBe(true)
  await command('undo')
  await expect(frame.getByRole('gridcell', { name: 'A1 0042' })).toBeVisible()
  await command('redo')
  await expect(frame.getByRole('gridcell', { name: 'A1 0009' })).toBeVisible()
  await command('revert')
  await expect(frame.getByRole('gridcell', { name: 'A1 0042' })).toBeVisible()
  await expect.poll(() => command('activeTabDirty')).toBe(false)
  expect(await readFile(path, 'utf8')).toBe(original)
})

test('XLSX opens as an opt-in editor and loads multiple worksheets and cached formula results', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const workbook = createWorkbook('xlsx')
  workbook.sheets[0].cells.A1 = { kind: 'formula', value: '=1+2', cached: 99 }
  const costs = createSheet('Costs')
  costs.cells.A1 = { kind: 'text', value: 'Second worksheet' }
  workbook.sheets.push(costs)
  const wasm = new Uint8Array(await readFile('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
  const original = processSpreadsheet({ operation: 'write', workbook }, wasm)
  if (original.operation !== 'write') throw new Error(original.message)
  const file = 'summary.xlsx'
  const path = join(workspace, file)
  await writeFile(path, original.bytes)
  await command('open', { file, editor: 'folio.xlsx' })
  await expect.poll(() => command('activeCustomEditor')).toBe('folio.xlsx')
  const frame = folio(page)
  await expect(frame.getByRole('gridcell', { name: 'A1 99' })).toBeVisible()
  await expect(frame.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=1+2')
  await frame.getByRole('button', { name: 'Stored results' }).click()
  await frame.getByRole('button', { name: 'Enable local calculation' }).click()
  await expect(frame.getByRole('gridcell', { name: 'A1 3' })).toBeVisible()
  await writeFile(join(workspace, 'other.csv'), 'Another file\n')
  await command('open', { file: 'other.csv', editor: 'default' })
  await expect.poll(() => command('activeNativeUri')).toMatch(/other\.csv$/)
  await command('open', { file, editor: 'folio.xlsx' })
  await expect(frame.getByRole('gridcell', { name: 'A1 3' })).toBeVisible()

  await frame.getByRole('tab', { name: 'Costs', exact: true }).click()
  await expect(frame.getByRole('gridcell', { name: 'A1 Second worksheet' })).toBeVisible()
  await editCell(page, 'A1', 'Edited draft')
  await expect.poll(() => command('activeTabDirty')).toBe(true)
  expect(await readFile(path)).toEqual(Buffer.from(original.bytes))

  const replacement = createWorkbook('xlsx')
  replacement.sheets[0].cells.A1 = { kind: 'formula', value: '=6*7', cached: 101 }
  const replacementFile = processSpreadsheet({ operation: 'write', workbook: replacement }, wasm)
  if (replacementFile.operation !== 'write') throw new Error(replacementFile.message)
  await writeFile(path, replacementFile.bytes)
  await expect(frame.getByRole('alert')).toContainText('The workbook on disk changed')
  await command('revert')
  await expect(frame.getByRole('gridcell', { name: 'A1 101' })).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Stored results' })).toBeVisible()
})

test('XLSX Ctrl+B, Ctrl+I and Ctrl+U format cells from the grid, cell editor and formula bar without reaching VS Code', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const workbook = createWorkbook('xlsx')
  workbook.sheets[0].cells.A1 = { kind: 'text', value: 'Grid' }
  workbook.sheets[0].cells.A2 = { kind: 'text', value: 'Editor' }
  workbook.sheets[0].cells.A3 = { kind: 'text', value: 'Bar' }
  const wasm = new Uint8Array(await readFile('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
  const original = processSpreadsheet({ operation: 'write', workbook }, wasm)
  if (original.operation !== 'write') throw new Error(original.message)
  await writeFile(join(workspace, 'shortcuts.xlsx'), original.bytes)
  await command('open', { file: 'shortcuts.xlsx', editor: 'folio.xlsx' })
  const frame = folio(page)
  const sidebar = page.locator('.part.sidebar')
  const sidebarVisible = await sidebar.isVisible()
  const cell = (address: string) => frame.getByRole('gridcell', { name: new RegExp(`^${address} `) })

  await cell('A1').click()
  await page.keyboard.press('ControlOrMeta+b')
  await expect(cell('A1')).toHaveCSS('font-weight', '700')
  expect(await sidebar.isVisible()).toBe(sidebarVisible)

  await cell('A2').dblclick()
  const editor = frame.getByRole('textbox', { name: 'Edit A2', exact: true })
  await editor.press('ControlOrMeta+a')
  await editor.press('ControlOrMeta+b')
  await editor.press('ControlOrMeta+i')
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('Editor')
  await editor.press('End')
  await editor.pressSequentially(' typed')
  await editor.press('Enter')
  await expect(cell('A2')).toHaveAccessibleName('A2 Editor typed')
  await expect(cell('A2')).toHaveCSS('font-weight', '700')
  await expect(cell('A2')).toHaveCSS('font-style', 'italic')
  expect(await sidebar.isVisible()).toBe(sidebarVisible)

  await cell('A3').click()
  const bar = frame.getByRole('textbox', { name: 'Formula bar' })
  await bar.click()
  await bar.press('ControlOrMeta+u')
  await expect(cell('A3')).toHaveCSS('text-decoration-line', 'underline')
  await bar.press('ControlOrMeta+u')
  await expect(cell('A3')).not.toHaveCSS('text-decoration-line', 'underline')
  expect(await sidebar.isVisible()).toBe(sidebarVisible)
  await expect.poll(() => command('activeTabDirty')).toBe(true)
})

test('XLSX calculates a typed formula and offers calculation for formulas without stored results', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const workbook = createWorkbook('xlsx')
  workbook.sheets[0].cells.A1 = { kind: 'formula', value: '=2+3' }
  const wasm = new Uint8Array(await readFile('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
  const original = processSpreadsheet({ operation: 'write', workbook }, wasm)
  if (original.operation !== 'write') throw new Error(original.message)
  const file = 'uncalculated.xlsx'
  await writeFile(join(workspace, file), original.bytes)
  await command('open', { file, editor: 'folio.xlsx' })
  const frame = folio(page)
  const banner = frame.getByRole('status').filter({ hasText: 'Some formulas are not calculated.' })
  await expect(frame.getByRole('gridcell', { name: 'A1 Not calculated' })).toBeVisible()
  await expect(banner).toBeVisible()
  await editCell(page, 'C1', '=SUM(1,2,3)')
  await expect(frame.getByRole('gridcell', { name: 'C1 6' })).toBeVisible()
  await expect(frame.getByRole('gridcell', { name: 'A1 5' })).toBeVisible()
  await expect(frame.getByText('Local calculation is on for this workbook because you entered a formula.')).toBeVisible()
  await expect(banner).toHaveCount(0)
  await expect(frame.getByRole('button', { name: 'Calculated' })).toBeVisible()

  await command('revert')
  await expect(frame.getByRole('gridcell', { name: 'A1 Not calculated' })).toBeVisible()
  await banner.getByRole('button', { name: 'Enable calculation' }).click()
  await expect(frame.getByRole('gridcell', { name: 'A1 5' })).toBeVisible()
  await expect(banner).toHaveCount(0)
})

test('XLSX offers calculation when a row insert rewrites a stored formula on another worksheet', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  const workbook = createWorkbook('xlsx')
  workbook.sheets[0].name = 'Summary'
  workbook.sheets[0].cells.A1 = { kind: 'formula', value: '=SUM(Data!A1:A2)', cached: 7 }
  const data = createSheet('Data')
  data.cells.A1 = { kind: 'number', value: 3 }
  data.cells.A2 = { kind: 'number', value: 4 }
  workbook.sheets.push(data)
  const wasm = new Uint8Array(await readFile('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
  const original = processSpreadsheet({ operation: 'write', workbook }, wasm)
  if (original.operation !== 'write') throw new Error(original.message)
  await writeFile(join(workspace, 'linked.xlsx'), original.bytes)
  await command('open', { file: 'linked.xlsx', editor: 'folio.xlsx' })
  const frame = folio(page)
  const banner = frame.getByRole('status').filter({ hasText: 'Some formulas are not calculated.' })
  await expect(frame.getByRole('gridcell', { name: 'A1 7' })).toBeVisible()
  await expect(banner).toHaveCount(0)
  await frame.getByRole('tab', { name: 'Data', exact: true }).click()
  await frame.getByRole('rowheader').filter({ hasText: /^2$/ }).click({ button: 'right' })
  await frame.getByRole('menuitem', { name: 'Insert row above' }).click()
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: 'Enable calculation' }).click()
  await expect(banner).toHaveCount(0)
  await frame.getByRole('tab', { name: 'Summary', exact: true }).click()
  await expect(frame.getByRole('gridcell', { name: 'A1 7' })).toBeVisible()
  await frame.getByRole('gridcell', { name: 'A1 7' }).click()
  await expect(frame.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=SUM(Data!A1:A3)')
})

test.describe('workbook hot exit', () => {
  test.use({ hotExit: 'onExitAndWindowClose' })

  test('restores a CSV draft when the opened bytes are replaced and reverts only on request', async ({ desktop }) => {
    test.setTimeout(120_000)
    const { page, workspace, command, restart } = desktop
    const file = 'recovery.csv'
    const path = join(workspace, file)
    await writeFile(path, 'Opened original,42\r\n')
    await command('open', { file, editor: 'folio.csv' })
    await editCell(page, 'A1', 'Pending version')
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    await writeFile(path, 'Replacement,100\r\n')
    const frame = folio(page)
    await expect(frame.getByRole('alert')).toContainText('The workbook on disk changed')
    await restart('window')
    await expect(frame.getByRole('gridcell', { name: 'A1 Pending version' })).toBeVisible()
    await expect(frame.getByRole('alert')).toContainText('The workbook on disk changed')
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    await command('revert')
    await expect(frame.getByRole('gridcell', { name: 'A1 Replacement' })).toBeVisible()
    expect(await readFile(path, 'utf8')).toBe('Replacement,100\r\n')
  })
})

test.describe('workbook copy delivery', () => {
  test.use({ simpleFileDialog: true })

  test('reviews, generates and saves a CSV copy while preserving the source and native dirty state', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const file = 'identifiers.csv'
    const original = '\ufeff007;=1+2\r\n'
    await writeFile(join(workspace, file), original)
    await command('open', { file, editor: 'folio.csv' })
    await editCell(page, 'A1', '009')
    await expect.poll(() => command('activeTabDirty')).toBe(true)
    const frame = folio(page)
    const target = join(workspace, 'safe-copy.csv')
    await saveReviewedCopy(page, 'CSV', target)
    await expect(frame.getByText('Saved safe-copy.csv.')).toBeVisible()
    expect(await readFile(target, 'utf8')).toBe("\ufeff009;'=1+2\r\n")
    expect(await readFile(join(workspace, file), 'utf8')).toBe(original)
    await expect.poll(() => command('activeTabDirty')).toBe(true)
  })

  test('XLSX copies include the reviewed locally calculated result while retaining the original formula', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    const workbook = createWorkbook('xlsx')
    workbook.sheets[0].cells.A1 = { kind: 'formula', value: '=6*7', cached: 101 }
    const wasm = new Uint8Array(await readFile('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
    const original = processSpreadsheet({ operation: 'write', workbook }, wasm)
    if (original.operation !== 'write') throw new Error(original.message)
    await writeFile(join(workspace, 'calculations.xlsx'), original.bytes)
    await command('open', { file: 'calculations.xlsx', editor: 'folio.xlsx' })
    const frame = folio(page)
    await expect(frame.getByRole('gridcell', { name: 'A1 101' })).toBeVisible()
    await frame.getByRole('button', { name: 'Stored results' }).click()
    await frame.getByRole('button', { name: 'Enable local calculation' }).click()
    await expect(frame.getByRole('gridcell', { name: 'A1 42' })).toBeVisible()
    const target = join(workspace, 'calc-copy.xlsx')
    await saveReviewedCopy(page, 'XLSX', target)
    await expect(frame.getByText('Saved calc-copy.xlsx.')).toBeVisible()
    const copy = processSpreadsheet({ operation: 'read', bytes: new Uint8Array(await readFile(target)) }, wasm)
    if (copy.operation !== 'read') throw new Error(copy.message)
    expect(copy.workbook.sheets[0].cells.A1).toMatchObject({ kind: 'formula', value: '=6*7', cached: 42 })
    expect(await readFile(join(workspace, 'calculations.xlsx'))).toEqual(Buffer.from(original.bytes))
  })

  test('writes a selected range PNG from the VS Code editor to a new file', async ({ desktop }) => {
    const { page, workspace, command } = desktop
    await writeFile(join(workspace, 'range.csv'), 'A,B\r\n12,34\r\n')
    await command('open', { file: 'range.csv', editor: 'folio.csv' })
    const frame = folio(page)
    const name = frame.getByRole('textbox', { name: 'Name box' })
    await name.fill('A1:B2')
    await name.press('Enter')
    const target = join(workspace, 'selected-range.png')
    await saveReviewedCopy(page, 'PNG', target)
    await expect(frame.getByText('Saved selected-range.png.')).toBeVisible()
    const bytes = await readFile(target)
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(bytes.readUInt32BE(16)).toBe(208)
    expect(bytes.readUInt32BE(20)).toBe(52)
  })
})

test.describe('spreadsheet provider boundaries', () => {
  test.use({ virtualWorkspace: true })

  test('declines a non-file spreadsheet provider without modifying provider data', async ({ desktop }) => {
    const { page, command } = desktop
    const file = 'provider.csv'
    await command('addVirtualWorkspace', { file, markdown: 'provider supplied data', pixel: '' })
    await command('open', { file, editor: 'folio.csv', virtual: 1 })
    await expect(folio(page).getByRole('alert')).toContainText('require a trusted workspace and a local file')
    expect(await command('readProviderFile', { file })).toBe('provider supplied data')
  })
})

test.describe('spreadsheet workspace trust', () => {
  test.use({ restricted: true })

  test('keeps the native CSV text editor available in Restricted Mode', async ({ desktop }) => {
    const { page, command, workspace } = desktop
    const file = 'restricted.csv'
    await writeFile(join(workspace, file), '00042,Restricted\n')
    expect(await command('workspaceTrust')).toBe(false)
    await command('open', { file, editor: 'default' })
    await expect.poll(() => command('activeNativeUri')).toMatch(/restricted\.csv$/)
    await command('editorChoices')
    const choices = page.locator('.quick-input-widget:visible')
    await expect(choices.getByText('Text Editor', { exact: true })).toBeVisible()
    await expect(choices.getByText('Folio CSV Editor', { exact: true })).toHaveCount(0)
  })
})

test('Open with Folio opens XLSX and shares the chosen theme and accent with other Folio editors', async ({ desktop }) => {
  const { page, workspace, command } = desktop
  for (const when of await command<(string | null)[]>('openWithFolioMenus')) expect(when).toContain('xlsx')
  const workbook = createWorkbook('xlsx')
  workbook.sheets[0].cells.A1 = { kind: 'text', value: 'Themed' }
  const wasm = new Uint8Array(await readFile('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
  const written = processSpreadsheet({ operation: 'write', workbook }, wasm)
  if (written.operation !== 'write') throw new Error(written.message)
  await writeFile(join(workspace, 'themed.xlsx'), written.bytes)
  await writeFile(join(workspace, 'notes.md'), '# Notes\n')

  await command('openWithFolio', { file: 'themed.xlsx' })
  await expect.poll(() => command('activeCustomEditor')).toBe('folio.xlsx')
  const sheet = folio(page)
  await expect(sheet.getByRole('gridcell', { name: 'A1 Themed' })).toBeVisible()
  const sheetApp = sheet.locator('.app').first()
  await expect(sheetApp).toHaveAttribute('data-host-colors', '')
  await sheet.getByRole('button', { name: 'Appearance' }).click()
  const popover = sheet.getByRole('dialog', { name: 'Appearance' })
  await expect(popover.getByRole('combobox', { name: 'Theme' })).toHaveValue('host')
  await popover.getByRole('combobox', { name: 'Theme' }).selectOption('dark')
  await expect(sheetApp).toHaveAttribute('data-theme', 'dark')
  await expect(sheetApp).not.toHaveAttribute('data-host-colors')
  await expect(sheetApp).toHaveCSS('background-color', 'rgb(24, 24, 24)')
  await popover.getByRole('slider', { name: 'Accent hue' }).fill('210')
  const hex = accentHex(accentAtHue(210))
  await expect(popover.getByLabel('Accent hex value')).toHaveText(hex)

  await command('openWithFolio', { file: 'notes.md' })
  await expect.poll(() => command('activeCustomEditor')).toBe('folio.markdown')
  const markdown = folio(page)
  const markdownApp = markdown.locator('.app').first()
  await expect(markdownApp).toHaveAttribute('data-theme', 'dark')
  await expect(markdownApp).not.toHaveAttribute('data-host-colors')
  await markdown.getByRole('button', { name: 'Toggle document properties' }).click()
  await markdown.getByRole('tab', { name: 'Appearance' }).click()
  const theme = markdown.getByRole('combobox', { name: 'Theme' })
  await expect(theme).toHaveValue('dark')
  await expect(markdown.getByLabel('Accent hex value')).toHaveText(hex)
  await theme.selectOption('host')
  await expect(markdownApp).toHaveAttribute('data-host-colors', '')

  await command('openWithFolio', { file: 'themed.xlsx' })
  await expect.poll(() => command('activeCustomEditor')).toBe('folio.xlsx')
  await expect(folio(page).locator('.app').first()).toHaveAttribute('data-host-colors', '')
})
