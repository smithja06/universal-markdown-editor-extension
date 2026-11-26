import type { PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist'
import type { PdfHandle, PdfLib } from '../../document/formats/pdf/engine'
import { pdfLimits } from '../../document/formats/pdf/model'
import { hasText, itemRanges, type PdfMatch, type PdfPageText } from '../../document/formats/pdf/text'

interface PageSlot {
  index: number
  element: HTMLDivElement
  canvas?: HTMLCanvasElement
  text?: HTMLDivElement
  layer?: TextLayer
  task?: RenderTask
  rendering?: Promise<void>
  scale?: number
  width: number
  height: number
  measured: boolean
  proxy?: PDFPageProxy
  used: number
  textless?: boolean
}

export interface PdfPagesEvents {
  page(index: number): void
  rendered(index: number): void
  error(message: string): void
}

const gap = 16
const highlightName = 'folio-pdf-match'
const activeHighlightName = 'folio-pdf-active'

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void }
function highlights(): HighlightRegistry | undefined {
  const css = globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined
  return typeof globalThis.Highlight === 'function' ? css?.highlights : undefined
}

/**
 * Renders only pages near the viewport, with bounded concurrency and canvas size.
 * Annotation layers are never created, so links, form widgets and scripts stay inert.
 */
export class PdfPages {
  private readonly slots: PageSlot[] = []
  private readonly observer: IntersectionObserver
  private readonly visible = new Set<number>()
  private scale = 1
  private running = 0
  private clock = 0
  private disposed = false
  private matches: PdfMatch[] = []
  private active = -1
  private pendingScroll?: PdfMatch
  private measuring?: Promise<void>
  private ownsHighlights = false

  constructor(private readonly scroller: HTMLElement, private readonly content: HTMLElement, private readonly handle: PdfHandle,
    private readonly lib: PdfLib, private readonly events: PdfPagesEvents, private readonly showTextless = true) {
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.pageIndex)
        if (entry.isIntersecting) this.visible.add(index)
        else this.visible.delete(index)
      }
      this.schedule()
    }, { root: scroller, rootMargin: '75% 0px' })
  }

  async initialize() {
    const first = await this.handle.page(0)
    const base = first.getViewport({ scale: 1 })
    for (let index = 0; index < this.handle.pageCount; index++) {
      const element = document.createElement('div')
      element.className = 'pdf-page'
      element.dataset.pageIndex = String(index)
      element.dataset.pageNumber = String(index + 1)
      element.setAttribute('role', 'region')
      element.setAttribute('aria-label', `Page ${index + 1} of ${this.handle.pageCount}`)
      const slot: PageSlot = { index, element, width: base.width, height: base.height, measured: index === 0, used: 0 }
      if (index === 0) slot.proxy = first
      this.slots.push(slot)
      this.content.append(element)
      this.observer.observe(element)
    }
    this.layout()
    this.measuring = this.measure()
  }

  /** Reads remaining page sizes in the background so rotated or mixed-size pages lay out correctly. */
  private async measure() {
    for (const slot of this.slots) {
      if (this.disposed) return
      if (slot.measured) continue
      try {
        const page = await this.handle.page(slot.index)
        const viewport = page.getViewport({ scale: 1 })
        slot.measured = true
        if (Math.abs(viewport.width - slot.width) > 0.5 || Math.abs(viewport.height - slot.height) > 0.5) {
          slot.width = viewport.width
          slot.height = viewport.height
          const anchor = this.currentPage()
          const offset = this.scroller.scrollTop - this.slots[anchor].element.offsetTop
          this.layout(slot.index)
          this.scroller.scrollTop = this.slots[anchor].element.offsetTop + offset
        }
      } catch { /* The page reports its error when it is rendered. */ }
      if (slot.index % 25 === 0) await new Promise(resolve => setTimeout(resolve))
    }
  }

  get pageCount() { return this.slots.length }
  pageSize(index: number) { const slot = this.slots[index]; return slot && { width: slot.width, height: slot.height } }
  get maxWidth() { return Math.max(...this.slots.map(slot => slot.width)) }

  private layout(only?: number) {
    for (const slot of only === undefined ? this.slots : [this.slots[only]]) {
      slot.element.style.width = Math.floor(slot.width * this.scale) + 'px'
      slot.element.style.height = Math.floor(slot.height * this.scale) + 'px'
      slot.element.style.setProperty('--total-scale-factor', String(this.scale))
    }
  }

  setScale(scale: number) {
    const next = Math.min(pdfLimits.maxZoom, Math.max(pdfLimits.minZoom, scale))
    if (Math.abs(next - this.scale) < 0.001) return
    const anchor = this.currentPage()
    const slot = this.slots[anchor]
    const ratio = slot ? (this.scroller.scrollTop - slot.element.offsetTop) / Math.max(1, slot.element.offsetHeight) : 0
    this.scale = next
    this.layout()
    if (slot) this.scroller.scrollTop = slot.element.offsetTop + ratio * slot.element.offsetHeight
    this.schedule()
  }

  currentPage() {
    const target = this.scroller.scrollTop + Math.min(this.scroller.clientHeight * 0.35, 240)
    let low = 0
    let high = this.slots.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (this.slots[middle].element.offsetTop - gap / 2 <= target) low = middle
      else high = middle - 1
    }
    return low
  }

  scrollToPage(index: number) {
    const slot = this.slots[Math.min(Math.max(index, 0), this.slots.length - 1)]
    if (!slot) return
    this.scroller.scrollTop = slot.element.offsetTop - gap
    this.events.page(slot.index)
  }

  private schedule() {
    if (this.disposed) return
    const wanted = [...this.visible].sort((left, right) => Math.abs(left - this.currentPage()) - Math.abs(right - this.currentPage()))
    for (const index of wanted) {
      if (this.running >= pdfLimits.concurrentRenders) break
      const slot = this.slots[index]
      if (!slot.rendering && slot.scale !== this.scale) void this.render(slot)
    }
    this.release()
  }

  private release() {
    const rendered = this.slots.filter(slot => (slot.canvas || slot.rendering) && !this.visible.has(slot.index))
    if (rendered.length <= pdfLimits.retainedPages) return
    rendered.sort((left, right) => left.used - right.used)
    for (const slot of rendered.slice(0, rendered.length - pdfLimits.retainedPages)) this.clear(slot)
  }

  private clear(slot: PageSlot) {
    slot.task?.cancel()
    slot.layer?.cancel()
    slot.task = undefined
    slot.layer = undefined
    if (slot.canvas) { slot.canvas.width = 0; slot.canvas.height = 0 }
    slot.element.replaceChildren()
    slot.canvas = undefined
    slot.text = undefined
    slot.scale = undefined
    slot.proxy?.cleanup()
    slot.proxy = undefined
  }

  private async render(slot: PageSlot) {
    const scale = this.scale
    slot.used = ++this.clock
    this.running++
    const work = (async () => {
      const page = slot.proxy ?? await this.handle.page(slot.index)
      slot.proxy = page
      if (this.disposed || scale !== this.scale) return
      const viewport = page.getViewport({ scale })
      const pixelRatio = globalThis.devicePixelRatio || 1
      // Keep each canvas inside the documented pixel budget, trading sharpness at high zoom.
      const output = Math.min(pixelRatio, Math.sqrt(pdfLimits.canvasPixels / Math.max(1, viewport.width * viewport.height)))
      const canvas = document.createElement('canvas')
      canvas.className = 'pdf-canvas'
      canvas.width = Math.max(1, Math.floor(viewport.width * output))
      canvas.height = Math.max(1, Math.floor(viewport.height * output))
      canvas.setAttribute('aria-hidden', 'true')
      slot.task = page.render({ canvas, viewport, intent: 'display', annotationMode: this.lib.AnnotationMode.ENABLE,
        transform: output === 1 ? undefined : [output, 0, 0, output, 0, 0] })
      await slot.task.promise
      slot.task = undefined
      if (this.disposed || scale !== this.scale) { canvas.width = 0; canvas.height = 0; return }
      const text = document.createElement('div')
      text.className = 'textLayer pdf-text-layer'
      const content = await this.handle.content(slot.index).catch(() => undefined)
      const pageText = content && await this.handle.text(slot.index).catch(() => undefined)
      if (pageText) this.textCache.set(slot.index, pageText)
      if (this.disposed || scale !== this.scale) { canvas.width = 0; canvas.height = 0; return }
      const old = slot.canvas
      slot.layer?.cancel()
      slot.element.replaceChildren(canvas, text)
      if (old) { old.width = 0; old.height = 0 }
      slot.canvas = canvas
      slot.text = text
      slot.scale = scale
      slot.textless = !pageText || !hasText(pageText)
      slot.element.dataset.textless = String(slot.textless)
      if (slot.textless && this.showTextless) {
        const label = document.createElement('div')
        label.className = 'pdf-textless'
        label.textContent = 'No searchable text on this page'
        slot.element.append(label)
      }
      if (content) {
        slot.layer = new this.lib.TextLayer({ textContentSource: content, container: text, viewport })
        await slot.layer.render()
      }
      this.paintHighlights()
      this.events.rendered(slot.index)
      if (this.pendingScroll?.page === slot.index) this.revealMatch(this.pendingScroll)
    })()
    slot.rendering = work
    try { await work }
    catch (error) {
      if ((error as { name?: string })?.name !== 'RenderingCancelledException' && !this.disposed) {
        this.events.error(`Page ${slot.index + 1} could not be rendered.`)
        slot.element.dataset.error = 'true'
      }
    } finally {
      this.running--
      if (slot.rendering === work) slot.rendering = undefined
      if (!this.disposed) this.schedule()
    }
  }

  setMatches(matches: PdfMatch[], active: number) {
    this.matches = matches
    this.active = active
    const registry = highlights()
    if (registry && !matches.length && this.ownsHighlights) {
      registry.delete(highlightName)
      registry.delete(activeHighlightName)
      this.ownsHighlights = false
    }
    this.paintHighlights()
  }

  private paintHighlights() {
    const registry = highlights()
    if (!registry || !this.matches.length) return
    const all: Range[] = []
    const current: Range[] = []
    for (const [index, match] of this.matches.entries()) {
      const ranges = this.cachedRanges(this.slots[match.page], match)
      if (index === this.active) current.push(...ranges)
      else all.push(...ranges)
    }
    const HighlightType = globalThis.Highlight as unknown as new (...ranges: Range[]) => unknown
    registry.set(highlightName, new HighlightType(...all))
    registry.set(activeHighlightName, new HighlightType(...current))
    this.ownsHighlights = true
  }

  private readonly textCache = new Map<number, PdfPageText>()
  /** Registers the text index used to map search matches onto text layer spans. */
  rememberText(page: PdfPageText) { this.textCache.set(page.page, page) }

  private cachedRanges(slot: PageSlot | undefined, match: PdfMatch) {
    const page = this.textCache.get(match.page)
    const divs = slot?.layer?.textDivs
    if (!page || !divs) return []
    const result: Range[] = []
    for (const { item, from, to } of itemRanges(page, match)) {
      const node = divs[item]?.firstChild
      if (!node || node.nodeType !== Node.TEXT_NODE) continue
      const length = node.textContent?.length ?? 0
      if (from >= length) continue
      const range = document.createRange()
      range.setStart(node, from)
      range.setEnd(node, Math.min(to, length))
      result.push(range)
    }
    return result
  }

  /** Scrolls the active match into view, rendering its page first if needed. */
  revealMatch(match: PdfMatch) {
    const slot = this.slots[match.page]
    if (!slot) return
    const ranges = slot.layer ? this.cachedRanges(slot, match) : []
    if (!ranges.length) {
      this.pendingScroll = match
      if (!this.visible.has(match.page)) this.scrollToPage(match.page)
      return
    }
    this.pendingScroll = undefined
    const rect = ranges[0].getBoundingClientRect()
    const bounds = this.scroller.getBoundingClientRect()
    if (rect.top < bounds.top + 40 || rect.bottom > bounds.bottom - 40) this.scroller.scrollTop += rect.top - bounds.top - bounds.height / 3
    if (rect.left < bounds.left || rect.right > bounds.right) this.scroller.scrollLeft += rect.left - bounds.left - bounds.width / 3
  }

  textless(index: number) { return this.slots[index]?.textless }

  async dispose() {
    this.disposed = true
    this.observer.disconnect()
    for (const slot of this.slots) this.clear(slot)
    this.setMatches([], -1)
    await this.measuring?.catch(() => undefined)
  }
}
