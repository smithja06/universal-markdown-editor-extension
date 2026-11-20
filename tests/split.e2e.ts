import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const visual = (page: Page) => page.getByRole('textbox', { name: 'Visual document editor' })
const source = (page: Page) => page.getByRole('textbox', { name: 'Markdown source editor' })
const mode = (page: Page, name: 'Visual Editor' | 'Markdown Source' | 'Split Editor') =>
  page.getByRole('button', { name, exact: true }).click()
const input = (page: Page) => page.locator('input[accept^=".md"]')
const text = (page: Page) => source(page).locator('.cm-line').allTextContents().then(lines => lines.join('\n'))
const fixture = '---\ntitle: Split\nnested: [one, two]\n---\n\n# Split fixture\n\nFirst text.\n\nSecond **text**.\n\n> [!TIP]\n> Callout text.\n\n:::widget\nOpaque body.\n:::\n'

async function open(page: Page, content = fixture) {
  await page.goto('/')
  await expect(visual(page).getByRole('heading', { name: 'Welcome to Folio' })).toBeVisible()
  await input(page).setInputFiles({ name: 'Split fixture.md', mimeType: 'text/markdown', buffer: Buffer.from(content) })
  await expect(visual(page).getByRole('heading', { name: 'Split fixture' })).toBeVisible()
}

async function menu(page: Page, name: string, item: string) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

async function download(page: Page) {
  const pending = page.waitForEvent('download')
  await menu(page, 'Export', 'Download Markdown')
  return readFile(await (await pending).path())
}

test('changes all three views without altering the Markdown or remounting its editors', async ({ page }) => {
  await open(page)
  await mode(page, 'Split Editor')
  await expect(visual(page)).toBeVisible()
  await expect(source(page)).toBeVisible()
  await visual(page).evaluate(node => node.setAttribute('data-test-instance', 'visual'))
  await source(page).evaluate(node => node.setAttribute('data-test-instance', 'source'))
  for (let trip = 0; trip < 3; trip++) {
    await mode(page, 'Markdown Source')
    await expect(visual(page)).toBeHidden()
    await mode(page, 'Visual Editor')
    await expect(source(page)).toBeHidden()
    await mode(page, 'Split Editor')
    await expect(visual(page)).toBeVisible()
    await expect(source(page)).toBeVisible()
    expect(await text(page)).toBe(fixture)
  }
  await expect(visual(page)).toHaveAttribute('data-test-instance', 'visual')
  await expect(source(page)).toHaveAttribute('data-test-instance', 'source')
  expect((await download(page)).toString()).toBe(fixture)
})

test('alternates edits before the debounce and preserves independent undo and focus', async ({ page }) => {
  await open(page)
  await mode(page, 'Split Editor')
  await visual(page).getByText('First text.', { exact: true }).click()
  await page.keyboard.press('Home')
  await page.keyboard.insertText('Visual. ')
  await source(page).locator('.cm-line').filter({ hasText: 'Second' }).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' Source.')
  await expect(visual(page).getByText('Second text. Source.', { exact: true })).toBeVisible()
  await expect(source(page)).toBeFocused()
  await expect(source(page)).toContainText('Visual. First text.')
  await visual(page).getByText('Visual. First text.', { exact: true }).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(source(page)).not.toContainText('Visual. First text.')
  await expect(source(page)).toContainText('Source.')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(source(page)).toContainText('Visual. First text.')
  await source(page).focus()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(visual(page)).not.toContainText('Source.')
  await expect(visual(page)).toContainText('Visual. First text.')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(visual(page)).toContainText('Source.')
})

test('pauses an incomplete Markdown preview and autosaves the exact draft', async ({ page }) => {
  await open(page)
  await mode(page, 'Split Editor')
  await source(page).focus()
  await page.keyboard.press('ControlOrMeta+a')
  const incomplete = fixture + '\n~~~js\nlet pending = true;\n'
  await page.keyboard.insertText(incomplete)
  await expect(page.getByRole('status').filter({ hasText: 'Preview paused' })).toBeVisible()
  await expect(visual(page).getByText('First text.', { exact: true })).toBeVisible()
  await expect(visual(page)).toHaveAttribute('contenteditable', 'false')
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  expect((await download(page)).toString()).toBe(incomplete)
  await source(page).focus()
  await page.keyboard.press('ControlOrMeta+a')
  const complete = incomplete + '~~~\n'
  await page.keyboard.insertText(complete)
  await expect(visual(page).locator('pre code')).toContainText('let pending = true;')
  await expect(visual(page)).toHaveAttribute('contenteditable', 'true')
  await expect(source(page)).toBeFocused()
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()
  await page.reload()
  await expect(visual(page).locator('pre code')).toContainText('let pending = true;')
  const exported = await download(page)
  expect(exported.toString()).toBe(complete)
  await input(page).setInputFiles({ name: 'Reopened.md', mimeType: 'text/markdown', buffer: exported })
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue('Reopened')
  await expect(visual(page)).toContainText('Opaque body.')
})

test('preserves a resized ratio, keeps the sidebar accessible, and stacks on narrow screens', async ({ page }) => {
  await open(page)
  await mode(page, 'Split Editor')
  const divider = page.getByRole('separator', { name: 'Resize editor panes' })
  await expect(divider).toHaveAttribute('aria-valuenow', '50')
  const box = (await divider.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 60)
  await page.mouse.down()
  await page.mouse.move(box.x + 110, box.y + 60, { steps: 5 })
  await page.mouse.up()
  const preference = await divider.getAttribute('aria-valuenow')
  expect(Number(preference)).toBeGreaterThan(50)
  await page.getByRole('button', { name: 'Toggle document properties' }).click()
  await expect(visual(page)).toBeVisible()
  await expect(source(page)).toBeVisible()
  await page.getByRole('button', { name: 'Toggle document properties' }).click()
  expect((await download(page)).toString()).toBe(fixture)
  await page.reload()
  await mode(page, 'Split Editor')
  await expect(divider).toHaveAttribute('aria-valuenow', preference!)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(divider).toBeHidden()
  const left = (await visual(page).boundingBox())!
  const right = (await source(page).boundingBox())!
  expect(right.y).toBeGreaterThan(left.y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await expect(page.getByRole('button', { name: 'Toggle document properties' })).toBeVisible()
})

test('keeps both panes aligned by section only when Sync Scroll is enabled', async ({ page }) => {
  const long = '# Split fixture\n\n' + Array.from({ length: 32 }, (_, index) =>
    '## Section ' + (index + 1) + '\n\n' + ('Words of this section repeat to make large rendered blocks. '.repeat(index % 3 + 5)) + '\n\n',
  ).join('')
  await open(page, long)
  await mode(page, 'Split Editor')
  const left = page.locator('.visual-scroll')
  const right = page.locator('.cm-scroller')
  const sync = page.getByRole('button', { name: 'Sync Scroll' })
  const scrollTo = async (pane: typeof left, target: string, selector: string) => {
    await pane.evaluate((scroller, { target, selector }) => {
      const item = Array.from(scroller.querySelectorAll(selector)).find(node => node.textContent?.trim() === target)
      if (!item) throw new Error('Scroll target missing: ' + target)
      scroller.scrollTop += item.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8
    }, { target, selector })
  }
  const nearTop = (pane: typeof left, target: string, selector: string) =>
    pane.evaluate((scroller, { target, selector }) => {
      const item = Array.from(scroller.querySelectorAll(selector)).find(node => node.textContent?.trim() === target)
      return item ? Math.abs(item.getBoundingClientRect().top - scroller.getBoundingClientRect().top) : Infinity
    }, { target, selector })

  await expect(sync).toHaveAttribute('aria-pressed', 'false')
  await scrollTo(left, 'Section 8', 'h2')
  expect(await right.evaluate(node => node.scrollTop)).toBe(0)
  await sync.click()
  await scrollTo(left, 'Section 14', 'h2')
  await expect.poll(() => nearTop(right, '## Section 14', '.cm-line')).toBeLessThan(75)
  const sourceBox = (await right.boundingBox())!
  const scrollDelta = await right.evaluate(scroller => {
    const line = Array.from(scroller.querySelectorAll('.cm-line')).find(node => node.textContent?.trim() === '## Section 15')
    if (!line) throw new Error('Next section is outside the Markdown viewport')
    return line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8
  })
  await page.mouse.move(sourceBox.x + 90, sourceBox.y + 45)
  await page.mouse.wheel(0, scrollDelta)
  await expect.poll(() => nearTop(left, 'Section 15', 'h2')).toBeLessThan(75)
  await sync.click()
  await page.getByRole('button', { name: /H2 Section 22/ }).click()
  await expect.poll(() => nearTop(left, 'Section 22', 'h2')).toBeLessThan(40)
  await expect.poll(() => nearTop(right, '## Section 22', '.cm-line')).toBeLessThan(40)
})

test('keeps advanced formatting, diagrams, math and opaque directives live in split mode', async ({ page }) => {
  const complex = fixture + '\nInline $x^2$.\n\n~~~mermaid\nflowchart LR\n  A[First] --> B[Review]\n~~~\n\n$$\ny = x^2\n$$\n'
  await open(page, complex)
  await mode(page, 'Split Editor')
  await visual(page).getByText('First text.', { exact: true }).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await menu(page, 'Font family', 'Georgia')
  await menu(page, 'Text color', 'Forest')
  await menu(page, 'Text highlight', 'Lemon')
  await expect(source(page)).toContainText('font-family: Georgia')
  await expect(source(page)).toContainText('background-color: rgb(255, 240, 165)')
  const markdown = await text(page)
  await source(page).focus()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(markdown.replace('B[Review]', 'B[Published]').replace('y = x^2', 'y = x^3'))
  await expect(visual(page).locator('.mermaid-result svg')).toContainText('Published', { timeout: 15000 })
  await expect(visual(page).locator('.equation-block math annotation')).toHaveText('y = x^3')
  await expect(visual(page).locator('.equation-inline math annotation')).toHaveText('x^2')
  await expect(visual(page).locator('span[style]').getByText('First text.', { exact: true })).toHaveCSS('font-family', 'Georgia')
  await expect(visual(page).locator('.opaque-card')).toContainText('Opaque body.')
  await expect(source(page)).toBeFocused()
})

test('propagates rapid edits in a large document and keeps the rest intact', async ({ page }) => {
  const lines = Array.from({ length: 320 }, (_, index) => '## Chapter ' + (index + 1) + '\n\nUnchanged content ' + (index + 1) + '.\n\n')
  await open(page, '# Split fixture\n\n' + lines.join(''))
  await mode(page, 'Split Editor')
  await source(page).focus()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('Large ')
  await page.keyboard.insertText('source ')
  await page.keyboard.insertText('change.')
  await expect(visual(page).getByText('Large source change.', { exact: true })).toBeAttached({ timeout: 6000 })
  await visual(page).getByText('Large source change.', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' More')
  await page.keyboard.insertText(' visual')
  await page.keyboard.insertText(' text.')
  const contents = (await download(page)).toString()
  expect(contents).toContain('## Chapter 320\n\nUnchanged content 320.')
  expect(contents).toContain('Large source change. More visual text.')
  expect(contents.match(/^## Chapter /gm)).toHaveLength(320)
})
