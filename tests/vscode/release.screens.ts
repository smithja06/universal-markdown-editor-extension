// Captures release screenshots from real VS Code with synthetic demonstration documents only.
// Run: $env:FOLIO_SCREENSHOTS = '1'; npx playwright test --config playwright.vscode.config.ts --output test-results/screens
// Each image is clipped to Folio's webview, so no VS Code chrome, file paths or account details appear.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { writeDocx } from '../../src/document/formats/docx/write'
import { createSheet, createWorkbook } from '../../src/document/formats/spreadsheet/model'
import { builtinThemes, themeTint } from '../../src/document/formats/spreadsheet/themes'
import { processSpreadsheet } from '../../src/document/formats/spreadsheet/xlsx'
import { test } from './desktop'

test.use({ simpleFileDialog: true })
const media = 'docs/media/screenshots'

function folio(page: Page) {
  return page.locator('iframe.webview:visible').first().contentFrame().locator('iframe#active-frame').contentFrame()
}

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(600)
  await mkdir(media, { recursive: true })
  await page.locator('iframe.webview:visible').first().screenshot({ path: join(media, name + '.png') })
}

const markdown = `# Quarterly field notes

Folio keeps **Markdown** readable while you edit visually. Links like [the project guide](./guide.md) stay as authored.

> [!NOTE]
> Every edit goes through VS Code's own document, so Save and Undo work as usual.

## Progress

- [x] Draft the survey plan
- [x] Collect sample readings
- [ ] Review the summary with the team

| Site | Samples | Mean (mg/L) |
| --- | ---: | ---: |
| North creek | 12 | 4.8 |
| East pond | 9 | 6.1 |
| South marsh | 14 | 3.9 |

## Flow

\`\`\`mermaid
flowchart LR
  Collect --> Clean --> Analyse --> Report
\`\`\`

The mean concentration is $\\bar{x} = \\frac{1}{n}\\sum_i x_i$.
`

test('capture release screenshots', async ({ desktop }) => {
  test.skip(process.env.FOLIO_SCREENSHOTS !== '1', 'Screenshots are captured on request.')
  test.setTimeout(180_000)
  const { page, workspace, command } = desktop
  await page.setViewportSize({ width: 1500, height: 900 }).catch(() => undefined)
  await command('theme', { theme: 'Default Light Modern' })

  // Markdown Visual and Split.
  await writeFile(join(workspace, 'field-notes.md'), markdown)
  await command('open', { file: 'field-notes.md', editor: 'folio' })
  const notes = folio(page)
  await expect(notes.getByRole('heading', { name: 'Quarterly field notes' })).toBeVisible()
  await expect(notes.locator('svg').first()).toBeVisible({ timeout: 20_000 })
  await shoot(page, 'markdown-visual')
  await command('theme', { theme: 'Default Dark Modern' })
  await notes.getByRole('button', { name: 'Split Editor', exact: true }).click()
  await expect(notes.getByRole('textbox', { name: 'Markdown source editor' })).toBeVisible()
  await shoot(page, 'markdown-split')

  // PDF export review, then the exported copy in the PDF viewer.
  await command('theme', { theme: 'Default Light Modern' })
  await notes.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  await notes.getByRole('button', { name: 'Export', exact: true }).click()
  await notes.getByRole('menuitem', { name: 'Export PDF…' }).click()
  const review = notes.getByRole('dialog', { name: 'Export PDF' })
  await expect(review.getByText(/Preview validated · \d+ pages?/)).toBeVisible({ timeout: 30_000 })
  await shoot(page, 'pdf-export-preview')
  await review.getByRole('button', { name: 'Save PDF copy…' }).click()
  const input = page.locator('.quick-input-widget input:visible')
  await input.fill(join(workspace, 'field-notes.pdf'))
  await input.press('Enter')
  await expect(notes.getByText('Saved PDF copy field-notes.pdf').first()).toBeVisible()
  await command('theme', { theme: 'Default Dark Modern' })
  await command('open', { file: 'field-notes.pdf', editor: 'folio.pdf' })
  await expect(folio(page).getByRole('region', { name: /Page 1 of/ })).toBeVisible()
  await shoot(page, 'pdf-viewer')

  // DOCX.
  await command('theme', { theme: 'Default Light Modern' })
  const p = (text: string, marks?: { type: string }[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })
  const cell = (text: string, width: number, type = 'tableCell') => ({ type, attrs: { colwidth: [width] }, content: [p(text)] })
  await writeFile(join(workspace, 'project-brief.docx'), writeDocx({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Project brief' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'This brief is ' }, { type: 'text', text: 'synthetic demonstration content', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' for the Folio DOCX editor. Visit ' }, { type: 'text', text: 'example.com', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] }, { type: 'text', text: ' for details.' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Milestones' }] },
    { type: 'bulletList', content: ['Kick-off workshop', 'Prototype review', 'Pilot release'].map(item => ({ type: 'listItem', content: [p(item)] })) },
    { type: 'table', content: [
      { type: 'tableRow', content: [cell('Phase', 220, 'tableHeader'), cell('Owner', 160, 'tableHeader'), cell('Status', 140, 'tableHeader')] },
      { type: 'tableRow', content: [cell('Research', 220), cell('Design team', 160), cell('Complete', 140)] },
      { type: 'tableRow', content: [cell('Build', 220), cell('Engineering', 160), cell('In progress', 140)] },
    ] },
  ] }))
  await command('open', { file: 'project-brief.docx', editor: 'folio.docx' })
  await expect(folio(page).getByRole('heading', { name: 'Project brief' })).toBeVisible()
  await shoot(page, 'docx-editor')

  // XLSX with a theme, formats, a merge, conditional formatting and formulas.
  const wasm = new Uint8Array(await readFile('node_modules/@ironcalc/wasm-xlsx/wasm_bg.wasm'))
  const workbook = createWorkbook('xlsx')
  const theme = builtinThemes.find(item => item.name === 'Ocean')!
  workbook.theme = theme
  const [sheet] = workbook.sheets
  sheet.name = 'Budget'
  workbook.sheets.push(createSheet('Assumptions'))
  const head = { bold: true, color: '#ffffff', fill: theme.accent1.toLowerCase(), horizontal: 'center' as const }
  Object.assign(sheet.cells, {
    A1: { kind: 'text', value: 'Household budget (demo)', style: { bold: true, size: 16 } },
    A3: { kind: 'text', value: 'Category', style: head }, B3: { kind: 'text', value: 'Planned', style: head },
    C3: { kind: 'text', value: 'Actual', style: head }, D3: { kind: 'text', value: 'Difference', style: head },
  })
  const rows: [string, number, number][] = [['Rent', 1400, 1400], ['Groceries', 520, 584.35], ['Transport', 180, 142.1], ['Utilities', 210, 233.8], ['Savings', 400, 400]]
  rows.forEach(([name, planned, actual], index) => {
    const row = index + 4
    sheet.cells['A' + row] = { kind: 'text', value: name }
    sheet.cells['B' + row] = { kind: 'number', value: planned, style: { numberFormat: '"$"#,##0.00' } }
    sheet.cells['C' + row] = { kind: 'number', value: actual, style: { numberFormat: '"$"#,##0.00' } }
    sheet.cells['D' + row] = { kind: 'formula', value: `=C${row}-B${row}`, cached: actual - planned, style: { numberFormat: '"$"#,##0.00' } }
  })
  sheet.cells.A9 = { kind: 'text', value: 'Total', style: { bold: true, fill: themeTint(theme.accent1, 0.8) } }
  for (const column of ['B', 'C', 'D']) sheet.cells[column + '9'] = { kind: 'formula', value: `=SUM(${column}4:${column}8)`, cached: 0, style: { bold: true, numberFormat: '"$"#,##0.00', fill: themeTint(theme.accent1, 0.8), borders: { top: { color: '#1c7c7d', style: 'medium' } } } }
  sheet.merges = [{ row: 1, col: 1, endRow: 1, endCol: 4 }]
  sheet.widths = { 1: 150, 2: 110, 3: 110, 4: 120 }
  sheet.rules = [{ id: crypto.randomUUID(), range: { row: 4, col: 4, endRow: 8, endCol: 4 }, operator: 'greater', value: '0', valueType: 'number', color: '#f7dddf' }]
  const written = processSpreadsheet({ operation: 'write', workbook, includeCalculated: true }, wasm)
  if (written.operation !== 'write') throw new Error(written.message)
  await writeFile(join(workspace, 'budget.xlsx'), written.bytes)
  await command('open', { file: 'budget.xlsx', editor: 'folio.xlsx' })
  const grid = folio(page)
  await expect(grid.getByRole('gridcell', { name: /^A4 Rent/ })).toBeVisible()
  await grid.getByRole('gridcell', { name: /^D5/ }).click()
  const formula = grid.getByRole('textbox', { name: 'Formula bar' })
  await formula.click()
  await formula.fill('')
  await formula.pressSequentially('=ROU')
  await expect(grid.getByRole('listbox', { name: 'Function suggestions' })).toBeVisible()
  await shoot(page, 'xlsx-editor')
  await formula.press('Escape')
  await formula.press('Escape')

  // CSV.
  await command('theme', { theme: 'Default Dark Modern' })
  await writeFile(join(workspace, 'inventory.csv'), 'SKU,Item,Quantity,Unit price\r\n00042,Notebook,120,2.50\r\n00107,Pencil set,64,4.75\r\n00311,"Desk lamp, LED",15,32.00\r\n00512,Sticky notes,240,1.20\r\n')
  await command('open', { file: 'inventory.csv', editor: 'folio.csv' })
  await expect(folio(page).getByRole('gridcell', { name: 'A2 00042' })).toBeVisible()
  await shoot(page, 'csv-editor')
})
