import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDownToLine, CircleAlert, FileSpreadsheet, Info, LoaderCircle, Search, Trash2 } from 'lucide-react'
import { cellAddress, parseRange, rangeAddress, rangeSize, safeSpreadsheetLink, spreadsheetLimits, type Border, type Cell, type CellValue,
  type ConditionalRule, type CsvDialect, type Point, type Range, type Sheet, type SpreadsheetFormat, type Workbook } from '../../document/formats/spreadsheet/model'
import { IconButton, Modal } from '../controls'
import { supportedNumberFormat, displayCell } from './display'
import { renderRangePng } from './png'
import { formulaCatalog } from '../../document/formats/spreadsheet/formulaCatalog'

export type SpreadsheetExportRequest = ({
  format: 'xlsx' | 'csv'
  sheetId: string
  csvSafety?: 'literal' | 'safe'
  delimiter?: CsvDialect['delimiter']
  includeCalculated?: boolean
} | { format: 'png'; bytes: Uint8Array<ArrayBuffer> }) & {
  filename: string
  confirmedWorkbook: Workbook
  signal?: AbortSignal
}

const actions = (text: string, close: () => void, busy = false) => <div className="dialog-actions">
  <button className="secondary-button" type="button" onClick={close}>Cancel</button>
  <button className="primary-button" type="submit" disabled={busy}>{busy && <LoaderCircle className="spinner" size={14} />}{text}</button>
</div>

function field(data: FormData, name: string) {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

function FormModal({ title, close, submit, label = 'Apply', children }: {
  title: string; close(): void; submit: (data: FormData) => void; label?: string; children: ReactNode
}) {
  const [error, setError] = useState('')
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try { submit(new FormData(event.currentTarget)); close() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The change could not be applied.') }
  }
  return <Modal title={title} close={close}><form className="folio-sheet-dialog" onSubmit={save}>
    {children}
    {error && <p role="alert" className="folio-sheet-error">{error}</p>}
    {actions(label, close)}
  </form></Modal>
}

export function InputDialog({ title, label, initial, close, write, maxLength = 2048, note, submitLabel }: {
  title: string; label: string; initial?: string; close(): void; write(value: string): void; maxLength?: number; note?: string; submitLabel?: string
}) {
  return <FormModal title={title} close={close} submit={data => write(field(data, 'value').trim())} label={submitLabel}>
    {note && <p>{note}</p>}
    <label>{label}<input data-dialog-focus name="value" defaultValue={initial} maxLength={maxLength} required /></label>
  </FormModal>
}

export function ConfirmDialog({ title, message, label, close, confirm }: { title: string; message: string; label: string; close(): void; confirm(): void }) {
  return <FormModal title={title} close={close} submit={confirm} label={label}><p>{message}</p></FormModal>
}

export function NumberDialog({ initial, close, apply }: { initial?: string; close(): void; apply(value: string): void }) {
  return <InputDialog title="Custom number format" label="Format pattern" initial={initial} close={close} maxLength={64}
    note={'Use a pattern such as #,##0.000, 0.0%, yyyy-mm-dd, or "USD "0.00.'}
    write={value => {
      if (!supportedNumberFormat(value)) throw new Error('Use a supported numeric, percentage, currency, date, or time pattern.')
      apply(value)
    }} />
}

export function ColorDialog({ title, initial, close, apply }: { title: string; initial?: string; close(): void; apply(value?: string): void }) {
  const [color, setColor] = useState(initial && /^#[a-f0-9]{6}$/i.test(initial) ? initial : '#216447')
  const palette = ['#18241e', '#ffffff', '#216447', '#457255', '#2a5d9f', '#70429c', '#9b3240', '#a96824', '#f0e6bd', '#dcece3', '#dfedfa', '#f7dddf']
  return <FormModal title={title} close={close} submit={() => apply(color)}>
    <label>Custom color <input data-dialog-focus aria-label="Custom color" type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
    <div className="folio-sheet-palette">{palette.map(value => <button key={value} type="button" title={value} aria-label={'Choose ' + value}
      aria-pressed={value === color} style={{ backgroundColor: value }} onClick={() => setColor(value)} />)}</div>
    <button type="button" className="secondary-button" onClick={() => { apply(undefined); close() }}>Use default</button>
  </FormModal>
}

export function BorderDialog({ border, close, apply }: { border: Border; close(): void; apply(value: Border): void }) {
  return <FormModal title="Border color and style" close={close} submit={data => apply({
    color: field(data, 'color'), style: data.get('style') as Border['style'],
  })} label="Set border options">
    <p>These settings apply to the next border you add.</p>
    <label>Color<input name="color" type="color" defaultValue={border.color} /></label>
    <label>Style<select name="style" defaultValue={border.style}>{['thin', 'medium', 'thick', 'dashed', 'dotted', 'double']
      .map(style => <option key={style} value={style}>{style[0].toUpperCase() + style.slice(1)}</option>)}</select></label>
  </FormModal>
}

export function LinkDialog({ cell, close, apply }: { cell?: Cell; close(): void; apply(link?: string): void }) {
  const safe = cell?.link && safeSpreadsheetLink(cell.link)
  return <FormModal title={cell?.link ? 'Edit cell link' : 'Insert cell link'} close={close} submit={data => {
    const link = safeSpreadsheetLink(field(data, 'destination').trim())
    if (!link) throw new Error('Use an HTTPS, HTTP, or mailto address.')
    apply(link)
  }}>
    <label>Link destination<input data-dialog-focus name="destination" defaultValue={cell?.link} maxLength={2048} required /></label>
    <div className="folio-sheet-link-actions">
      {safe && <a className="secondary-button" href={safe} target="_blank" rel="noopener noreferrer">Open link in browser</a>}
      {cell?.link && <button className="secondary-button" type="button" onClick={() => { apply(undefined); close() }}>Remove link</button>}
    </div>
  </FormModal>
}

const operators = [
  ['greater', 'Greater than'], ['less', 'Less than'], ['equal', 'Equal to'], ['between', 'Between'], ['contains', 'Text contains'],
  ['duplicate', 'Duplicate values'], ['colorScale', 'Two-color scale'], ['dataBar', 'Data bars'],
] as const

export function ConditionalDialog({ rules, range, close, change }: {
  rules: ConditionalRule[]; range: Range; close(): void; change(rules: ConditionalRule[]): void
}) {
  const [editing, setEditing] = useState('')
  const rule = rules.find(item => item.id === editing)
  const [operator, setOperator] = useState<ConditionalRule['operator']>(rules.find(item => item.id === editing)?.operator ?? 'greater')
  const hasOperand = ['greater', 'less', 'equal', 'between', 'contains'].includes(operator)
  return <FormModal title="Conditional formatting" close={close} submit={data => {
    const target = parseRange(field(data, 'range'))
    if (!target || rangeSize(target) > spreadsheetLimits.rangeCells) throw new Error('Enter an A1 range of up to 20,000 cells.')
    const value = field(data, 'value')
    const upper = field(data, 'upper')
    const valueType = operator === 'equal' ? field(data, 'valueType') as ConditionalRule['valueType'] : undefined
    if ((['greater', 'less', 'between'].includes(operator) || valueType === 'number') &&
      (!value.trim() || !Number.isFinite(Number(value)))) throw new Error('Enter a numeric threshold.')
    if (operator === 'between' && (!upper.trim() || !Number.isFinite(Number(upper)) || Number(upper) < Number(value))) throw new Error('Enter an upper threshold at least as large as the lower threshold.')
    if (!rule && rules.length >= 48) throw new Error('Each sheet supports up to 48 conditional rules.')
    const next = { id: rule?.id ?? crypto.randomUUID(), range: target, operator, value: value || undefined, valueType, upper: upper || undefined,
      color: field(data, 'color'), color2: data.has('color2') ? field(data, 'color2') : undefined }
    change(rule ? rules.map(item => item.id === rule.id ? next : item) : [...rules, next])
  }} label={rule ? 'Update rule' : 'Add rule'}>
    {rules.length > 0 && <div className="folio-sheet-rule-list">
      {rules.map(item => <div key={item.id}>
        <button className="secondary-button" type="button" aria-pressed={editing === item.id} onClick={() => { setEditing(item.id); setOperator(item.operator) }}>
          <span style={{ backgroundColor: item.color }} />{rangeAddress(item.range)} · {operators.find(([id]) => id === item.operator)?.[1]}
        </button>
        <IconButton label={'Remove rule for ' + rangeAddress(item.range)} onClick={() => {
          change(rules.filter(r => r.id !== item.id))
          if (editing === item.id) { setEditing(''); setOperator('greater') }
        }}><Trash2 size={16} /></IconButton>
      </div>)}
      {editing && <button className="secondary-button" type="button" onClick={() => { setEditing(''); setOperator('greater') }}>New rule</button>}
    </div>}
    <div key={editing} className="folio-sheet-rule-fields">
      <label>Applies to<input name="range" defaultValue={rangeAddress(rule?.range ?? range)} required /></label>
      <label>Condition<select name="operator" value={operator} onChange={event => setOperator(event.target.value as ConditionalRule['operator'])}>
        {operators.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {operator === 'equal' && <label>Comparison kind<select name="valueType" defaultValue={rule?.valueType ?? 'number'}>
        <option value="number">Number</option><option value="text">Text</option>
      </select></label>}
      {hasOperand && <label>{operator === 'between' ? 'Lower threshold' : 'Comparison value'}<input name="value" defaultValue={rule?.value} required maxLength={256} /></label>}
      {operator === 'between' && <label>Upper threshold<input name="upper" defaultValue={rule?.upper} required /></label>}
      <label>{operator === 'colorScale' ? 'Minimum color' : 'Highlight color'}<input name="color" type="color" defaultValue={rule?.color ?? '#dcece3'} /></label>
      {operator === 'colorScale' && <label>Maximum color<input name="color2" type="color" defaultValue={rule?.color2 ?? '#70a57e'} /></label>}
    </div>
  </FormModal>
}

export const delimiters = [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab'], ['|', 'Pipe']] as const

export function RegionalDialog({ workbook, readOnly, close, change }: { workbook: Workbook; readOnly: boolean; close(): void; change(workbook: Workbook): void }) {
  return <FormModal title="Regional settings" close={close} submit={data => {
    if (readOnly) return
    const locale = Intl.getCanonicalLocales(field(data, 'locale'))[0]
    if (!locale) throw new Error('Enter a locale such as en-CA or fr-FR.')
    const timezone = field(data, 'timezone')
    new Intl.DateTimeFormat(locale, { timeZone: timezone }).format()
    change({ ...workbook, locale, timezone })
  }}>
    <p>Locale changes display conventions. Spreadsheet date serials keep their original values and day boundaries. Timezone applies when calculating supported time functions.</p>
    <label>Locale<input name="locale" data-dialog-focus list="folio-sheet-locales" defaultValue={workbook.locale} readOnly={readOnly} required /></label>
    <datalist id="folio-sheet-locales">{['en-US', 'en-CA', 'en-GB', 'fr-CA', 'fr-FR', 'de-DE', 'es-ES', 'ja-JP'].map(locale => <option key={locale} value={locale} />)}</datalist>
    <label>Timezone<input name="timezone" list="folio-sheet-timezones" defaultValue={workbook.timezone} readOnly={readOnly} required /></label>
    <datalist id="folio-sheet-timezones">{['UTC', 'America/Toronto', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney']
      .map(zone => <option key={zone} value={zone} />)}</datalist>
    <div className="folio-sheet-muted">Interface language: English</div>
  </FormModal>
}

export function DialectDialog({ csv, close, apply }: { csv: CsvDialect; close(): void; apply(delimiter: CsvDialect['delimiter']): Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Modal title="CSV delimiter" close={close} closeDisabled={busy}><form className="folio-sheet-dialog" onSubmit={event => {
    event.preventDefault()
    const delimiter = new FormData(event.currentTarget).get('delimiter') as CsvDialect['delimiter']
    setBusy(true)
    void apply(delimiter).then(close).catch(failure => {
      setBusy(false)
      setError(failure instanceof Error ? failure.message : 'The CSV could not be opened with that delimiter.')
    })
  }}>
    <p>Choose the field separator used by the original file, then review its columns in the grid.</p>
    <label>Delimiter<select data-dialog-focus name="delimiter" defaultValue={csv.delimiter}>{delimiters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {error && <p role="alert" className="folio-sheet-error">{error}</p>}
    {actions('Open with delimiter', close, busy)}
  </form></Modal>
}

type ExportFormat = SpreadsheetFormat | 'png'
export function ExportDialog({ target, sourceFormat, workbook, title, sheet, range, calculated, includeCalculated, close, deliver }: {
  target: ExportFormat; sourceFormat: SpreadsheetFormat; workbook: Workbook; title: string; sheet: Sheet; range: Range; calculated?: Record<string, CellValue>
  includeCalculated?: boolean
  close(): void; deliver(request: SpreadsheetExportRequest): Promise<void>
}) {
  const [filename, setFilename] = useState(title.replace(/\.(?:xlsx|csv)$/i, '') + (target === 'png' ? ' ' + rangeAddress(range).replace(':', '-') : ' copy') + '.' + target)
  const [sheetId, setSheetId] = useState(sourceFormat === 'csv' ? sheet.id : '')
  const [safety, setSafety] = useState<'safe' | 'literal' | ''>('')
  const [delimiter, setDelimiter] = useState<CsvDialect['delimiter']>(workbook.csv?.delimiter ?? ',')
  const [transparent, setTransparent] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [controller, setController] = useState<AbortController>()
  useEffect(() => () => controller?.abort(), [controller])
  const docWarnings = target === 'xlsx' ? workbook.warnings : []
  const hasFormulas = target === 'xlsx' && workbook.sheets.some(item => Object.values(item.cells).some(cell => cell.kind === 'formula'))
  const valid = (target !== 'csv' || !!sheetId && !!safety) && (target === 'png' || confirmed)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid || controller) return
    const trimmed = filename.trim()
    if (!trimmed || /[<>:"/\\|?*]/.test(trimmed) || [...trimmed].some(char => char.charCodeAt(0) < 32) ||
      trimmed.endsWith('.') || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(trimmed)) {
      setError('Enter a valid filename without folder separators.')
      return
    }
    const name = trimmed.toLowerCase().endsWith('.' + target) ? trimmed : trimmed + '.' + target
    const abort = new AbortController()
    setController(abort)
    setError('')
    const options = { filename: name, confirmedWorkbook: workbook, signal: abort.signal }
    const result = target === 'png' ? renderRangePng(sheet, workbook, range, calculated, transparent, abort.signal)
      .then(bytes => deliver({ ...options, format: 'png', bytes }))
      : deliver({ ...options, format: target, sheetId: sheetId || sheet.id, delimiter, csvSafety: safety || undefined, includeCalculated })
    void result.then(() => { if (!abort.signal.aborted) close() }).catch(failure => {
      if (abort.signal.aborted) return
      setError(failure instanceof Error ? failure.message : 'The copy could not be exported.')
      setController(undefined)
    })
  }
  return <Modal title={target === 'png' ? 'Export range as PNG' : 'Export ' + target.toUpperCase() + ' copy'} close={close}>
    <form className="folio-sheet-dialog" onSubmit={submit}>
      <label>Filename<input data-dialog-focus value={filename} maxLength={150} disabled={!!controller}
        onChange={event => { setConfirmed(false); setFilename(event.target.value) }} required /></label>
      {target === 'png' && <><p>{sheet.name} · {rangeAddress(range)}</p>
        <label className="folio-sheet-check"><input type="checkbox" checked={transparent} disabled={!!controller} onChange={event => setTransparent(event.target.checked)} />Transparent background</label></>}
      {target === 'csv' && <>
        <label>Worksheet<select value={sheetId} disabled={!!controller} onChange={event => { setConfirmed(false); setSheetId(event.target.value) }} required>
          <option value="">Choose a worksheet</option>{workbook.sheets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Delimiter<select value={delimiter} disabled={!!controller} onChange={event => { setConfirmed(false); setDelimiter(event.target.value as CsvDialect['delimiter']) }}>
          {delimiters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <fieldset disabled={!!controller}><legend>Formula-like fields</legend>
          <label className="folio-sheet-check"><input type="radio" name="safety" checked={safety === 'safe'}
            onChange={() => { setConfirmed(false); setSafety('safe') }} />Spreadsheet-safe copy</label>
          <label className="folio-sheet-check"><input type="radio" name="safety" checked={safety === 'literal'}
            onChange={() => { setConfirmed(false); setSafety('literal') }} />Preserve literal text</label>
          <p>Spreadsheet-safe copies prefix text that spreadsheet apps may interpret as a formula.</p>
        </fieldset>
        <div className="folio-sheet-review"><CircleAlert size={16} /><p>CSV contains one worksheet and omits styles, borders, merges, and workbook metadata. Formula-like text can be interpreted by other spreadsheet apps.</p></div>
        {workbook.csv?.mixedLineEndings && <p>Mixed record endings are normalized to the first record ending in this copy.</p>}
      </>}
      {target === 'xlsx' && <div className="folio-sheet-review"><Info size={16} /><div>
        <p>Folio exports supported workbook content to a new file and preserves the imported original.</p>
        {!!docWarnings.length && <ul>{docWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
        {hasFormulas && <p>{includeCalculated ? 'This copy includes freshly verified local results for supported formulas. Other stored results may be stale.'
          : 'This copy carries available stored formula results, which may be stale.'} You can recalculate manually in a compatible spreadsheet app.</p>}
      </div></div>}
      {target !== 'png' && <label className="folio-sheet-check"><input type="checkbox" checked={confirmed} disabled={!!controller}
        onChange={event => setConfirmed(event.target.checked)} />I reviewed the copy options and compatibility notes.</label>}
      {error && <p role="alert" className="folio-sheet-error">{error}</p>}
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={close}>Cancel</button>
        <button className="primary-button" type="submit" disabled={!valid || !!controller}>
          {controller ? <LoaderCircle size={15} className="spinner" /> : <ArrowDownToLine size={15} />} Export copy
        </button></div>
    </form>
  </Modal>
}

export function FormulaReference({ close }: { close(): void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const categories = [...new Set(formulaCatalog.map(item => item.category))]
  const results = formulaCatalog.filter(entry => (!category || entry.category === category) &&
    Object.values(entry).join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  return <Modal title="Formula reference" close={close} wide>
    <div className="folio-sheet-dialog">
      <div className="folio-sheet-reference-intro"><FileSpreadsheet size={19} /><div><strong>Powered by IronCalc</strong>
        <p>Folio uses IronCalc 0.9.1 for supported local calculations. Macros, external data connections, and some Excel functions and workbook features are unavailable.</p></div>
      </div>
      <div className="folio-sheet-reference-filters">
        <label><Search size={16} />Search functions<input data-dialog-focus value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, syntax, or description" /></label>
        <label>Category<select value={category} onChange={event => setCategory(event.target.value)}>
          <option value="">All categories</option>{categories.map(group => <option key={group}>{group}</option>)}
        </select></label>
      </div>
      <div className="folio-sheet-reference-results">
        {results.map(({ name, category, syntax, description, example }) => <article key={name}>
          <div><strong>{name}</strong><span>{category}</span></div><code>{syntax}</code><p>{description}</p><code>{example}</code>
        </article>)}
        {!results.length && <p>No matching functions.</p>}
      </div>
    </div>
  </Modal>
}

export function WorkbookFind({ workbook, calculated, close, jump }: {
  workbook: Workbook; calculated?: Record<string, Record<string, CellValue>>; close(): void; jump(sheet: Sheet, point: Point): void
}) {
  const [query, setQuery] = useState('')
  const id = useId()
  const text = query.trim().toLocaleLowerCase(workbook.locale)
  const results: { sheet: Sheet; address: string; display: string }[] = []
  if (text) search: for (const sheet of workbook.sheets) {
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const display = displayCell(cell, workbook.locale, workbook.date1904, calculated?.[sheet.id]?.[address])
      if (display.toLocaleLowerCase(workbook.locale).includes(text) || String(cell.value).toLocaleLowerCase(workbook.locale).includes(text)) {
        results.push({ sheet, address, display })
        if (results.length >= 100) break search
      }
    }
  }
  return <Modal title="Find in workbook" close={close}>
    <div className="folio-sheet-dialog">
      <label htmlFor={id}>Search values and formulas</label>
      <input data-dialog-focus id={id} value={query} maxLength={256} onChange={event => setQuery(event.target.value)} type="search" />
      {!!text && <div className="folio-sheet-muted" role="status">{results.length === 100 ? 'First 100 matches' : results.length + ' matches'}</div>}
      <div className="folio-sheet-find-results">{results.map(({ sheet, address, display }) => {
        const point = parseRange(address)
        return <button key={sheet.id + address} type="button" className="secondary-button" onClick={() => { if (point) jump(sheet, point); close() }}>
          <span>{sheet.name}!{cellAddress(point?.row ?? 1, point?.col ?? 1)}</span><span>{display || 'Empty result'}</span>
        </button>
      })}</div>
    </div>
  </Modal>
}
