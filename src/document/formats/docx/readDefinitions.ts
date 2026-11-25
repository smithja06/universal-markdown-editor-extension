import { isWord, wordAttr, wordChild, wordChildren, type XmlElement } from './readPackage'

interface Style {
  element: XmlElement
  name?: string
  type?: string
  parent?: string
}

export function enabled(element: XmlElement): boolean {
  const value = wordAttr(element)
  if (value === '0' || value === 'false' || value === 'off') return false
  if (value === undefined || value === '1' || value === 'true' || value === 'on') return true
  throw new Error(`The DOCX has an invalid ${element.tag.local} value.`)
}

export function rejectHiddenProperties(properties: XmlElement | undefined) {
  if (!properties) return
  for (const child of properties.children) {
    if ((isWord(child, 'vanish') || isWord(child, 'webHidden') || isWord(child, 'specVanish')) && enabled(child)) {
      throw new Error('The DOCX contains hidden text whose visible content cannot be imported reliably.')
    }
    if (isWord(child, 'rPr')) rejectHiddenProperties(child)
  }
}

function value(element: XmlElement | undefined, name: string): string | undefined {
  const child = element && wordChild(element, name)
  return child && wordAttr(child)
}

function tagValue(element: XmlElement, name: string): string {
  const result = wordAttr(element, name)
  if (!result?.trim()) throw new Error(`The DOCX has an invalid ${name} identifier.`)
  return result
}

export function readStyles(root: XmlElement | undefined) {
  if (root && !isWord(root, 'styles')) throw new Error('Invalid DOCX styles part.')
  const styles = new Map<string, Style>()
  const defaults = new Map<string, string>()
  if (root) {
    const documentDefaults = wordChild(root, 'docDefaults')
    const runDefaults = documentDefaults && wordChild(documentDefaults, 'rPrDefault')
    if (runDefaults) rejectHiddenProperties(wordChild(runDefaults, 'rPr'))
  }
  for (const element of root ? wordChildren(root, 'style') : []) {
    const id = tagValue(element, 'styleId')
    if (styles.has(id)) throw new Error('The DOCX has duplicate style identifiers.')
    const type = wordAttr(element, 'type')
    styles.set(id, { element, type, name: value(element, 'name'), parent: value(element, 'basedOn') })
    if (type && ['1', 'true', 'on'].includes(wordAttr(element, 'default') ?? '')) {
      if (defaults.has(type)) throw new Error('The DOCX has ambiguous default styles.')
      defaults.set(type, id)
    }
  }

  function validateStyle(id: string, type: string) {
    const seen = new Set<string>()
    let heading: number | undefined
    for (let next: string | undefined = id; next;) {
      if (seen.has(next) || seen.size > 64) throw new Error('The DOCX has an invalid style hierarchy.')
      seen.add(next)
      const style: Style | undefined = styles.get(next)
      if (style?.type && style.type !== type) throw new Error('The DOCX has an invalid style reference.')
      if (!style) break
      rejectHiddenProperties(wordChild(style.element, 'rPr'))
      const properties = wordChild(style.element, 'pPr')
      rejectHiddenProperties(properties)
      if (properties && wordChild(properties, 'numPr')) {
        throw new Error('The DOCX uses style-based numbering that cannot be imported reliably.')
      }
      const outline = value(properties, 'outlineLvl')
      if (heading === undefined && outline && /^[0-8]$/.test(outline)) heading = Number(outline) + 1
      next = style.parent
    }
    return heading
  }

  for (const [type, id] of defaults) validateStyle(id, type)
  return {
    heading(id: string | undefined) {
      if (!id) return undefined
      const level = validateStyle(id, 'paragraph')
      const named = /^heading\s*([1-9])$/i.exec(styles.get(id)?.name ?? id)
      return level ?? (named ? Number(named[1]) : undefined)
    },
    checkCharacter(id: string) { validateStyle(id, 'character') },
    checkTable(id: string) { validateStyle(id, 'table') },
  }
}

type ListType = 'bulletList' | 'orderedList'

export function readNumbering(root: XmlElement | undefined) {
  if (root && !isWord(root, 'numbering')) throw new Error('Invalid DOCX numbering part.')
  const abstracts = new Map<string, XmlElement>()
  const numbers = new Map<string, XmlElement>()
  for (const [name, destination] of [['abstractNum', abstracts], ['num', numbers]] as const) {
    for (const element of root ? wordChildren(root, name) : []) {
      const id = tagValue(element, `${name}Id`)
      if (destination.has(id)) throw new Error('The DOCX has duplicate numbering identifiers.')
      destination.set(id, element)
    }
  }
  return (id: string) => {
    const instance = numbers.get(id)
    const definition = abstracts.get(value(instance, 'abstractNumId') ?? '')
    const uncertain = () => { throw new Error('The DOCX has advanced or ambiguous list numbering.') }
    if (!instance || !definition || wordChild(definition, 'numStyleLink') || wordChild(definition, 'styleLink')) {
      return uncertain()
    }
    const overrides = wordChildren(instance, 'lvlOverride').filter(item => wordAttr(item, 'ilvl') === '0')
    const levels = wordChildren(definition, 'lvl').filter(item => wordAttr(item, 'ilvl') === '0')
    if (overrides.length > 1 || levels.length !== 1) return uncertain()
    const override = overrides[0]
    const level = (override && wordChild(override, 'lvl')) ?? levels[0]
    const format = value(level, 'numFmt')
    const label = value(level, 'lvlText')
    const start = value(override, 'startOverride') ?? value(level, 'start') ?? '1'
    const type: ListType = format === 'bullet' ? 'bulletList' : 'orderedList'
    if (format !== 'bullet' && (format !== 'decimal' || !/^\d{1,7}$/.test(start) ||
      Number(start) < 1 || Number(start) > 1_000_000 || (label && !label.includes('%1')))) {
      return uncertain()
    }
    const approximate = !!wordChild(level, 'lvlPicBulletId') || (!!label && (
      type === 'bulletList' ? !['•', '\uf0b7', '·'].includes(label) : label !== '%1.'
    ))
    return { type, start: type === 'bulletList' ? 1 : Number(start), approximate }
  }
}
