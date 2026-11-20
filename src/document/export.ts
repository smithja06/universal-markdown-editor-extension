import type { Root } from 'mdast'
import type { Element, Root as HtmlRoot, RootContent } from 'hast'
import remarkRehype, { type Options } from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import { markdownProcessor } from './markdown'
import DOMPurify from 'dompurify'
import { headingSlug, readMetadata } from './metadata'
import { calloutKinds, safeUrl } from '../editor/schema'
import { downloadFile, markdownFilename } from './files'
import { renderDiagram } from './diagrams'
import htmlCss from './export.css?raw'

function htmlText(children: RootContent[]): string {
  return children.map(child => child.type === 'text' ? child.value : child.type === 'element' ? htmlText(child.children) : '').join('')
}

const element = (tagName: string, children: Element['children'], properties: Element['properties'] = {}): Element => ({
  type: 'element', tagName, properties, children,
})
const text = (value: string) => ({ type: 'text' as const, value })
const calloutKind = (value: unknown) => calloutKinds.find(kind => kind === String(value).toLowerCase())

const directiveSources = new WeakMap<object, string>()
function captureDirectives() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value)
    function visit(node: Root | Root['children'][number]) {
      if (node.type === 'containerDirective' || node.type === 'leafDirective' || node.type === 'textDirective') {
        const start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start !== undefined && end !== undefined) directiveSources.set(node, source.slice(start, end))
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}

const directive: NonNullable<NonNullable<Options['handlers']>['containerDirective']> = (state, node) => {
  if (node.type === 'containerDirective' && calloutKind(node.name)) {
    return element('aside', state.all(node), { dataFolioCallout: '', dataFolioKind: node.name.toLowerCase() })
  }
  const literal = directiveSources.get(node) ?? htmlText(state.all(node))
  return element(node.type === 'textDirective' ? 'code' : 'pre', [text(literal)], { className: ['markdown-directive'] })
}

const supportedStyles = ['color', 'background-color', 'font-family', 'font-size', 'line-height', 'margin-bottom', 'margin-left', 'text-align', 'width', 'min-width']

function safeStyles(value: string) {
  const style = document.createElement('span').style
  style.cssText = value
  return supportedStyles.flatMap(key => {
    const parsed = style.getPropertyValue(key)
    // Keep literal values and CSS color functions. Exclude resource URLs and indirect values.
    const hasFunction = /[()]/.test(parsed)
    const isColor = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([\w\d.%+\- ,/]+\)$/i.test(parsed)
    return parsed && (!hasFunction || isColor) ? [`${key}: ${parsed}`] : []
  }).join('; ')
}

function prepareHtml() {
  return (tree: HtmlRoot) => {
    const items: { title: string; id: string }[] = []
    const used = new Set<string>()
    const toc: Element[] = []
    const links: Element[] = []
    const ids = new Map<string, string>()
    const styleClasses = { title: 'document-title', subtitle: 'document-subtitle' } as const
    const walk = (nodes: RootContent[], inFootnotes = false) => {
      for (const node of nodes) {
        if (node.type !== 'element') continue
        const properties = node.properties
        if (typeof properties.id === 'string') {
          ids.set(properties.id.slice(defaultSchema.clobberPrefix?.length ?? 0), properties.id)
          used.add(properties.id)
        }
        if (/^h[1-6]$/.test(node.tagName)) {
          const title = htmlText(node.children).trim()
          const slug = headingSlug(title)
          let id = String(properties.id ?? slug)
          if (!properties.id) {
            for (let suffix = 2; used.has(id); suffix++) id = slug + '-' + suffix
            used.add(id)
            properties.id = id
          }
          if (!inFootnotes) items.push({ title, id })
        }
        if (typeof properties.style === 'string') {
          const style = safeStyles(properties.style)
          if (style) properties.style = style
          else delete properties.style
        }
        if ((node.tagName === 'td' || node.tagName === 'th') && typeof properties.align === 'string') {
          if (/^(left|center|right)$/.test(properties.align) && !String(properties.style ?? '').includes('text-align:')) {
            properties.style = [properties.style, `text-align: ${properties.align}`].filter(Boolean).join('; ')
          }
          delete properties.align
        }
        if (node.tagName === 'img') {
          if (!safeUrl(String(properties.src ?? ''), true)) delete properties.src
          properties.alt ??= ''
        }
        if (node.tagName === 'a') {
          if (!safeUrl(String(properties.href ?? ''))) delete properties.href
          else if (String(properties.href).startsWith('#')) links.push(node)
        }
        if (node.tagName === 'code' && Array.isArray(properties.className)) {
          properties.className = properties.className.map(name => String(name).toLowerCase() === 'language-mermaid' ? 'language-mermaid' : name)
        }
        if ((node.tagName === 'p' && /^\[(?:\[toc\]|toc)\]$/i.test(htmlText(node.children))) || (node.tagName === 'nav' && properties.dataFolioToc !== undefined)) toc.push(node)
        if (properties.dataFolioStyle === 'title' || properties.dataFolioStyle === 'subtitle') properties.className = [styleClasses[properties.dataFolioStyle]]
        if (properties.dataFolioImage !== undefined) {
          const align = String(properties.dataFolioAlign ?? '')
          properties.className = ['document-image', ...(/^(left|center|right)$/.test(align) ? [`image-${align}`] : [])]
        }
        if (properties.dataFolioDiagram !== undefined) {
          node.tagName = 'pre'
          node.children = [element('code', [text(String(properties.dataFolioValue ?? htmlText(node.children)) + '\n')], { className: ['language-mermaid'] })]
        }
        if (properties.dataFolioInlineMath !== undefined || properties.dataFolioBlockMath !== undefined) {
          const block = properties.dataFolioBlockMath !== undefined
          const code = element('code', [text(String(properties.dataFolioValue ?? htmlText(node.children)))], { className: [block ? 'math-display' : 'math-inline'] })
          node.tagName = block ? 'pre' : 'code'
          node.properties = block ? {} : code.properties
          node.children = block ? [code] : code.children
        }
        if (node.tagName === 'aside' && properties.dataFolioCallout !== undefined) {
          const kind = calloutKind(properties.dataFolioKind) ?? 'note'
          properties.className = ['callout', `callout-${kind}`]
          const label = node.children.find(child => child.type === 'element' && Array.isArray(child.properties.className) && child.properties.className.includes('callout-label'))
          if (!label) node.children.unshift(element('strong', [text(kind[0].toUpperCase() + kind.slice(1))], { className: ['callout-label'] }))
        }
        if (node.tagName === 'li') {
          const first = node.children.find(child => child.type === 'element')
          const checkbox = first?.type === 'element' && first.tagName === 'p' ? first.children.find(child => child.type === 'element') : first
          if (checkbox?.type === 'element' && checkbox.tagName === 'input') checkbox.properties.ariaLabel ??= htmlText(node.children.filter(child => child.type !== 'element' || !['ol', 'ul'].includes(child.tagName))).trim()
        }
        if ((node.tagName === 'ul' && properties.dataType === 'taskList') || (node.tagName === 'li' && properties.dataType === 'taskItem')) {
          properties.className = [node.tagName === 'ul' ? 'contains-task-list' : 'task-list-item']
        }
        if (node.tagName === 'blockquote') {
          const first = node.children.find(child => child.type === 'element' && child.tagName === 'p')
          const marker = first?.type === 'element' ? first.children[0] : undefined
          const kind = marker?.type === 'text' ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO)\](?:\n|$)/i.exec(marker.value) : null
          if (kind && marker?.type === 'text') {
            node.properties.className = ['callout', 'callout-' + kind[1].toLowerCase()]
            marker.value = marker.value.slice(kind[0].length)
            node.children.unshift(element('strong', [text(kind[1])], { className: ['callout-label'] }))
          }
        }
        for (const property of Object.keys(properties)) if (property.startsWith('dataFolio') && property !== 'dataFolioBlock') delete properties[property]
        walk(node.children, inFootnotes || properties.dataFootnotes !== undefined)
      }
    }
    walk(tree.children)
    for (const link of links) {
      const raw = String(link.properties.href).slice(1)
      let decoded = raw
      try { decoded = decodeURIComponent(raw) } catch { /* Keep an invalid escape as literal text. */ }
      const target = ids.get(raw) ?? ids.get(decoded)
      if (target && !used.has(raw) && !used.has(decoded)) link.properties.href = '#' + target
    }
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

const sanitizer = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, href: ['https', 'http', 'mailto', 'tel'], src: ['https', 'http', 'data'] },
  strip: [...(defaultSchema.strip ?? []), 'style', 'iframe', 'object', 'embed', 'template'],
  tagNames: [...(defaultSchema.tagNames ?? []), 'aside', 'nav', 'u', 'mark', 'label', 'colgroup', 'col', 'figure', 'figcaption', 'caption'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style', 'dataFolioBlock', 'dataFolioStyle', 'dataFolioToc', 'dataFolioCallout', 'dataFolioKind', 'dataFolioImage', 'dataFolioAlign', 'dataFolioValue', 'dataFolioDiagram', 'dataFolioInlineMath', 'dataFolioBlockMath', ['className', /^(?:callout(?:-[a-z]+)?|image-caption|document-image|markdown-directive)$/i] as [string, RegExp]],
    code: [['className', /^language-./, 'math-inline', 'math-display'] as [string, RegExp, string, string]],
    ul: [...(defaultSchema.attributes?.ul ?? []), ['dataType', 'taskList'] as [string, string]],
    li: [...(defaultSchema.attributes?.li ?? []), ['dataType', 'taskItem'] as [string, string]],
  },
}

function htmlProcessor(output: 'mathml' | 'htmlAndMathml') {
  return markdownProcessor().use(captureDirectives).use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '', handlers: {
    containerDirective: directive, leafDirective: directive, textDirective: directive,
  } }).use(rehypeRaw).use(rehypeSanitize, sanitizer).use(prepareHtml)
    .use(rehypeKatex, { output, trust: false, maxExpand: 1000, maxSize: 20 }).use(rehypeStringify)
}

const nativeHtml = htmlProcessor('mathml')
const portableHtml = htmlProcessor('htmlAndMathml')

function renderBody(source: string, selfContained = false) {
  const processor = selfContained ? portableHtml : nativeHtml
  const tree: Root = processor.parse(source)
  return { html: processor.stringify(processor.runSync(tree, source)), metadata: tree.children.find(node => node.type === 'yaml')?.value ?? '' }
}

export function renderMarkdownHtml(source: string) {
  return renderBody(source).html
}

export function renderedText(source: string) {
  const template = document.createElement('template')
  template.innerHTML = renderMarkdownHtml(source)
  template.content.querySelectorAll('math').forEach(element => element.replaceWith(document.createTextNode(element.querySelector('annotation')?.textContent ?? element.textContent ?? '')))
  template.content.querySelectorAll('script,style,annotation,.katex-html').forEach(element => element.remove())
  template.content.querySelectorAll('br, p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, tr').forEach(element => element.append(document.createTextNode('\n')))
  return (template.content.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

function trimFolioMarkup(body: DocumentFragment) {
  body.querySelectorAll('[data-folio-block]').forEach(wrapper => {
    wrapper.removeAttribute('data-folio-block')
    if (wrapper.localName === 'div' && !wrapper.attributes.length) wrapper.replaceWith(...wrapper.childNodes)
  })
  body.querySelectorAll('p').forEach(paragraph => {
    const wrapper = paragraph.firstElementChild
    if (!(wrapper instanceof HTMLElement) || !wrapper.matches('.document-image') || paragraph.children.length !== 1 ||
      Array.from(paragraph.childNodes).some(child => child !== wrapper && child.textContent?.trim())) return
    const figure = document.createElement('figure')
    figure.className = wrapper.className
    const caption = wrapper.querySelector('.image-caption')
    if (caption) {
      const figcaption = document.createElement('figcaption')
      figcaption.append(...caption.childNodes)
      caption.replaceWith(figcaption)
    }
    figure.append(...wrapper.childNodes)
    if (paragraph.id) figure.id = paragraph.id
    if (paragraph.getAttribute('style')) figure.style.cssText = paragraph.style.cssText
    paragraph.replaceWith(figure)
  })
  body.querySelectorAll('table').forEach(table => {
    const wrapper = document.createElement('div')
    wrapper.className = 'table-scroll'
    wrapper.tabIndex = 0
    wrapper.setAttribute('role', 'region')
    wrapper.setAttribute('aria-label', table.caption?.textContent?.trim() || 'Table')
    table.replaceWith(wrapper)
    wrapper.append(table)
  })
}

let exportDiagramId = 0
async function renderDiagrams(blocks: HTMLElement[]) {
  let failed = 0
  for (const code of blocks) {
    const source = code.textContent ?? ''
    const pre = code.parentElement!
    try {
      const svg = await renderDiagram('folio-export-diagram-' + ++exportDiagramId, source, { mode: 'export' })
      const sanitized = DOMPurify.sanitize(svg ?? '', {
        USE_PROFILES: { html: true, svg: true, svgFilters: true },
        ADD_TAGS: ['foreignobject'],
        HTML_INTEGRATION_POINTS: { foreignobject: true },
        FORBID_TAGS: ['script', 'image', 'img', 'picture', 'source', 'object', 'embed', 'iframe', 'audio', 'video', 'animate', 'animatetransform', 'set'],
        RETURN_DOM_FRAGMENT: true,
      }).querySelector('svg')
      if (!sanitized) throw new Error('No SVG was rendered.')
      for (const node of sanitized.querySelectorAll('[href], [xlink\\:href]')) {
        for (const attribute of ['href', 'xlink:href']) {
          if (node.hasAttribute(attribute) && !node.getAttribute(attribute)?.startsWith('#')) node.removeAttribute(attribute)
        }
      }
      // Image context isolates the diagram's SVG and CSS from the exported document.
      const image = document.createElement('img')
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sanitized.outerHTML)
      image.alt = 'Mermaid diagram: ' + (sanitized.querySelector('title')?.textContent?.trim() || source.trim().split('\n', 1)[0])
      const figure = document.createElement('figure')
      figure.className = 'diagram'
      figure.append(image)
      pre.replaceWith(figure)
    } catch {
      failed++
      const details = document.createElement('details')
      details.open = true
      const summary = document.createElement('summary')
      summary.textContent = 'Mermaid diagram could not be rendered. Original source follows.'
      pre.replaceWith(details)
      details.append(summary, pre)
    }
  }
  return failed
}

function prepareImages(body: DocumentFragment, selfContained: boolean) {
  let unavailable = 0
  if (selfContained) body.querySelectorAll('picture > source').forEach(source => source.remove())
  body.querySelectorAll('img').forEach(image => {
    const src = image.getAttribute('src')
    if (src && (!selfContained || /^data:/i.test(src))) return
    const picture = image.parentElement?.matches('picture') ? image.parentElement : undefined
    if (!selfContained && picture?.querySelector('source[srcset]')) return
    unavailable++
    const message = document.createElement('span')
    message.className = 'missing-image'
    message.textContent = `${selfContained ? 'Image unavailable offline' : 'Image unavailable'}${image.alt ? `: ${image.alt}` : ''}`
    if (src) {
      const link = document.createElement('a')
      link.href = src
      link.textContent = 'Original image'
      message.append(' (', link, ')')
    }
    const placeholderTarget = picture ?? image
    placeholderTarget.replaceWith(message)
  })
  return unavailable
}

async function highlightCode(body: DocumentFragment) {
  const blocks = Array.from(body.querySelectorAll<HTMLElement>('pre > code[class*="language-"]:not(.language-mermaid)'))
  if (!blocks.length) return
  const { default: highlighter } = await import('highlight.js/lib/common')
  for (const code of blocks) {
    const language = Array.from(code.classList).find(value => value.startsWith('language-'))?.slice(9)
    if (language && highlighter.getLanguage(language)) {
      code.innerHTML = highlighter.highlight(code.textContent ?? '', { language, ignoreIllegals: true }).value
    }
  }
}

export async function renderVersionPreview(source: string) {
  const template = document.createElement('template')
  template.innerHTML = renderMarkdownHtml(source)
  trimFolioMarkup(template.content)
  prepareImages(template.content, true)
  template.content.querySelectorAll('a[href]').forEach(link => {
    if (!link.getAttribute('href')?.startsWith('#')) link.removeAttribute('href')
  })
  await Promise.all([
    renderDiagrams(Array.from(template.content.querySelectorAll('pre > code.language-mermaid'))),
    highlightCode(template.content),
  ])
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
    '<style>' + htmlCss + 'main{margin:1rem auto;font:16px/1.65 system-ui,sans-serif}</style></head><body><main>' + template.innerHTML + '</main></body></html>'
}

interface ExportAppearance { fontFamily: string; fontSize: number; lineHeight: number }

export async function exportHtml(title: string, source: string, selfContained: boolean, appearance: ExportAppearance) {
  const { html, metadata } = renderBody(source, selfContained)
  const template = document.createElement('template')
  template.innerHTML = html
  trimFolioMarkup(template.content)
  const unavailableImages = prepareImages(template.content, selfContained)
  const [failedDiagrams] = await Promise.all([
    renderDiagrams(Array.from(template.content.querySelectorAll('pre > code.language-mermaid'))),
    highlightCode(template.content),
  ])

  const output = document.implementation.createHTMLDocument()
  const { fields } = readMetadata(metadata)
  const lang = fields.get('lang')
  output.documentElement.lang = typeof lang === 'string' && /^[a-z]{2,8}(?:-[a-z\d]{1,8})*$/i.test(lang) ? lang : 'en'
  const documentTitle = fields.get('title')
  output.title = typeof documentTitle === 'string' && documentTitle.trim() ? documentTitle : title
  const meta = (attributes: Record<string, string>) => {
    const tag = output.createElement('meta')
    for (const [name, value] of Object.entries(attributes)) tag.setAttribute(name, value)
    return tag
  }
  const imageSources = selfContained ? 'data:' : 'data: https: http: file:'
  output.head.prepend(meta({ charset: 'utf-8' }), meta({ 'http-equiv': 'Content-Security-Policy', content: `default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'` }))
  output.head.append(meta({ name: 'viewport', content: 'width=device-width, initial-scale=1' }))
  for (const name of ['description', 'author', 'tags']) {
    const value = fields.get(name)
    const content = Array.isArray(value) ? value.filter(item => typeof item === 'string').join(', ') : typeof value === 'string' ? value : ''
    if (content) output.head.append(meta({ name: name === 'tags' ? 'keywords' : name, content }))
  }
  const css = output.createElement('style')
  css.textContent = htmlCss
  if (selfContained) {
    const math = !!template.content.querySelector('.katex-html')
    const inter = appearance.fontFamily.includes('Inter Variable') || html.includes('Inter Variable')
    if (math || inter) {
      const { fontStyles } = await import('./exportFonts')
      css.textContent += fontStyles({ math, inter })
    }
  }
  output.head.append(css)
  const main = output.createElement('main')
  main.style.fontFamily = appearance.fontFamily
  main.style.fontSize = `${appearance.fontSize}px`
  main.style.lineHeight = String(appearance.lineHeight)
  main.append(template.content)
  output.body.append(main)

  const suffix = selfContained ? '-self-contained.html' : '.html'
  downloadFile(markdownFilename(title).replace(/\.(md|markdown)$/i, suffix), new Blob(['<!doctype html>\n' + output.documentElement.outerHTML], { type: 'text/html;charset=utf-8' }))
  return { failedDiagrams, unavailableImages }
}
