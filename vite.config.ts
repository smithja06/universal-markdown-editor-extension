import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Pre-bundle lazily loaded format engines so the dev server does not reload on first use.
  optimizeDeps: { include: ['pdfjs-dist/legacy/build/pdf.mjs', 'pdfmake/build/pdfmake.min.js'] },
  test: { environment: 'jsdom' },
})
