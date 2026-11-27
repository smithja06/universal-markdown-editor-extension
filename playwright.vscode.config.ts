import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/vscode',
  testMatch: process.env.FOLIO_BENCHMARK === '1' ? '**/*.bench.ts' : process.env.FOLIO_SCREENSHOTS === '1' ? '**/*.screens.ts' : '**/*.vscode.ts',
  outputDir: 'test-results/vscode',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
})
