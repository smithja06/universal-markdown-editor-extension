import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { test } from './desktop'

test('keeps native Markdown spacing when a visual edit returns to an earlier snapshot', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  const file = 'fidelity.md'
  const original = '# Title A\n\n**Keep**\n'
  await writeFile(join(workspace, file), original)
  await command('open', { file, editor: 'folio' })
  const frame = page.locator('iframe.webview').first().contentFrame().locator('iframe#active-frame').contentFrame()
  const visual = frame.getByRole('textbox', { name: 'Visual document editor' })
  const source = frame.getByRole('textbox', { name: 'Markdown source editor' })
  await expect(visual.getByRole('heading', { name: 'Title A' })).toBeVisible()
  await frame.getByRole('button', { name: 'Split Editor', exact: true }).click()
  await expect(source).toBeVisible()

  const endOfLine = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
  async function replaceTitleLetter(current: string, letter: string) {
    await visual.getByRole('heading', { name: current }).click()
    await page.keyboard.press(endOfLine)
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.insertText(letter)
  }

  await replaceTitleLetter('Title A', 'B')
  await expect.poll(async () => (await read(file)).text).toBe('# Title B\n\n**Keep**\n')
  await command('insert', { file, offset: original.indexOf('**Keep**'), text: '  ' })
  await expect.poll(async () => (await source.locator('.cm-line').allTextContents()).join('\n')).toBe('# Title B\n\n  **Keep**\n')

  await replaceTitleLetter('Title B', 'A')
  await expect.poll(async () => (await read(file)).text).toBe('# Title A\n\n  **Keep**\n')
})
