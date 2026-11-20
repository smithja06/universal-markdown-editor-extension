import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FileText, MoreHorizontal, Plus, RotateCcw, X } from 'lucide-react'
import { IconButton, Menu } from './controls'

interface Tab { id: string; title: string; dirty: boolean; status?: string }
interface Props {
  tabs: Tab[]
  activeId: string | null
  canReopen: boolean
  disabled: boolean
  select(id: string): void
  close(id: string): void
  closeOthers(id: string): void
  reopen(): void
  create(): void
}

export function DocumentTabs({ tabs, activeId, canReopen, disabled, select, close, closeOthers, reopen, create }: Props) {
  const [context, setContext] = useState<string>()
  const strip = useRef<HTMLDivElement>(null)
  const actions = useRef<HTMLDivElement>(null)
  const closedFocus = useRef<string | undefined>(undefined)
  const actionTab = tabs.find(tab => tab.id === (context ?? activeId)) ?? tabs.find(tab => tab.id === activeId)

  const tabButton = (id: string) => strip.current?.querySelector<HTMLButtonElement>(`#document-tab-${CSS.escape(id)}`)
  useEffect(() => {
    if (activeId) tabButton(activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  useEffect(() => {
    if (!closedFocus.current || tabs.some(tab => tab.id === closedFocus.current)) return
    closedFocus.current = undefined
    if (activeId) tabButton(activeId)?.focus()
    else actions.current?.querySelector<HTMLButtonElement>('[aria-label="New document tab"]')?.focus()
  }, [activeId, tabs])

  function openActions(id: string) {
    setContext(id)
    const button = actions.current?.querySelector<HTMLButtonElement>('.menu-trigger')
    if (button?.getAttribute('aria-expanded') === 'false') button.click()
    button?.focus()
  }

  function closeTab(id: string) { closedFocus.current = id; close(id) }

  function navigate(event: KeyboardEvent, id: string) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openActions(id); return }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const index = tabs.findIndex(tab => tab.id === id)
    if (event.key === 'Delete') { event.preventDefault(); closeTab(id); return }
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1)
      : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
        : event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : undefined
    if (next) { event.preventDefault(); tabButton(next.id)?.focus(); select(next.id) }
  }

  return <div className="document-tabs">
    <div className="document-tab-strip" ref={strip} role="tablist" aria-label="Open documents">
      {tabs.map(tab => {
        const status = tab.status === 'unavailable' ? 'Local save unavailable' : tab.status === 'pending' ? 'Saving locally' : tab.dirty ? 'Changes since last file save' : ''
        return <div key={tab.id} className={'document-tab ' + (tab.id === activeId ? 'document-tab-active' : '')}
          onContextMenu={event => { event.preventDefault(); openActions(tab.id) }}>
          <button type="button" role="tab" id={'document-tab-' + tab.id} aria-selected={tab.id === activeId} aria-controls="document-panel"
            aria-label={tab.title} aria-description={status || undefined} title={status ? `${tab.title} • ${status}` : tab.title} tabIndex={tab.id === activeId ? 0 : -1}
            onClick={() => select(tab.id)} onKeyDown={event => navigate(event, tab.id)}>
            <FileText size={14} aria-hidden="true" /><span>{tab.title}</span>
            {!!status && <i className={tab.status === 'unavailable' ? 'tab-save-error' : tab.status === 'pending' ? 'tab-saving' : ''} />}
          </button>
          <button className="close-document-tab" type="button" aria-label={'Close ' + tab.title} title={'Close ' + tab.title} onClick={() => closeTab(tab.id)}><X size={14} /></button>
        </div>
      })}
    </div>
    <div className="document-tab-actions" ref={actions} onPointerDownCapture={event => { if ((event.target as Element).closest('.menu-trigger')) setContext(undefined) }}>
      <IconButton label="New document tab" disabled={disabled} onClick={create}><Plus size={16} /></IconButton>
      <Menu label="Tab actions" align="right" disabled={!actionTab && !canReopen} items={[
        { label: context && actionTab ? `Close ${actionTab.title}` : 'Close tab', disabled: !actionTab, run: () => { if (actionTab) closeTab(actionTab.id) } },
        { label: 'Close other tabs', disabled: !actionTab || tabs.length < 2, run: () => { if (actionTab) closeOthers(actionTab.id) } },
        { label: 'Reopen closed tab', icon: <RotateCcw size={14} />, disabled: !canReopen, run: reopen },
      ]}><MoreHorizontal size={17} /></Menu>
    </div>
  </div>
}
