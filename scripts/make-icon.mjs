// Renders docs/media/icon/folio-icon.svg to the 256 × 256 PNG the Marketplace requires, using Playwright's Chromium.
// Usage: node scripts/make-icon.mjs
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const svg = await readFile('docs/media/icon/folio-icon.svg', 'utf8')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`)
  await page.locator('svg').screenshot({ path: 'extension/media/icon.png', omitBackground: true })
  console.log('wrote extension/media/icon.png')
} finally {
  await browser.close()
}
