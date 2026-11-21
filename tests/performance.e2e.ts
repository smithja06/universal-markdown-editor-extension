import { expect, test } from '@playwright/test'

test('loads the visual equation renderer on demand and shows source while it loads', async ({ page }) => {
  let requested = false
  let release!: () => void
  const loading = new Promise<void>(resolve => { release = resolve })
  await page.route(/\/MathPreview(?:-[\w-]+)?\.[jt]sx?(?:\?.*)?$/, async route => {
    requested = true
    await loading
    await route.continue()
  })
  try {
    await page.goto('/')
    await expect(page.getByRole('textbox', { name: 'Visual document editor' })).toContainText('Welcome to Folio')
    expect(requested).toBe(false)

    await page.locator('input[accept^=".md"]').setInputFiles({ name: 'Equations.md', mimeType: 'text/markdown',
      buffer: Buffer.from('# Equations\n\nA value of $x^2$ appears in this sentence.\n') })
    await expect(page.getByRole('tab', { name: 'Equations', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.equation-inline code')).toHaveText('x^2')
    await expect.poll(() => requested).toBe(true)
    release()
    await expect(page.locator('.equation-inline math')).toBeVisible()
  } finally {
    release()
  }
})

test('source editing and undo work while optional Markdown language support loads', async ({ page }) => {
  let requested = false
  let release!: () => void
  const loading = new Promise<void>(resolve => { release = resolve })
  await page.route(/\/SourceLanguage(?:-[\w-]+)?\.[jt]s(?:\?.*)?$/, async route => {
    requested = true
    await loading
    await route.continue()
  })
  try {
    await page.goto('/')
    await expect(page.getByRole('textbox', { name: 'Visual document editor' })).toContainText('Welcome to Folio')
    expect(requested).toBe(false)
    await page.getByRole('button', { name: 'Markdown Source' }).click()
    await expect.poll(() => requested).toBe(true)
    const source = page.getByRole('textbox', { name: 'Markdown source editor' })
    await expect(source).toBeFocused()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('Temporary draft')
    await expect(source).toContainText('Temporary draft')
    release()
    await expect(source.locator('.md-heading').first()).toBeVisible()
    await page.keyboard.press('Control+Z')
    await expect(source).not.toContainText('Temporary draft')
  } finally {
    release()
  }
})

test('self-contained HTML without equations only loads the document font assets', async ({ page }) => {
  const chunks = new Set<string>()
  page.on('request', request => chunks.add(new URL(request.url()).pathname))
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Visual document editor' })).toContainText('Welcome to Folio')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Self-Contained HTML', exact: true }).click()
  await expect((await downloading).failure()).resolves.toBeNull()
  expect([...chunks].some(path => /\/exportTextFonts[.-]/.test(path))).toBe(true)
  expect([...chunks].some(path => /\/(?:exportMathFonts|MathPreview|rehype-katex|katex)[-./]/.test(path))).toBe(false)
})

test('closing the last tab releases both editor surfaces and keeps the saved draft recoverable', async ({ page }) => {
  await page.goto('/')
  const visual = page.getByRole('textbox', { name: 'Visual document editor' })
  await expect(visual).toContainText('Welcome to Folio')
  await page.getByRole('button', { name: 'Split Editor', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Markdown source editor' })
  await expect(source).toContainText('Welcome to Folio')
  await page.getByRole('button', { name: 'Close Getting started' }).click()
  await expect(page.getByRole('heading', { name: 'No open documents' })).toBeVisible()
  await expect(page.locator('.tiptap')).toHaveText('')
  await expect(page.locator('.cm-content')).toHaveText('')

  await page.getByRole('button', { name: 'Tab actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reopen closed tab' }).click()
  await expect(visual).toContainText('Welcome to Folio')
  await expect(source).toContainText('Welcome to Folio')
})
