let mermaidLoader: Promise<typeof import('mermaid')['default']> | undefined
let diagramJobs = Promise.resolve()
let rendererMode: 'preview' | 'export' | undefined

export function renderDiagram(id: string, source: string, options: { signal?: AbortSignal; mode: 'preview' | 'export' }) {
  const { mode, signal } = options
  const render = async () => {
    if (signal?.aborted) return
    mermaidLoader ??= import('mermaid').then(module => module.default)
      .catch(error => { mermaidLoader = undefined; throw error })
    const mermaid = await mermaidLoader
    if (signal?.aborted) return
    if (mode === 'export' && source.length > 50000) throw new Error('This Mermaid diagram is too large to render.')
    if (rendererMode !== mode) {
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'neutral',
        flowchart: { htmlLabels: false }, maxTextSize: 50000,
        ...(mode === 'export' ? {
          htmlLabels: false,
          secure: [...(mermaid.mermaidAPI.defaultConfig.secure ?? []), 'themeCSS', 'htmlLabels', 'suppressErrorRendering'],
        } : {}),
      })
      rendererMode = mode
    }
    if (mode === 'export' && source.includes('@{')) {
      // Mermaid measures flowchart image nodes by loading their URL during drawing.
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
      if (diagram.type.startsWith('flowchart')) {
        const vertices = (diagram.db as { getVertices?: () => Map<string, { img?: string }> }).getVertices?.()
        if (vertices && Array.from(vertices.values()).some(vertex => vertex.img)) throw new Error('Mermaid image nodes require their source assets.')
      }
    }

    const container = document.createElement('div')
    container.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none'
    container.setAttribute('aria-hidden', 'true')
    document.body.append(container)
    try {
      return (await mermaid.render(id, source, container)).svg
    } finally {
      container.remove()
    }
  }
  const job = diagramJobs.then(render)
  diagramJobs = job.then(() => undefined, () => undefined)
  return job
}
