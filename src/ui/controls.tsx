import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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

export function IconButton({ label, children, onClick, disabled, active, className = '' }: {
  label: string; children: ReactNode; onClick(): void; disabled?: boolean; active?: boolean; className?: string
}) {
  return <button type="button" className={'icon-button ' + className} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onClick}>{children}</button>
}

export function Menu({ label, items, children, className = '', align = 'left', chevron = false, disabled = false }: {
  label: string; items: Item[]; children?: ReactNode; className?: string; align?: 'left' | 'right'; chevron?: boolean; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
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
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent | FocusEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss) }
  }, [open])

  const commands = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])
  return <div className={'menu ' + className} ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!open) { setOpen(true); requestAnimationFrame(() => commands().at(event.key === 'ArrowUp' ? -1 : 0)?.focus()); return }
    const list = commands()
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
    list[next]?.focus()
  }}>
    <button ref={trigger} type="button" className="menu-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onMouseDown={event => event.preventDefault()} onClick={() => setOpen(value => !value)}>
      {children ?? label}{chevron && <ChevronDown size={12} className="menu-chevron" />}
    </button>
    {open && <div id={id} ref={menu} className={'dropdown align-' + align} role="menu" aria-label={label}>
      {items.map((item, index) => item.divider ? <hr key={index} role="separator" /> : <button key={index} type="button" role="menuitem" disabled={item.disabled} onMouseDown={event => event.preventDefault()} onClick={() => { setOpen(false); item.run?.() }}>
        {item.icon && <span className="item-icon">{item.icon}</span>}
        <span className="item-label">{item.label}</span>
        {item.active && <span className="menu-tick" aria-label="Selected">✓</span>}
        {item.shortcut && <kbd>{item.shortcut}</kbd>}
      </button>)}
    </div>}
  </div>
}

export function Modal({ title, close, children, wide = false }: { title: string; close(): void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} className={'modal ' + (wide ? 'modal-wide' : '')} aria-labelledby={id} onCancel={event => { event.preventDefault(); close() }} onClick={event => {
    if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
    }
  }}>
    <div className="modal-heading"><h2 id={id}>{title}</h2><IconButton label="Close dialog" onClick={close}><X size={18} /></IconButton></div>
    {children}
  </dialog>
}
