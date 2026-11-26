import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import { appearanceMeta } from './appearance'

const assetAttribute = /\b(src|href)="\.\/(assets\/[\w./-]+)"/g

export async function webviewHtml(webview: vscode.Webview, root: vscode.Uri, format: 'Markdown' | 'TXT' | 'DOCX' | 'PDF' | 'XLSX' | 'CSV' = 'Markdown'): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'index.html'))
  const template = new TextDecoder().decode(bytes)
  const nonce = randomBytes(18).toString('base64')
  const origin = webview.cspSource
  const wasm = format === 'XLSX' || format === 'CSV' ? " 'wasm-unsafe-eval'" : ''
  const policy = [
    "default-src 'none'",
    `script-src ${origin} 'nonce-${nonce}'${wasm}`,
    `style-src ${origin} 'unsafe-inline'`,
    `img-src ${origin} data: blob:`,
    `font-src ${origin} data:`,
    'worker-src blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return template.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">\n    <meta name="folio-format" content="${format}">
    ${appearanceMeta()}`)
    .replace(/<(?:script|link)\b[^>]*>/g, tag => {
      const resolved = tag.replace(assetAttribute, (attribute: string, key: string, path: string) => {
        if (path.split('/').includes('..')) return attribute
        return `${key}="${webview.asWebviewUri(vscode.Uri.joinPath(root, path)).toString()}"`
      })
      return resolved === tag ? tag : resolved.replace(/^<script\b/, `<script nonce="${nonce}"`)
    })
}
