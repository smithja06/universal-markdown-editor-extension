import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const visualEditor = (page: Page) => page.getByRole('textbox', { name: 'Visual document editor' })
const sourceEditor = (page: Page) => page.getByRole('textbox', { name: 'Markdown source editor' })

async function start(page: Page) {
  await page.goto('/')
  await expect(visualEditor(page).getByRole('heading', { name: 'Welcome to Folio' })).toBeVisible()
}

async function setSource(page: Page, content: string) {
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await sourceEditor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(content)
  await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
}

async function selectMenu(page: Page, menu: string, item: string) {
  await page.getByRole('button', { name: menu, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

test('real editor edits both modes, saves its draft, and restores it after reload', async ({ page }) => {
  await start(page)
  await setSource(page, '# Source title\n\n- [ ] An open item\n\nA **strong** word.\n')
  await expect(visualEditor(page).getByRole('heading', { name: 'Source title' })).toBeVisible()
  await visualEditor(page).getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toContainText('- [x] An open item')
  await expect(sourceEditor(page)).toContainText('A **strong** word.')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.reload()
  await expect(visualEditor(page).getByRole('heading', { name: 'Source title' })).toBeVisible()
  await expect(visualEditor(page).getByRole('checkbox')).toBeChecked()
})

test('an imported UTF-8 BOM and CRLF file downloads unchanged after repeated switches', async ({ page }) => {
  await start(page)
  const file = Buffer.from('\uFEFF---\r\ncustom: [a, b]\r\n---\r\n\r\nHeading\r\n=======\r\n\r\nA  *word* and [ref][one].\r\n\r\n[one]: /target\r\n')
  await page.locator('input[accept^=".md"]').setInputFiles({ name: 'Exact.markdown', mimeType: 'text/markdown', buffer: file })
  await expect(visualEditor(page).getByRole('heading', { name: 'Heading' })).toBeVisible()
  for (let iteration = 0; iteration < 3; iteration++) {
    await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
    await expect(sourceEditor(page)).toContainText('Heading')
    await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  }
  const downloadEvent = page.waitForEvent('download')
  await selectMenu(page, 'Export', 'Download Markdown')
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('Exact.markdown')
  expect(await readFile(await download.path())).toEqual(file)
})

test('extended formatting survives switching, visual undo, and a YAML sidebar edit', async ({ page }) => {
  await start(page)
  await setSource(page, '---\ncustom:\n  - retained\n---\n\nA selected word.\n')
  const editor = visualEditor(page)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Underline (Ctrl+U)', exact: true }).click()
  await expect(editor.locator('u')).toHaveText('A selected word.')
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toContainText('<u>A selected word.</u>')
  await expect(sourceEditor(page)).not.toContainText('data-folio-block')
  await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  await expect(editor.locator('u')).toHaveText('A selected word.')
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(editor.locator('u')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Front matter' }).click()
  await page.getByLabel('Author', { exact: true }).fill('A. Writer')
  await page.getByLabel('Author', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toContainText('author: A. Writer')
  await expect(sourceEditor(page)).toContainText('- retained')
})

test('inserts a table and opens a rendered Mermaid preview', async ({ page }) => {
  await start(page)
  await setSource(page, '# Plan\n\nDraft\n')
  await visualEditor(page).getByText('Draft').click()
  await selectMenu(page, 'Insert', 'Table')
  await page.getByRole('button', { name: '2 rows by 2 columns', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(visualEditor(page).getByRole('table').getByRole('columnheader')).toHaveCount(2)
  await visualEditor(page).getByText('Draft').click()
  await selectMenu(page, 'Insert', 'Mermaid diagram')
  await expect(page.getByRole('dialog').locator('.mermaid-result svg')).toBeVisible({ timeout: 20000 })
  await page.getByRole('dialog').getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(visualEditor(page).locator('.mermaid-result svg')).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toContainText('flowchart LR')
})

test('mobile view keeps both editors and the properties drawer accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await start(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.getByRole('button', { name: 'Toggle document properties', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Document properties' })).toBeVisible()
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark')
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Close document properties' }).click()
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('shares a single hue slider between light and dark themes and retains it after reload', async ({ page }) => {
  await start(page)
  const appearance = page.getByRole('tab', { name: 'Appearance' })
  await appearance.click()
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true })
  await expect(theme.locator('option')).toHaveText(['Light', 'Dark'])
  await expect(theme).toHaveValue('light')
  await expect(page.getByRole('slider')).toHaveCount(1)
  const hue = page.getByRole('slider', { name: 'Accent hue' })
  await expect(page.getByText('#226548', { exact: true })).toBeVisible()
  await hue.fill('270')
  await expect(page.getByText('#732EB8', { exact: true })).toBeVisible()
  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  await expect(exportButton).toHaveCSS('background-color', 'rgb(115, 46, 184)')
  await theme.selectOption('dark')
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark')
  await expect(exportButton).toHaveCSS('background-color', 'rgb(115, 46, 184)')
  await theme.press('Tab')
  await expect(hue).toBeFocused()
  await expect(hue).toHaveCSS('outline-style', 'solid')
  await page.reload()
  await expect(visualEditor(page).getByRole('heading', { name: 'Welcome to Folio' })).toBeVisible()
  await appearance.click()
  await expect(theme).toHaveValue('dark')
  await expect(hue).toHaveValue('270')
  await expect(exportButton).toHaveCSS('background-color', 'rgb(115, 46, 184)')
  await hue.press('Home')
  await expect(page.getByText('#B82E2E', { exact: true })).toBeVisible()
})

test('migrates a System theme and preserves an existing custom RGB accent', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => {
    const key = 'folio.appearance.v1'
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ theme: 'system', font: 'Serif', accentColor: { red: 255, green: 255, blue: 255 } }))
    }
  })
  await start(page)
  await page.getByRole('tab', { name: 'Appearance' }).click()
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true })
  await expect(theme).toHaveValue('dark')
  await expect(page.getByRole('combobox', { name: 'Editor font', exact: true })).toHaveValue('Serif')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark')
  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  await expect(exportButton).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(exportButton).toHaveCSS('color', 'rgb(0, 0, 0)')
})

test('source undo can revert a visual edit across the mode switch', async ({ page }) => {
  await start(page)
  await setSource(page, '# Plan\n\nDraft text.\n')
  await visualEditor(page).getByText('Draft text.').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' More.')
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toContainText('Draft text. More.')
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(sourceEditor(page)).not.toContainText('More.')
  await expect(sourceEditor(page)).toContainText('Draft text.')
  await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  await expect(visualEditor(page)).toContainText('Draft text.')
  await expect(visualEditor(page)).not.toContainText('More.')
})

test('dragging a block moves its original Markdown and preserves undo', async ({ page }) => {
  await start(page)
  await setSource(page, 'First _paragraph_.\n\nSecond *paragraph*.\n')
  const first = visualEditor(page).getByText('First paragraph.')
  const second = visualEditor(page).getByText('Second paragraph.')
  await first.hover()
  const box = await second.boundingBox()
  await page.getByRole('button', { name: 'Drag to move this block' }).dragTo(second, { targetPosition: { x: 30, y: box!.height - 2 } })
  await expect(visualEditor(page).locator('p').first()).toHaveText('Second paragraph.')
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  const lines = await sourceEditor(page).locator('.cm-line').allTextContents()
  expect(lines.filter(Boolean).slice(0, 3)).toEqual(['Second *paragraph*.', 'First _paragraph_.'])
  await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(visualEditor(page).locator('p').first()).toHaveText('First paragraph.')
})

test('HTML download renders Markdown, tables, and math with safe links', async ({ page }) => {
  await start(page)
  await setSource(page, '# Example\n\n[[TOC]]\n\n> [!TIP]\n> A callout.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nInline $x^2$.\n\n[unsafe](javascript:alert)\n\n<script>alert(1)</script>\n')
  const downloadEvent = page.waitForEvent('download')
  await selectMenu(page, 'Export', 'Export HTML')
  const download = await downloadEvent
  const html = await readFile(await download.path(), 'utf8')
  expect(html).toContain('<h1 id="example">Example</h1>')
  expect(html).toContain('<a href="#example">Example</a>')
  expect(html).toContain('callout-tip')
  expect(html).toContain('<table>')
  expect(html).toContain('<math')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('<script>')
})

test('visual undo restores the previous front matter without changing the body', async ({ page }) => {
  await start(page)
  await setSource(page, '---\nauthor: Original\ncustom: retained\n---\n\n# Heading\n')
  await page.getByRole('tab', { name: 'Front matter' }).click()
  const author = page.getByRole('textbox', { name: 'Author', exact: true })
  await author.fill('Changed')
  await author.press('Enter')
  await expect(author).toHaveValue('Changed')
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(author).toHaveValue('Original')
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toContainText('custom: retained')
  await expect(sourceEditor(page)).toContainText('# Heading')
})

test('local images remain embedded after exporting and reopening a document', async ({ page }) => {
  await start(page)
  await setSource(page, '# Images\n\nA picture follows.\n')
  await visualEditor(page).getByText('A picture follows.').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9q/VEAAAAASUVORK5CYII=', 'base64')
  await page.locator('input[accept^="image/png"]').setInputFiles({ name: 'Embedded.png', mimeType: 'image/png', buffer: pixel })
  await expect(visualEditor(page).getByRole('img', { name: 'Embedded' })).toHaveAttribute('src', /^data:image\/png;base64,/)
  const downloadEvent = page.waitForEvent('download')
  await selectMenu(page, 'Export', 'Download Markdown')
  const download = await downloadEvent
  const buffer = await readFile(await download.path())
  await page.locator('input[accept^=".md"]').setInputFiles({ name: 'Reopened.md', mimeType: 'text/markdown', buffer })
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue('Reopened')
  await expect(visualEditor(page).getByRole('img', { name: 'Embedded' })).toHaveAttribute('src', /^data:image\/png;base64,/)
})

test('rapid edits and switches keep the latest draft and preserve the editing block', async ({ page }) => {
  await start(page)
  await setSource(page, '# Plan\n\nFirst paragraph.\n\nSecond paragraph.\n')
  await visualEditor(page).getByText('Second paragraph.', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' Visual edit.')
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' Source edit.')
  await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  await expect(visualEditor(page)).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' Latest.')
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
    await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  }
  await expect(visualEditor(page).getByText('Second paragraph. Visual edit. Source edit. Latest.', { exact: true })).toBeVisible()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.reload()
  await expect(visualEditor(page).getByText('Second paragraph. Visual edit. Source edit. Latest.', { exact: true })).toBeVisible()
})

test('a mixed Markdown file exports cleanly after source and toolbar edits and reopens intact', async ({ page }) => {
  await start(page)
  const lines = [
    '---', 'title: Mixed', 'custom: [one, two]', '---', '',
    '# One', '', '## Two', '', '### Three', '', '#### Four', '', '##### Five', '', '###### Six', '',
    'Standard **bold**, *italic*, ~~strike~~, [link](/notes), and ![pixel](/pixel.png).', '',
    '- Outer', '  3. Ordered', '     - Inner', '', '> Quote', '', '- [ ] Check me', '',
    '> [!IMPORTANT]', '> A callout.', '', '| Left | Right |', '| :--- | ---: |', '| A | B |', '',
    'Inline code `a | b` and math $x^2$.', '', '```js', 'const lines = ["a", "b"];', '```', '',
    '```mermaid', 'flowchart LR', '  A --> B', '```', '', '$$', 'x^2 + y^2', '$$', '',
    '<section data-custom="untouched">HTML sample</section>', '', ':::widget', 'Opaque directive', ':::', '',
  ]
  const fixture = lines.join('\n')
  const input = page.locator('input[accept^=".md"]')
  await input.setInputFiles({ name: 'Mixed.md', mimeType: 'text/markdown', buffer: Buffer.from(fixture) })
  const visual = visualEditor(page)
  await expect(visual.getByRole('heading', { name: 'Six' })).toBeVisible()
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(fixture + '\nSource addition.\n')
  await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  await visual.getByRole('checkbox', { name: /Check me/ }).check()
  await visual.getByText('Source addition.', { exact: true }).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.getByRole('button', { name: 'Bold (Ctrl+B)', exact: true }).click()
  for (let iteration = 0; iteration < 3; iteration++) {
    await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
    await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  }
  const downloadEvent = page.waitForEvent('download')
  await selectMenu(page, 'Export', 'Download Markdown')
  const download = await downloadEvent
  const buffer = await readFile(await download.path())
  expect(buffer.toString()).toBe(fixture.replace('- [ ] Check me', '- [x] Check me') + '\n**Source addition.**\n')
  await input.setInputFiles({ name: 'Reopened.md', mimeType: 'text/markdown', buffer })
  await expect(visual.getByRole('checkbox', { name: /Check me/ })).toBeChecked()
  await expect(visual.locator('strong').getByText('Source addition.')).toBeVisible()
  await expect(visual.getByRole('table')).toBeVisible()
  await expect(visual.getByText('HTML sample', { exact: false })).toBeVisible()
})

test('a source-only delimiter edit stays exact and adds no visual undo step', async ({ page }) => {
  await start(page)
  const input = page.locator('input[accept^=".md"]')
  await input.setInputFiles({ name: 'Delimiters.md', mimeType: 'text/markdown', buffer: Buffer.from('_same word_\n') })
  await expect(visualEditor(page).locator('em')).toHaveText('same word')
  await setSource(page, '*same word*\n')
  await expect(visualEditor(page).locator('em')).toHaveText('same word')
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toContainText('*same word*')
  await expect(sourceEditor(page)).not.toContainText('_same word_')
})
