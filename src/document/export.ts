import type { Root } from 'mdast'
import type { Element, Root as HtmlRoot, RootContent } from 'hast'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import { markdownProcessor } from './markdown'
import { headingSlug } from './metadata'
import { safeUrl } from '../editor/schema'
import { downloadFile, markdownFilename } from './files'

function htmlText(children: RootContent[]): string {
  return children.map(child => child.type === 'text' ? child.value : child.type === 'element' ? htmlText(child.children) : '').join('')
}

function prepareHtml() {
  return (tree: HtmlRoot) => {
    const items: { title: string; id: string }[] = []
    const used = new Set<string>()
    const toc: Element[] = []
    const walk = (nodes: RootContent[]) => {
      for (const node of nodes) {
        if (node.type !== 'element') continue
        if (/^h[1-6]$/.test(node.tagName)) {
          const title = htmlText(node.children).trim()
          const slug = headingSlug(title)
          let id = slug
          for (let suffix = 2; used.has(id); suffix++) id = slug + '-' + suffix
          used.add(id)
          node.properties.id = id
          items.push({ title, id })
        }
        if (node.tagName === 'img' && !safeUrl(String(node.properties.src ?? ''), true)) delete node.properties.src
        if (node.tagName === 'a' && !safeUrl(String(node.properties.href ?? ''))) delete node.properties.href
        if ((node.tagName === 'p' && /^\[(?:\[toc\]|toc)\]$/i.test(htmlText(node.children))) || (node.tagName === 'nav' && node.properties.dataFolioToc !== undefined)) toc.push(node)
        if (node.tagName === 'blockquote') {
          const first = node.children.find(child => child.type === 'element' && child.tagName === 'p')
          const text = first?.type === 'element' ? first.children[0] : undefined
          const kind = text?.type === 'text' ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO)\](?:\n|$)/i.exec(text.value) : null
          if (kind && text?.type === 'text') {
            node.properties.className = ['callout', 'callout-' + kind[1].toLowerCase()]
            text.value = text.value.slice(kind[0].length)
            node.children.unshift({ type: 'element', tagName: 'strong', properties: {}, children: [{ type: 'text', value: kind[1] }] })
          }
        }
        walk(node.children)
      }
    }
    walk(tree.children)
    for (const navigation of toc) {
      navigation.tagName = 'nav'
      navigation.properties.ariaLabel = 'Table of contents'
      navigation.children = [{
        type: 'element', tagName: 'ul', properties: {}, children: items.map(item => ({
          type: 'element', tagName: 'li', properties: {}, children: [{
            type: 'element', tagName: 'a', properties: { href: '#' + item.id }, children: [{ type: 'text', value: item.title }],
          }],
        })),
      }]
    }
  }
}

const style = /^((?:color|background-color|font-family|font-size|line-height|margin-bottom|margin-left|text-align)\s*:\s*[^;{}()]+(?:\([^{};]*\))?\s*;?\s*)+$/i
const sanitizer = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, src: ['https', 'http', 'data'] },
  tagNames: [...(defaultSchema.tagNames ?? []), 'aside', 'nav', 'u', 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'width', 'dataFolioBlock', 'dataFolioStyle', 'dataFolioToc', 'dataFolioCallout', 'dataFolioKind', 'dataFolioImage', 'dataFolioCaption', 'dataFolioAlign', ['style', style] as [string, RegExp], ['className', /^callout(?:-.*)?$|^image-caption$|^document-image$/i] as [string, RegExp]],
    code: [['className', /^language-./, 'math-inline', 'math-display'] as [string, RegExp, string, string]],
  },
}

const htmlProcessor = markdownProcessor().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw)
  .use(rehypeSanitize, sanitizer).use(prepareHtml).use(rehypeKatex, { output: 'mathml', trust: false, maxExpand: 1000, maxSize: 20 }).use(rehypeStringify)

export function renderMarkdownHtml(source: string) {
  const tree: Root = htmlProcessor.parse(source)
  return htmlProcessor.stringify(htmlProcessor.runSync(tree))
}

export function renderedText(source: string) {
  const template = document.createElement('template')
  template.innerHTML = renderMarkdownHtml(source)
  template.content.querySelectorAll('math').forEach(element => element.replaceWith(document.createTextNode(element.querySelector('annotation')?.textContent ?? element.textContent ?? '')))
  template.content.querySelectorAll('script,style,annotation,.katex-html').forEach(element => element.remove())
  template.content.querySelectorAll('br, p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, tr').forEach(element => element.append(document.createTextNode('\n')))
  return (template.content.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

const htmlCss = 'body{font:17px/1.7 system-ui,sans-serif;color:#202925;max-width:760px;margin:3rem auto;padding:0 1rem}h1,h2,h3{line-height:1.2}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd5d0;padding:.45em .7em}th{background:#eef3ef}pre,blockquote,.callout{padding:1em;background:#eff5f1;overflow:auto;border-radius:6px;margin:1em 0}a{color:#166a4b}.image-caption{display:block;color:#596762}.callout strong{color:#166a4b}'

export function exportHtml(title: string, source: string) {
  const titleNode = document.createElement('title')
  titleNode.textContent = title
  const output = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + titleNode.outerHTML + '<style>' + htmlCss + '</style></head><body>' + renderMarkdownHtml(source) + '</body></html>'
  downloadFile(markdownFilename(title).replace(/\.(md|markdown)$/i, '.html'), new Blob([output], { type: 'text/html;charset=utf-8' }))
}
