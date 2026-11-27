import { describe, expect, it } from 'vitest'
import { applySuggestion, argumentHint, formulaAssist, unsupportedFunctions } from './formulaAssist'

describe('formula assistance', () => {
  it('suggests catalog functions for the name at the cursor', () => {
    const state = formulaAssist('=SU', 3)
    expect(state.suggestions.map(entry => entry.name).slice(0, 4)).toEqual(['SUM', 'SUMPRODUCT', 'SUMIF', 'SUMIFS'])
    expect(state.start).toBe(1)
    expect(formulaAssist('=A1+co', 6).suggestions.map(entry => entry.name)).toContain('COUNTIF')
    expect(formulaAssist('SU', 2).suggestions).toEqual([])
    expect(formulaAssist('="SU', 4).suggestions).toEqual([])
    expect(formulaAssist("='Su", 4).suggestions).toEqual([])
    expect(formulaAssist('=Sheet1!SU', 10).suggestions).toEqual([])
    expect(formulaAssist('=SUM(', 4).suggestions).toEqual([])
  })

  it('tracks the innermost supported call and its argument', () => {
    const state = formulaAssist('=ROUND(SUM(A1, B1), ', 20)
    expect(state.call?.entry.name).toBe('ROUND')
    expect(state.call?.argument).toBe(1)
    expect(formulaAssist('=SUM(A1, B', 10).call).toMatchObject({ argument: 1 })
    expect(formulaAssist('=IF(A1=",", ', 12).call?.argument).toBe(1)
  })

  it('inserts the function name and an opening parenthesis', () => {
    expect(applySuggestion('=su+1', 1, 3, 'SUM')).toEqual({ value: '=SUM(+1', cursor: 5 })
    expect(applySuggestion('=su(A1)', 1, 3, 'SUM')).toEqual({ value: '=SUM(A1)', cursor: 5 })
  })

  it('reports functions outside the supported list without flagging text', () => {
    expect(unsupportedFunctions('=OFFSET(A1, 1, 0) + SUM(A1) + "FAKE(1)"')).toEqual(['OFFSET'])
    expect(formulaAssist('=INDIRECT("A1")', 15).unsupported).toEqual(['INDIRECT'])
  })

  it('keeps variadic arguments on their repeating label', () => {
    const sum = formulaAssist('=SUM(', 5).call!.entry
    expect(argumentHint(sum, 0).active).toBe(0)
    expect(argumentHint(sum, 5).active).toBe(1)
    const round = formulaAssist('=ROUND(', 7).call!.entry
    expect(argumentHint(round, 2).active).toBe(-1)
  })
})
