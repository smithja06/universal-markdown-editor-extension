import { chmod, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { test } from './desktop'

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
const bytes = Buffer.from(pixel, 'base64')
const file = 'docs/nested/picker.md'
const original = '# Picker\r\n\r\nA  *word* stays.\r\n\r\nFigure: replace\r\n'
const assetName = 'café #%(final)%2F.png'
const reference = '../../media/caf%C3%A9%20%23%25%28final%29%252F.png'

function frame(page: Page, index = 0) {
  return page.locator('iframe.webview:visible').nth(index).contentFrame().locator('iframe#active-frame').contentFrame()
}

async function fixture(workspace: string, markdown = original) {
  const media = join(workspace, 'media')
  await mkdir(join(workspace, 'docs', 'nested'), { recursive: true })
  await mkdir(media)
  await writeFile(join(media, assetName), bytes)
  await writeFile(join(workspace, file), '\uFEFF' + markdown)
  return media
}

async function imageDialog(folio: ReturnType<typeof frame>, source = false) {
  if (source) await folio.getByRole('button', { name: 'Insert image', exact: true }).click()
  else {
    await folio.getByRole('button', { name: 'Insert content', exact: true }).click()
    await folio.getByRole('menuitem', { name: 'Image or image caption' }).click()
  }
  return folio.getByRole('dialog', { name: 'Insert image' })
}

function chooser(page: Page) {
  return page.locator('.quick-input-widget input:visible')
}

async function choose(page: Page, path: string) {
  const input = chooser(page)
  await expect(input).toBeVisible()
  await input.fill(path)
  await input.press('Enter')
  await expect(input).toBeHidden()
}

test.skip(process.platform !== 'win32', 'The picker is qualified on local Windows.')
test.use({ simpleFileDialog: true })

for (const [mode, isSource, pane] of [
  ['Visual Editor', false, ''], ['Markdown Source', true, ''],
  ['Split Editor', false, ' (Visual pane)'], ['Split Editor', true, ' (Source pane)'],
] as const) {
  test(`selects a nested workspace image in ${mode}${pane} and preserves exact native history`, async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const initial = isSource ? original : original.replace('Figure: replace', '+ Figure: replace')
    const media = await fixture(workspace, initial)
    const asset = join(media, assetName)
    await command('open', { file, editor: 'folio' })
    const folio = frame(page)
    const visual = folio.getByRole('textbox', { name: 'Visual document editor' })
    const source = folio.getByRole('textbox', { name: 'Markdown source editor' })
    await expect(visual.getByRole('heading', { name: 'Picker' })).toBeVisible()
    if (mode !== 'Visual Editor') await folio.getByRole('button', { name: mode, exact: true }).click()
    const editor = isSource ? source : visual
    const paragraph = editor.getByText('Figure: replace', { exact: true })
    await paragraph.click()
    await paragraph.evaluate(element => {
      const text = element.firstChild!
      element.ownerDocument.getSelection()!.setBaseAndExtent(text, 'Figure: '.length, text, text.textContent!.length)
    })
    await expect.poll(() => editor.evaluate(element => element.ownerDocument.getSelection()?.toString())).toBe('replace')

    const dialog = await imageDialog(folio, isSource)
    await dialog.getByRole('button', { name: 'Browse workspace images' }).click()
    await choose(page, asset)
    await expect(dialog.getByLabel('Image URL')).toHaveValue(reference)
    await expect.poll(async () => (await read(file)).text).toBe(initial)
    await dialog.getByLabel('Alternative text').fill('Picked image')
    await dialog.getByLabel('Alternative text').press('Enter')
    await expect(dialog).toBeHidden()
    const edited = initial.replace('replace', `![Picked image](${reference})`)
    await expect.poll(async () => (await read(file)).text).toBe(edited)
    if (mode === 'Markdown Source') await folio.getByRole('button', { name: 'Split Editor', exact: true }).click()
    await expect.poll(() => visual.getByRole('img', { name: 'Picked image' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)

    async function unchanged() {
      expect(await readFile(asset)).toEqual(bytes)
      expect(await readdir(media)).toEqual([assetName])
      expect((await readdir(workspace)).sort()).toEqual(['docs', 'media'])
    }
    await unchanged()
    expect(await readFile(join(workspace, file))).toEqual(Buffer.from('\uFEFF' + initial))
    await command('saveDocument', { file })
    expect(await readFile(join(workspace, file))).toEqual(Buffer.from('\uFEFF' + edited))
    await unchanged()
    await command('undo')
    await expect.poll(async () => (await read(file)).text).toBe(initial)
    await unchanged()
    await command('redo')
    await expect.poll(async () => (await read(file)).text).toBe(edited)
    await unchanged()
  })
}

test('cancels the picker without changing Markdown and keeps manual entry available', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  await fixture(workspace)
  await command('open', { file, editor: 'folio' })
  const dialog = await imageDialog(frame(page))
  await dialog.getByLabel('Image URL').fill(reference)
  await dialog.getByRole('button', { name: 'Browse workspace images' }).click()
  await expect(chooser(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('button', { name: 'Browse workspace images' })).toBeEnabled()
  await expect(dialog.getByLabel('Image URL')).toHaveValue(reference)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await read(file)).text).toBe(original)
})

test('rejects a pending selection after a native edit and preserves both views', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  const media = await fixture(workspace)
  await command('open', { file, editor: 'folio', column: 1 })
  const first = await imageDialog(frame(page))
  await command('open', { file, editor: 'folio', column: 2 })
  const dialog = await imageDialog(frame(page, 1))
  await dialog.getByRole('button', { name: 'Browse workspace images' }).click()
  await expect(chooser(page)).toBeVisible()
  await first.getByRole('button', { name: 'Browse workspace images' }).evaluate(button => (button as HTMLButtonElement).click())
  await expect(first.getByRole('alert')).toContainText('An image picker is already open')
  await command('insert', { file, offset: original.indexOf('Picker') + 'Picker'.length, text: ' changed' })
  await choose(page, join(media, assetName))
  await expect(dialog.getByRole('alert')).toContainText(/document changed/i)
  await expect(dialog.getByLabel('Image URL')).toHaveValue('')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await first.getByRole('button', { name: 'Cancel', exact: true }).click()
  const headings = page.locator('iframe.webview:visible')
  await expect(headings).toHaveCount(2)
  for (let index = 0; index < 2; index++) {
    await expect(headings.nth(index).contentFrame().locator('iframe#active-frame').contentFrame()
      .getByRole('heading', { name: 'Picker changed' })).toBeVisible()
  }
  expect((await read(file)).text).toBe(original.replace('Picker', 'Picker changed'))
})

test('invalidates a selection when a native edit and Undo restore the original text', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  const media = await fixture(workspace)
  await command('open', { file, editor: 'folio' })
  const dialog = await imageDialog(frame(page))
  await dialog.getByRole('button', { name: 'Browse workspace images' }).click()
  await choose(page, join(media, assetName))
  await expect(dialog.getByLabel('Image URL')).toHaveValue(reference)
  const { version } = await read(file)
  await command('insert', { file, offset: original.indexOf('Picker') + 'Picker'.length, text: ' changed' })
  await command('undo')
  await expect.poll(async () => (await read(file)).text).toBe(original)
  expect((await read(file)).version).toBeGreaterThan(version)
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(/document or selection changed/i)
  expect((await read(file)).text).toBe(original)
})

test.describe('selection rejection', () => {
  test.use({ secondWorkspace: true })

  test('rejects another root, out-of-root paths, junction escapes, and invalid or oversized images', async ({ desktop }) => {
    const { page, workspace, command, read } = desktop
    const media = await fixture(workspace)
    const outside = dirname(workspace)
    const otherRoot = join(outside, 'second-workspace')
    await writeFile(join(outside, 'outside.png'), bytes)
    await writeFile(join(otherRoot, 'other.png'), bytes)
    await symlink(otherRoot, join(media, 'linked'), 'junction')
    await writeFile(join(media, 'bad.png'), '<svg/>')
    await writeFile(join(media, 'truncated.png'), bytes.subarray(0, 8))
    await writeFile(join(media, 'large.png'), Buffer.concat([bytes, Buffer.alloc(5 * 1024 * 1024)]))
    await writeFile(join(media, 'vector.svg'), '<svg/>')
    await command('open', { file, editor: 'folio' })
    const dialog = await imageDialog(frame(page))
    await dialog.getByRole('button', { name: 'Browse workspace images' }).click()
    await choose(page, join(media, assetName))
    await expect(dialog.getByLabel('Image URL')).toHaveValue(reference)
    await dialog.getByLabel('Image URL').fill('')
    for (const [candidate, error] of [
      [join(otherRoot, 'other.png'), /same workspace folder/],
      [join(outside, 'outside.png'), /same workspace folder/],
      [join(media, 'linked', 'other.png'), /linked paths|outside the workspace/i],
      [join(media, 'bad.png'), /does not match/],
      [join(media, 'truncated.png'), /could not be decoded/],
      [join(media, 'large.png'), /5 MiB/],
      [join(media, 'vector.svg'), /Select a PNG/],
    ] as const) {
      await dialog.getByRole('button', { name: 'Browse workspace images' }).click()
      await choose(page, candidate)
      await expect(dialog.getByRole('alert')).toContainText(error)
      await expect(dialog.getByLabel('Image URL')).toHaveValue('')
    }
    expect((await read(file)).text).toBe(original)
  })
})

test('revalidates the selected image at Insert and refuses changed or missing files', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  const media = await fixture(workspace)
  const asset = join(media, assetName)
  await command('open', { file, editor: 'folio' })
  const dialog = await imageDialog(frame(page))
  const browse = dialog.getByRole('button', { name: 'Browse workspace images' })
  const insert = dialog.getByRole('button', { name: 'Insert', exact: true })
  await browse.click()
  await choose(page, asset)
  await expect(dialog.getByLabel('Image URL')).toHaveValue(reference)
  await writeFile(asset, Buffer.concat([bytes, Buffer.from('changed')]))
  await insert.click()
  await expect(dialog.getByRole('alert')).toContainText(/selected image changed/i)
  await browse.click()
  await choose(page, asset)
  await expect(insert).toBeEnabled()
  await rename(asset, join(media, 'moved.png'))
  await insert.click()
  await expect(dialog.getByRole('alert')).toContainText(/missing or unavailable/)
  expect((await read(file)).text).toBe(original)
})

test('leaves read-only Markdown unchanged and explains the restriction', async ({ desktop }) => {
  const { page, workspace, command, read } = desktop
  await fixture(workspace)
  const path = join(workspace, file)
  await chmod(path, 0o444)
  try {
    await command('open', { file, editor: 'folio' })
    const dialog = await imageDialog(frame(page))
    await dialog.getByRole('button', { name: 'Browse workspace images' }).click()
    await expect(dialog.getByRole('alert')).toContainText(/Markdown document is read-only/)
    expect((await read(file)).text).toBe(original)
  } finally { await chmod(path, 0o666) }
})

test.describe('unsupported workspace provider', () => {
  test.use({ virtualWorkspace: true })

  test('keeps manual references available without opening a picker on a synthetic provider', async ({ desktop }) => {
    const { page, command } = desktop
    await command('addVirtualWorkspace', { markdown: '# Provider\n', pixel })
    await command('open', { file: 'source.md', editor: 'folio', virtual: 1 })
    const dialog = await imageDialog(frame(page))
    await dialog.getByRole('button', { name: 'Browse workspace images' }).click()
    await expect(dialog.getByRole('alert')).toContainText('local Windows workspace')
    await expect(chooser(page)).toHaveCount(0)
    await dialog.getByLabel('Image URL').fill('../media/pixel.png')
    await dialog.getByLabel('Alternative text').fill('Provider pixel')
    await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
    await expect(frame(page).getByRole('img', { name: 'Provider pixel' })).toHaveAttribute('src', `data:image/png;base64,${pixel}`)
  })
})
