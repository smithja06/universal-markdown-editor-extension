import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEventHandler, type ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'

export interface Item {
  label: string
  icon?: ReactNode
  run?: () => void
  shortcut?: string
  active?: boolean
  disabled?: boolean
  divider?: boolean
}

export function IconButton({ label, children, onClick, disabled, active, expanded, controls, className = '' }: {
  label: string; children: ReactNode; onClick: MouseEventHandler<HTMLButtonElement>; disabled?: boolean; active?: boolean; className?: string
  expanded?: boolean; controls?: string
}) {
  return <button type="button" className={'icon-button ' + className} title={label} aria-label={label} aria-pressed={active} aria-expanded={expanded}
    aria-controls={controls} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onClick}>{children}</button>
}

export function Menu({ label, value, items, compactItems = [], children, className = '', align = 'left', chevron = false, disabled = false }: {
  label: string; value?: string; items: Item[]; compactItems?: Item[]; children?: ReactNode; className?: string; align?: 'left' | 'right'; chevron?: boolean; disabled?: boolean
}) {
  const [opening, setOpening] = useState<'pointer' | 'first' | 'last'>()
  const open = opening !== undefined
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const commands = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])
    .filter(item => item.getClientRects().length > 0)
  useLayoutEffect(() => {
    const overlay = menu.current
    if (!open || !overlay) return
    const fit = () => {
      overlay.style.transform = ''
      const rect = overlay.getBoundingClientRect()
      const offset = rect.left < 8 ? 8 - rect.left : Math.min(0, window.innerWidth - rect.right - 8)
      if (offset) overlay.style.transform = 'translateX(' + offset + 'px)'
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open])
  useLayoutEffect(() => {
    if (opening === 'first' || opening === 'last') commands().at(opening === 'first' ? 0 : -1)?.focus()
  }, [opening])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent | FocusEvent) => { if (!root.current?.contains(event.target as Node)) setOpening(undefined) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss) }
  }, [open])

  return <div className={'menu ' + className} ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpening(undefined); trigger.current?.focus(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!open) { setOpening(event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'first'); return }
    const list = commands()
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' || (event.key === 'ArrowUp' && index < 0) ? list.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
    list[next]?.focus()
  }}>
    <button ref={trigger} type="button" className="menu-trigger" aria-label={value ? label + ' ' + value : label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onMouseDown={event => event.preventDefault()} onClick={event => setOpening(open ? undefined : event.detail === 0 ? 'first' : 'pointer')}>
      {children ?? label}{chevron && <ChevronDown size={12} className="menu-chevron" />}
    </button>
    {open && <div id={id} ref={menu} className={'dropdown align-' + align} role="menu" aria-label={label}>
      {[...compactItems, ...items].map((item, index) => {
        const itemClass = index < compactItems.length ? 'compact-menu-item' : undefined
        if (item.divider) return <hr key={index} role="separator" className={itemClass} />
        return <button key={index} type="button" role="menuitem" className={itemClass} tabIndex={-1} disabled={item.disabled}
          onMouseDown={event => event.preventDefault()} onClick={() => {
            if (menu.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true })
            setOpening(undefined)
            item.run?.()
          }}>
          {item.icon && <span className="item-icon">{item.icon}</span>}
          <span className="item-label">{item.label}</span>
          {item.active && <span className="menu-tick" aria-label="Selected">✓</span>}
          {item.shortcut && <kbd>{item.shortcut}</kbd>}
        </button>
      })}
    </div>}
  </div>
}

export function Modal({ title, close, children, wide = false, closeDisabled = false }: { title: string; close(): void; children: ReactNode; wide?: boolean; closeDisabled?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const opener = document.activeElement
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-dialog-focus]')?.focus()
    return () => {
      dialog.close()
      if (document.activeElement === document.body && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={ref} className={'modal ' + (wide ? 'modal-wide' : '')} aria-labelledby={id} onCancel={event => { event.preventDefault(); close() }} onClick={event => {
    if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
    }
  }}>
    <div className="modal-heading"><h2 id={id}>{title}</h2><IconButton label="Close dialog" disabled={closeDisabled} onClick={close}><X size={18} /></IconButton></div>
    {children}
  </dialog>
}
