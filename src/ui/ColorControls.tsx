import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Palette } from 'lucide-react'
import { accentAtHue, accentHex, accentHue, accentRgb, accentSpectrum, type ColorPreferences } from '../appearance'
import { IconButton } from './controls'

interface Props {
  theme: ColorPreferences['theme']
  accentColor: ColorPreferences['accentColor']
  /** Present only in hosts with their own color theme, such as VS Code. */
  hostColors?: boolean
  onChange(update: Partial<ColorPreferences>): void
}

/** Theme and accent color choices shared by the Properties panel and the VS Code document shells. */
export function ColorControls({ theme, accentColor, hostColors, onChange }: Props) {
  const hex = accentHex(accentColor)
  const host = hostColors !== undefined
  return <>
    <label className="field">Theme<select value={hostColors ? 'host' : theme} onChange={event => {
      const value = event.target.value
      onChange(value === 'host' ? { hostColors: true } : { hostColors: false, theme: value === 'dark' ? 'dark' : 'light' })
    }}>
      {host && <option value="host">Match VS Code</option>}
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select></label>
    {hostColors && <p className="muted color-host-note">Colors follow the VS Code theme. Choose Light, Dark or an accent color to use the Folio palette.</p>}
    <fieldset className="accent-field">
      <legend>Accent color</legend>
      <div className="accent-preview"><span aria-hidden="true" style={{ background: accentRgb(accentColor) }} /><output aria-label="Accent hex value">{hex}</output></div>
      <input type="range" className="accent-hue" aria-label="Accent hue" aria-valuetext={hex} min={0} max={359}
        value={accentHue(accentColor)} style={{ '--accent-spectrum': accentSpectrum } as CSSProperties}
        onChange={event => onChange({ accentColor: accentAtHue(event.currentTarget.valueAsNumber), ...(host && { hostColors: false }) })} />
    </fieldset>
  </>
}

/** A toolbar button that opens the color choices in a small popover. */
export function ColorPopover(props: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent | FocusEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusin', dismiss) }
  }, [open])
  return <div className="color-popover" ref={root} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    trigger.current?.querySelector('button')?.focus()
  }}>
    <div ref={trigger} className="color-popover-trigger">
      <IconButton label="Appearance" expanded={open} controls={open ? id : undefined} onClick={() => setOpen(!open)}><Palette size={16} /></IconButton>
    </div>
    {open && <div id={id} className="color-popover-panel fields-panel" role="dialog" aria-label="Appearance">
      <ColorControls {...props} />
    </div>}
  </div>
}
