import { Inflate } from 'fflate'

const MIB = 1024 * 1024
const MAX_ARCHIVE = 24 * MIB
const MAX_ENTRIES = 512
const MAX_ENTRY = 16 * MIB
const MAX_EXPANDED = 64 * MIB
const MAX_RATIO = 200
const RATIO_FLOOR = 64 * 1024
const INFLATE_CHUNK = 1024
const ZIP_END = 0x06054b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_LOCAL = 0x04034b50
const ZIP_DESCRIPTOR = 0x08074b50
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

interface Entry {
  name: string
  directory: boolean
  method: number
  crc: number
  size: number
  start: number
  end: number
}

function zipError(message: string): never {
  throw new Error(`Invalid or unsupported DOCX ZIP: ${message}`)
}

// Use a single canonical representation for ZIP names and OPC part URIs.
// Decode each segment independently so escaping cannot create a separator.
export function partSegment(segment: string): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment).normalize('NFC')
  } catch {
    throw new Error('The DOCX has an invalid package path.')
  }
  if (!decoded || decoded === '.' || decoded.endsWith('.') || /[/\\:%?#\p{Cc}]/u.test(decoded)) {
    throw new Error('The DOCX has an unsafe package path.')
  }
  return decoded.toLowerCase()
}

function entryName(bytes: Uint8Array<ArrayBuffer>, flags: number): string {
  let name: string
  if (bytes.length > 1024 || (!(flags & 0x800) && bytes.some(byte => byte > 0x7f))) {
    zipError('unsupported package path encoding.')
  }
  try {
    name = decoder.decode(bytes)
  } catch {
    zipError('invalid package path encoding.')
  }
  return (name.endsWith('/') ? name.slice(0, -1) : name).split('/').map(partSegment).join('/')
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  return crc
})

function crc32(bytes: Uint8Array<ArrayBuffer>): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return (crc ^ 0xffffffff) >>> 0
}

export function readZip(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.length > MAX_ARCHIVE) zipError('the archive exceeds the compressed size limit.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)
  let end = bytes.length - 22
  const earliest = Math.max(0, end - 65535)
  while (end >= earliest && (u32(end) !== ZIP_END || end + 22 + u16(end + 20) !== bytes.length)) end--
  if (end < earliest) {
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      zipError('encrypted and legacy Word files are unsupported.')
    }
    zipError('the archive directory is missing.')
  }

  const count = u16(end + 10)
  const centralSize = u32(end + 12)
  const central = u32(end + 16)
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || !count || count > MAX_ENTRIES) {
    zipError('invalid disk or entry count.')
  }
  if (central + centralSize !== end || centralSize < count * 46) {
    zipError('invalid archive directory bounds.')
  }

  function checkExtra(start: number, end: number) {
    for (let offset = start; offset < end;) {
      if (offset + 4 > end) zipError('malformed entry metadata.')
      const id = u16(offset)
      const size = u16(offset + 2)
      if (id === 0x0001 || id === 0x7075 || id === 0x9901) zipError('unsupported entry metadata.')
      offset += 4 + size
      if (offset > end) zipError('malformed entry metadata.')
    }
  }

  const entries = new Map<string, Entry>()
  const localRanges: { start: number; end: number }[] = []
  let expanded = 0
  let offset = central
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || u32(offset) !== ZIP_CENTRAL) zipError('malformed archive directory.')
    const flags = u16(offset + 8)
    const method = u16(offset + 10)
    const crc = u32(offset + 16)
    const compressed = u32(offset + 20)
    const size = u32(offset + 24)
    const nameStart = offset + 46
    const nameEnd = nameStart + u16(offset + 28)
    const extraEnd = nameEnd + u16(offset + 30)
    const nextOffset = extraEnd + u16(offset + 32)
    const local = u32(offset + 42)
    if (nextOffset > end || u16(offset + 34) !== 0 || local + 30 > central) zipError('invalid entry bounds.')
    if (flags & 0x2041) zipError('encrypted entries are unsupported.')
    if ((flags & ~0x080e) || (method !== 0 && method !== 8)) zipError('unsupported compression or entry flags.')
    if ((method === 0 && compressed !== size) || (method === 8 && compressed < 2)) {
      zipError('inconsistent compression sizes.')
    }
    expanded += size
    if (size > MAX_ENTRY || expanded > MAX_EXPANDED) zipError('the archive exceeds the expanded size limit.')
    if (size > Math.max(RATIO_FLOOR, compressed * MAX_RATIO)) zipError('an entry exceeds the compression ratio limit.')

    const rawName = bytes.subarray(nameStart, nameEnd)
    const name = entryName(rawName, flags)
    if (entries.has(name)) zipError('duplicate package paths.')
    checkExtra(nameEnd, extraEnd)
    if (u32(local) !== ZIP_LOCAL || u16(local + 6) !== flags || u16(local + 8) !== method ||
      u16(local + 26) !== rawName.length) zipError('entry headers disagree.')
    const localNameStart = local + 30
    const localExtraStart = localNameStart + rawName.length
    const dataStart = localExtraStart + u16(local + 28)
    const dataEnd = dataStart + compressed
    if (dataEnd > central) zipError('invalid entry data bounds.')
    if (rawName.some((byte, index) => bytes[localNameStart + index] !== byte)) zipError('entry paths disagree.')
    checkExtra(localExtraStart, dataStart)

    let localEnd = dataEnd
    const localSizes = [u32(local + 14), u32(local + 18), u32(local + 22)]
    const expected = [crc, compressed, size]
    if (flags & 8) {
      if (localSizes.some((value, index) => value !== 0 && value !== expected[index])) {
        zipError('entry sizes disagree.')
      }
      if (localEnd + 16 <= central && u32(localEnd) === ZIP_DESCRIPTOR &&
        expected.every((value, index) => u32(localEnd + 4 + index * 4) === value)) {
        localEnd += 4
      }
      if (localEnd + 12 > central || expected.some((value, index) => u32(localEnd + index * 4) !== value)) {
        zipError('invalid entry data descriptor.')
      }
      localEnd += 12
    } else if (localSizes.some((value, index) => value !== expected[index])) {
      zipError('entry sizes or checksums disagree.')
    }

    const directory = rawName.at(-1) === 47
    if (directory && size) zipError('a directory contains file data.')
    entries.set(name, { name, directory, method, crc, size, start: dataStart, end: dataEnd })
    localRanges.push({ start: local, end: localEnd })
    offset = nextOffset
  }
  if (offset !== end) zipError('unexpected archive directory data.')
  let nextLocal = 0
  for (const range of localRanges.sort((left, right) => left.start - right.start)) {
    if (range.start !== nextLocal) zipError('entries overlap or have unexpected gaps.')
    nextLocal = range.end
  }
  if (nextLocal !== central) zipError('unexpected archive data.')

  const verified = new Set<string>()
  function unpack(entry: Entry) {
    const compressed = bytes.subarray(entry.start, entry.end)
    let result = compressed
    if (entry.method === 8) {
      result = new Uint8Array(entry.size)
      let wrote = 0
      const inflate = new Inflate(chunk => {
        if (wrote + chunk.length > result.length) zipError('an entry expands beyond its declared size.')
        result.set(chunk, wrote)
        wrote += chunk.length
      })
      for (let index = 0; index < compressed.length; index += INFLATE_CHUNK) {
        const end = Math.min(index + INFLATE_CHUNK, compressed.length)
        try {
          inflate.push(compressed.subarray(index, end), end === compressed.length)
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Invalid or unsupported DOCX ZIP:')) throw error
          zipError('invalid compressed entry.')
        }
      }
      if (wrote !== entry.size) zipError('an entry does not match its declared size.')
    }
    if (crc32(result) !== entry.crc) zipError('entry checksum mismatch.')
    verified.add(entry.name)
    return result
  }

  return {
    names: [...entries.values()].filter(entry => !entry.directory).map(entry => entry.name),
    size(name: string) {
      const entry = entries.get(name)
      return entry?.directory ? undefined : entry?.size
    },
    read(name: string) {
      const entry = entries.get(name)
      if (!entry || entry.directory) throw new Error(`A required DOCX package part is missing: ${name}.`)
      return unpack(entry)
    },
    verifyRemaining() {
      for (const entry of entries.values()) {
        if (!verified.has(entry.name)) unpack(entry)
      }
    },
  }
}
