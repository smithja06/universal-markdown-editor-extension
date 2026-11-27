import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const visualEditor = (page: Page) => page.getByRole('textbox', { name: 'Visual document editor' })
const sourceEditor = (page: Page) => page.getByRole('textbox', { name: 'Markdown source editor' })
const pngPixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9q/VEAAAAASUVORK5CYII='

async function start(page: Page) {
  await page.goto('/')
  await expect(visualEditor(page).getByRole('heading', { name: 'Welcome to Folio' })).toBeVisible()
}

async function setSource(page: Page, content: string, returnToVisual = true) {
  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await sourceEditor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(content)
  if (returnToVisual) await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
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
  await expect(sourceEditor(page)).toContainText('- [x] An open item')
  await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
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

test('self-contained HTML opens offline with rendered diagrams, math, and embedded images', async ({ page, context }, testInfo) => {
  await start(page)
  const pixel = `data:image/png;base64,${pngPixel}`
  const source = [
    '---', 'title: Offline Notes', 'description: A portable report', 'lang: en-CA', '---', '',
    '# Offline export', '', 'Inline $x^2 + \\alpha$.', '', '$$', '\\frac{1}{2}', '$$', '',
    '```Mermaid', 'flowchart LR', 'A[Start] --> B[Finish]', '```', '',
    '```mermaid', 'sequenceDiagram', 'Alice->>Bob: Hello', '```', '',
    '```mermaid', 'classDiagram', 'Animal <|-- Duck', '```', '',
    '```mermaid', 'not a diagram <keep this>', '```', '',
    '```mermaid', 'flowchart LR', 'A@{ img: "https://example.invalid/mermaid-image.png", label: "External image" }', '```', '',
    `<picture><source srcset="https://example.invalid/unavailable.png"><img src="${pixel}" alt="Embedded"></picture>`, '',
    '![Missing local image](./missing.png)', '',
  ].join('\n')
  const diagramRequests: string[] = []
  page.on('request', request => { if (request.url().includes('mermaid-image.png')) diagramRequests.push(request.url()) })
  await setSource(page, source, false)
  const downloadEvent = page.waitForEvent('download')
  await selectMenu(page, 'Export', 'Self-Contained HTML')
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/-self-contained\.html$/)
  await expect(page.getByRole('status').filter({ hasText: 'HTML download started' })).toContainText(/2 diagrams.*1 image/)
  expect(diagramRequests).toEqual([])
  await expect(sourceEditor(page)).toContainText('not a diagram <keep this>')
  const markdownDownload = page.waitForEvent('download')
  await selectMenu(page, 'Export', 'Download Markdown')
  expect(await readFile(await (await markdownDownload).path(), 'utf8')).toBe(source)

  const document = await context.newPage()
  const networkRequests: string[] = []
  document.on('request', request => { if (/^https?:/i.test(request.url())) networkRequests.push(request.url()) })
  const outputPath = testInfo.outputPath('offline.html')
  await download.saveAs(outputPath)
  await context.setOffline(true)
  await document.goto(pathToFileURL(outputPath).href)
  await expect(document).toHaveTitle('Offline Notes')
  await expect(document.locator('html')).toHaveAttribute('lang', 'en-CA')
  await expect(document.locator('meta[name="description"]')).toHaveAttribute('content', 'A portable report')
  await expect(document.locator('.katex math')).toHaveCount(2)
  await expect(document.locator('.katex-display .katex-html')).toBeVisible()
  expect(await document.evaluate(async () => (await window.document.fonts.load('1em KaTeX_Main')).length)).toBeGreaterThan(0)
  const diagrams = document.getByRole('img', { name: /Mermaid diagram/ })
  await expect(diagrams).toHaveCount(3)
  for (const [index, label] of ['Finish', 'Hello', 'Duck'].entries()) {
    const image = diagrams.nth(index)
    await expect(image).toBeVisible()
    const svg = decodeURIComponent((await image.getAttribute('src'))!.split(',')[1])
    expect(svg).toContain('<svg')
    expect(svg).toContain(label)
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  }
  const preservedDiagrams = document.locator('pre code.language-mermaid')
  await expect(preservedDiagrams).toHaveCount(2)
  await expect(preservedDiagrams.first()).toHaveText('not a diagram <keep this>\n')
  await expect(preservedDiagrams.last()).toContainText('mermaid-image.png')
  await expect(document.getByRole('img', { name: 'Embedded' })).toBeVisible()
  expect(await document.getByRole('img', { name: 'Embedded' }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
  await expect(document.locator('source[srcset]')).toHaveCount(0)
  await expect(document.getByText(/Image unavailable offline.*Missing local image/)).toBeVisible()
  await expect(document.locator('img[src="./missing.png"]')).toHaveCount(0)
  expect(networkRequests).toEqual([])
})

test('HTML export preserves rich content and blocks active markup', async ({ page, context }, testInfo) => {
  await start(page)
  await setSource(page, [
    '# Heading', '## Another', '### Third', '#### Fourth', '##### Fifth', '###### Sixth', '', '[[TOC]]', '',
    '<p style="text-align: right; line-height: 2"><strong>Bold</strong> <em>Italic</em> <u>Underline</u> <s>Strike</s> x<sup>2</sup> H<sub>2</sub>O <span style="font-family: Georgia; font-size: 20px; color: rgb(0, 90, 100); background-color: #ffe792">Styled</span></p>', '',
    '3. Ordered', '   - Nested', '', '- [x] Completed', '', '> Quoted', '', ':::note', 'A directive callout.', ':::', '',
    ':::widget{key="value"}', 'Unrecognized content', ':::', '',
    '| Left | Right |', '| :--- | ---: |', '| 1 | 2 |', '',
    '<p><span data-folio-image="" data-folio-caption="Caption" data-folio-align="right" class="document-image"><img src="./image.png" alt="Diagram" width="200"><span class="image-caption">Caption</span></span></p>', '',
    '```js', 'const answer = 42', '```', '',
    '$$', '\\frac{1}{2}', '$$', '',
    '<span id="custom">Anchor target</span> [Anchor](#custom)', '', 'Footnote[^one].', '', '[^one]: A footnote.', '', '---', '',
    '<img src="javascript:alert(1)" srcset="https://example.invalid/1" onerror="window.injected=true" alt="Unsafe">', '',
    '<script>window.injected=true</script><iframe src="https://example.invalid"></iframe>', '',
    '<span style="color: green; background-image: url(https://example.invalid)">Safe style</span>', '',
    '```mermaid', 'flowchart LR', 'A[Diagram] --> B[Safe]', 'click A "javascript:alert(1)"', '```', '',
  ].join('\n'))
  const downloadEvent = page.waitForEvent('download')
  await selectMenu(page, 'Export', 'Export HTML')
  const output = await context.newPage()
  await output.emulateMedia({ colorScheme: 'dark' })
  await output.setViewportSize({ width: 420, height: 740 })
  const outputPath = testInfo.outputPath('rich.html')
  await (await downloadEvent).saveAs(outputPath)
  await writeFile(testInfo.outputPath('image.png'), Buffer.from(pngPixel, 'base64'))
  await output.goto(pathToFileURL(outputPath).href)
  await expect(output.getByRole('navigation', { name: 'Table of contents' }).getByRole('link')).toHaveCount(6)
  await expect(output.getByText('Styled')).toHaveCSS('font-family', 'Georgia')
  await expect(output.getByText('Styled')).toHaveCSS('font-size', '20px')
  await expect(output.getByText('Styled')).toHaveCSS('background-color', 'rgb(255, 231, 146)')
  await expect(output.locator('p').filter({ hasText: 'Styled' })).toHaveCSS('text-align', 'right')
  for (const tag of ['strong', 'em', 'u', 's', 'sup', 'sub', 'ol[start="3"] ul', 'blockquote', 'hr']) expect(await output.locator(tag).count()).toBeGreaterThan(0)
  await expect(output.getByRole('checkbox')).toBeChecked()
  await expect(output.getByRole('checkbox')).toBeDisabled()
  await expect(output.locator('aside.callout-note')).toContainText('A directive callout.')
  await expect(output.locator('pre').filter({ hasText: ':::widget' })).toContainText('Unrecognized content')
  await expect(output.getByRole('columnheader', { name: 'Right' })).toHaveCSS('text-align', 'right')
  await expect(output.getByRole('img', { name: 'Diagram', exact: true })).toHaveAttribute('src', './image.png')
  expect(await output.getByRole('img', { name: 'Diagram', exact: true }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
  await expect(output.getByText('Caption', { exact: true })).toBeVisible()
  await expect(output.locator('code .hljs-keyword')).toHaveText('const')
  await expect(output.locator('math[display="block"] mfrac')).toBeVisible()
  await output.getByRole('link', { name: 'Anchor', exact: true }).click()
  await expect(output.locator(':target')).toHaveText('Anchor target')
  await output.locator('[data-footnote-ref]').click()
  await expect(output.locator(':target')).toContainText('A footnote.')
  await expect(output.locator('script, iframe, [onerror], [srcset]')).toHaveCount(0)
  await expect(output.getByText('Safe style')).toHaveCSS('color', 'rgb(0, 128, 0)')
  await expect(output.getByText('Safe style')).toHaveCSS('background-image', 'none')
  const svg = decodeURIComponent((await output.getByRole('img', { name: /Mermaid diagram/ }).getAttribute('src'))!.split(',')[1])
  expect(svg).not.toMatch(/javascript:|<script|onload=/i)
  expect(await output.evaluate(() => document.documentElement.scrollWidth)).toBe(420)
  await expect(output.locator('body')).toHaveCSS('background-color', 'rgb(32, 40, 35)')
  await output.emulateMedia({ media: 'print' })
  await expect(output.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
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

test('Markdown table column widths change by pointer and keyboard, persist in source and survive reload', async ({ page }) => {
  await start(page)
  await setSource(page, '# Widths\n\n| Item | Cost |\n| --- | --- |\n| Tea | 3 |\n')
  const table = visualEditor(page).getByRole('table')
  const item = table.getByRole('cell', { name: 'Tea' })
  await item.click()
  const before = (await item.boundingBox())!.width
  await page.getByRole('button', { name: 'Table controls', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Widen column/ }).click()
  await expect.poll(async () => (await item.boundingBox())!.width).toBeGreaterThan(before + 12)
  const widened = Math.round((await item.boundingBox())!.width)

  const cost = table.getByRole('cell', { name: '3' })
  const box = (await cost.boundingBox())!
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2)
  await expect(page.locator('.column-resize-handle').first()).toBeVisible()
  await page.mouse.down()
  await page.mouse.move(box.x + box.width + 60, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await cost.boundingBox())!.width).toBeGreaterThan(box.width + 40)

  await page.getByRole('button', { name: 'Markdown Source', exact: true }).click()
  await expect(sourceEditor(page)).toContainText(`colwidth="${widened}"`)
  await page.getByRole('button', { name: 'Visual Editor', exact: true }).click()
  await page.getByRole('button', { name: 'Table controls', exact: true }).click()
  await visualEditor(page).getByRole('table').getByRole('cell', { name: 'Tea' }).click()
  await page.getByRole('button', { name: 'Table controls', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reset column width' }).click()
  await expect.poll(async () => Math.round((await visualEditor(page).getByRole('cell', { name: 'Tea' }).boundingBox())!.width)).toBeLessThan(widened - 12)
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect.poll(async () => Math.round((await visualEditor(page).getByRole('cell', { name: 'Tea' }).boundingBox())!.width)).toBe(widened)
  await expect(page.getByTitle('Saved locally')).toBeVisible()
  await page.reload()
  await expect.poll(async () => Math.round((await visualEditor(page).getByRole('cell', { name: 'Tea' }).boundingBox())!.width)).toBe(widened)
})
