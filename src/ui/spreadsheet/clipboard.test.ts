import { expect, it } from 'vitest'
import { decodeTypedClipboard, encodeTypedClipboard } from './clipboard'

it('keeps literal workbook text distinct from formulas and typed cell values', () => {
  const data = encodeTypedClipboard([[{ kind: 'text', value: '=SUM(1,1)' }, { kind: 'text', value: 'TRUE' },
    { kind: 'text', value: "'literal" }, { kind: 'formula', value: '=1+1', cached: 99 }, { kind: 'number', value: 7 }, undefined]], false)
  expect(decodeTypedClipboard(data, false)).toEqual([[{ kind: 'text', value: '=SUM(1,1)' }, { kind: 'text', value: 'TRUE' },
    { kind: 'text', value: "'literal" }, { kind: 'formula', value: '=1+1' }, { kind: 'number', value: 7 }, undefined]])
})

it('rejects invalid or overlong typed clipboard data', () => {
  expect(decodeTypedClipboard('{"date1904":false,"rows":[[{"kind":"formula","value":"no formula"}]]}', false)).toBeUndefined()
  expect(decodeTypedClipboard('{"date1904":false,"rows":[[{"kind":"text","value":"' + 'a'.repeat(32768) + '"}]]}', false)).toBeUndefined()
  expect(decodeTypedClipboard('{"date1904":false,"rows":[[{"kind":"number","value":1e999}]]}', false)).toBeUndefined()
})

it('keeps dates unchanged across workbook date systems where a matching date exists', () => {
  expect(decodeTypedClipboard(encodeTypedClipboard([[{ kind: 'date', value: 1462.5 }]], false), true))
    .toEqual([[{ kind: 'date', value: .5 }]])
  expect(decodeTypedClipboard(encodeTypedClipboard([[{ kind: 'date', value: 60.5 }]], false), true))
    .toEqual([[{ kind: 'text', value: '1900-02-29' }]])
})
