import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { BarChart3, ChevronDown, ChevronRight, FileSliders, Layers3, ListTree, PanelRightClose, Palette, Tags } from 'lucide-react'
import { readMetadata, updateMetadata, type Heading, type Statistics } from '../document/metadata'
import { useWorkspace } from '../document/workspace'
import { IconButton } from './controls'

const tabs = [
  { name: 'Outline', icon: ListTree },
  { name: 'Front matter', icon: Tags },
  { name: 'Appearance', icon: Palette },
  { name: 'Statistics', icon: BarChart3 },
] as const
type Tab = typeof tabs[number]['name']

interface OutlineBranch { heading: Heading; children: OutlineBranch[] }

function outlineTree(headings: Heading[]) {
  const root: OutlineBranch[] = []
  const parents: OutlineBranch[] = []
  for (const heading of headings) {
    while (parents.length && parents.at(-1)!.heading.level >= heading.level) parents.pop()
    const entry = { heading, children: [] }
    ;(parents.at(-1)?.children ?? root).push(entry)
    parents.push(entry)
  }
  return root
}

function Outline({ headings, active, jump }: { headings: Heading[]; active: string; jump(heading: Heading): void }) {
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const toggle = (anchor: string) => setCollapsed(previous => {
    const next = new Set(previous)
    if (next.has(anchor)) next.delete(anchor)
    else next.add(anchor)
    return next
  })
  const render = (branches: OutlineBranch[], depth = 0): ReactNode => <ul>{branches.map(({ heading, children }) => {
    const isOpen = !collapsed.has(heading.anchor)
    return <li key={heading.anchor}>
      <div className={'outline-row ' + (heading.anchor === active ? 'is-active' : '')} style={{ paddingInlineStart: 5 + depth * 15 }}>
        {children.length > 0
          ? <button type="button" className="outline-expand" aria-label={(isOpen ? 'Collapse ' : 'Expand ') + heading.title} aria-expanded={isOpen} onClick={() => toggle(heading.anchor)}>{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
          : <span className="outline-indent" />}
        <button type="button" className="outline-entry" aria-current={heading.anchor === active ? 'location' : undefined} onClick={() => jump(heading)} title={heading.title}><span className="heading-level">H{heading.level}</span><span>{heading.title}</span></button>
      </div>
      {isOpen && children.length > 0 && render(children, depth + 1)}
    </li>
  })}</ul>
  return <section className="properties-content">
    <div className="section-heading"><h3>Document outline</h3><span>{headings.length === 1 ? '1 heading' : headings.length + ' headings'}</span></div>
    {headings.length ? <nav className="outline-tree" aria-label="Document outline">{render(outlineTree(headings))}</nav>
      : <div className="panel-empty"><Layers3 size={21} /><p>Add headings to create a document outline.</p></div>}
  </section>
}

const predefined = [
  ['title', 'Title'], ['description', 'Description'], ['author', 'Author'], ['tags', 'Tags'],
  ['created', 'Created date'], ['updated', 'Updated date'], ['category', 'Category'],
] as const

function FrontMatter({ value, update }: { value: string; update(value: string): void }) {
  const [format, setFormat] = useState<'form' | 'raw'>('form')
  const [draft, setDraft] = useState(value)
  const [key, setKey] = useState('')
  const [customValue, setCustomValue] = useState('')
  const [feedback, setFeedback] = useState('')
  useEffect(() => { setDraft(value) }, [value])
  const current = readMetadata(value)
  const activeFormat = current.error ? 'raw' : format
  const custom = [...current.fields.entries()].filter(([name]) => !predefined.some(([field]) => field === name))
  const draftError = readMetadata(draft).error
  const saveField = (name: string, next: string, type = 'text') => {
    try {
      const field = type === 'tags' ? next.split(',').map(tag => tag.trim()).filter(Boolean) : next
      update(updateMetadata(value, name, field))
      setFeedback('')
    } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)) }
  }
  const switchMode = (next: 'form' | 'raw') => {
    if (next === 'raw') setDraft(value)
    setFormat(next)
  }
  return <section className="properties-content fields-panel">
    <div className="section-heading"><h3>Front matter</h3><span>YAML</span></div>
    <div className="segmented"><button type="button" aria-pressed={activeFormat === 'form'} disabled={!!current.error} onClick={() => switchMode('form')}>Form</button><button type="button" aria-pressed={activeFormat === 'raw'} onClick={() => switchMode('raw')}>Raw YAML</button></div>
    {activeFormat === 'raw' ? <>
      <label className="field">YAML front matter<textarea spellCheck={false} rows={9} value={draft} onChange={event => setDraft(event.target.value)} /></label>
      {draftError && <p className="field-error" role="status">{draftError}</p>}
      <button type="button" className="primary-button" disabled={!!draftError || draft === value} onClick={() => update(draft)}>Apply YAML</button>
    </> : <>
      {predefined.map(([name, label]) => {
        const prev = current.fields.get(name)
        const display = Array.isArray(prev) ? prev.join(', ') : typeof prev === 'string' || typeof prev === 'number' ? String(prev) : ''
        const commit = (field: HTMLInputElement | HTMLTextAreaElement) => { if (field.value !== display) saveField(name, field.value, name) }
        const handleEnter = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') event.currentTarget.blur() }
        return <label className="field" key={name + display}>{label}
          {name === 'description' ? <textarea rows={2} defaultValue={display} onBlur={event => commit(event.currentTarget)} />
            : <input type={name === 'created' || name === 'updated' ? 'date' : 'text'} defaultValue={display} placeholder={name === 'tags' ? 'Separate tags with commas' : ''} onBlur={event => commit(event.currentTarget)} onKeyDown={handleEnter} />}
        </label>
      })}
      <div className="section-heading"><h3>Custom fields</h3></div>
      {custom.map(([name, previous]) => <label className="field" key={name + String(previous)}>{name}
        {typeof previous === 'object'
          ? <button type="button" className="secondary-button" onClick={() => switchMode('raw')}>Edit in YAML</button>
          : <input defaultValue={String(previous ?? '')} onBlur={event => { if (event.currentTarget.value !== String(previous ?? '')) saveField(name, event.currentTarget.value) }} />}
      </label>)}
      <form className="custom-fields" onSubmit={event => { event.preventDefault(); if (!key.trim()) return; if (current.fields.has(key.trim()) || predefined.some(([field]) => field === key.trim())) { setFeedback('A field with that name already exists.'); return }; saveField(key.trim(), customValue); setKey(''); setCustomValue('') }}>
        <input aria-label="Custom key" placeholder="Key" value={key} onChange={event => setKey(event.target.value)} /><input aria-label="Custom value" placeholder="Value" value={customValue} onChange={event => setCustomValue(event.target.value)} />
        <button type="submit" className="secondary-button" disabled={!key.trim() || !customValue.trim()}>Add field</button>
      </form>
    </>}
    {feedback && <p className="field-error" role="status">{feedback}</p>}
  </section>
}

function AppearancePanel() {
  const { appearance, setAppearance } = useWorkspace()
  return <section className="properties-content fields-panel">
    <div className="section-heading"><h3>Appearance</h3></div>
    <label className="field">Theme<select value={appearance.theme} onChange={event => setAppearance({ theme: event.target.value as typeof appearance.theme })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    <label className="field">Editor font<select value={appearance.font} onChange={event => setAppearance({ font: event.target.value as typeof appearance.font })}><option>Default</option><option>Sans serif</option><option>Serif</option><option>Monospace</option></select></label>
    <label className="field">Editor font size<select value={appearance.fontSize} onChange={event => setAppearance({ fontSize: Number(event.target.value) })}>{[12, 14, 15, 16, 18, 20, 22, 24].map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
    <label className="field">Editor line height<select value={appearance.lineHeight} onChange={event => setAppearance({ lineHeight: Number(event.target.value) })}>{[1.25, 1.5, 1.7, 1.9, 2.2].map(value => <option key={value}>{value}</option>)}</select></label>
    <label className="field">Document width<select value={appearance.width} onChange={event => setAppearance({ width: event.target.value as typeof appearance.width })}><option value="page">Page width</option><option value="full">Full width</option></select></label>
    <label className="check-field"><input type="checkbox" checked={appearance.lineNumbers} onChange={event => setAppearance({ lineNumbers: event.target.checked })} /> Show line numbers</label>
    <label className="check-field"><input type="checkbox" checked={appearance.wordWrap} onChange={event => setAppearance({ wordWrap: event.target.checked })} /> Wrap source lines</label>
  </section>
}

function StatisticsPanel({ data }: { data: Statistics }) {
  const entries = [
    ['Words', data.words], ['Characters', data.characters], ['Characters excluding spaces', data.compact],
    ['Reading time', data.minutes + ' min'], ['Headings', data.headings], ['Links', data.links], ['Images', data.images],
  ]
  return <section className="properties-content"><div className="section-heading"><h3>Document statistics</h3></div>
    <dl className="statistics-list">{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === 'number' ? value.toLocaleString() : value}</dd></div>)}</dl>
  </section>
}

export function Properties({ tab, setTab, headings, active, statistics, metadata, onMetadata, close, jump, width, setWidth }: {
  tab: Tab; setTab(tab: Tab): void; headings: Heading[]; active: string; statistics: Statistics; metadata: string; onMetadata(value: string): void; close(): void;
  jump(heading: Heading): void; width: number; setWidth(value: number): void
}) {
  const id = useId()
  return <aside className="properties" style={{ '--sidebar-width': width + 'px' } as React.CSSProperties} aria-label="Document properties">
    <div className="sidebar-resize" role="separator" aria-label="Resize document properties" aria-orientation="vertical" aria-valuenow={width} aria-valuemin={250} aria-valuemax={430} tabIndex={0} onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(width + (event.key === 'ArrowLeft' ? 12 : -12)) }
    }} onPointerDown={event => {
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(window.innerWidth - event.clientX) }} />
    <div className="properties-header">
      <div><FileSliders size={17} /><h2>Document properties</h2></div>
      <IconButton label="Close document properties" onClick={close}><PanelRightClose size={16} /></IconButton>
    </div>
    <div className="property-tabs" role="tablist" aria-label="Properties views" onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const next = (tabs.findIndex(item => item.name === tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
      setTab(tabs[next].name)
      document.getElementById(id + '-tab-' + next)?.focus()
    }}>
      {tabs.map(({ name, icon: Icon }, index) => <button type="button" role="tab" key={name} id={id + '-tab-' + index} aria-controls={id + '-panel'} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} title={name}>
        <Icon size={16} /><span>{name}</span>
      </button>)}
    </div>
    <div className="property-panel" id={id + '-panel'} role="tabpanel" aria-labelledby={id + '-tab-' + tabs.findIndex(item => item.name === tab)}>
      {tab === 'Outline' && <Outline headings={headings} active={active} jump={jump} />}
      {tab === 'Front matter' && <FrontMatter value={metadata} update={onMetadata} />}
      {tab === 'Appearance' && <AppearancePanel />}
      {tab === 'Statistics' && <StatisticsPanel data={statistics} />}
    </div>
  </aside>
}

export type PropertyTab = Tab
