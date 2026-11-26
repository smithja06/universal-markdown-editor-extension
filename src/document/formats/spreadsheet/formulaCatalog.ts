// Keep the supported formula help, autocomplete and worker admission list together. Every entry is evaluated against the
// bundled IronCalc 0.9.1 engine in formulaCatalog.test.ts. Functions that return references indirectly (OFFSET,
// INDIRECT), volatile lookups and locale-dependent conversions stay outside the list.
export const formulaCatalogVersion = 2

export interface FormulaFunction {
  name: string
  category: string
  syntax: string
  description: string
  example: string
  /** IronCalc evaluates these in the 1900 date system only, so 1904 workbooks keep their stored results. */
  date1900?: true
}

export const formulaCatalog: readonly FormulaFunction[] = [
  { name: 'SUM', category: 'Math', syntax: 'SUM(number1, [number2], …)', description: 'Adds numbers or cell ranges.', example: '=SUM(A1:A4)' },
  { name: 'PRODUCT', category: 'Math', syntax: 'PRODUCT(number1, [number2], …)', description: 'Multiplies numbers or cell ranges.', example: '=PRODUCT(A1:A4)' },
  { name: 'SUMPRODUCT', category: 'Math', syntax: 'SUMPRODUCT(array1, [array2], …)', description: 'Multiplies matching items in ranges and adds the products.', example: '=SUMPRODUCT(A1:A4, B1:B4)' },
  { name: 'SUMIF', category: 'Math', syntax: 'SUMIF(range, criteria, [sum_range])', description: 'Adds cells that meet one condition.', example: '=SUMIF(A1:A4, ">10")' },
  { name: 'SUMIFS', category: 'Math', syntax: 'SUMIFS(sum_range, criteria_range1, criteria1, …)', description: 'Adds cells that meet every condition.', example: '=SUMIFS(B1:B4, A1:A4, ">10")' },
  { name: 'ABS', category: 'Math', syntax: 'ABS(number)', description: 'Returns magnitude without a sign.', example: '=ABS(-12)' },
  { name: 'ROUND', category: 'Math', syntax: 'ROUND(number, digits)', description: 'Rounds to a chosen number of digits.', example: '=ROUND(A1, 2)' },
  { name: 'ROUNDUP', category: 'Math', syntax: 'ROUNDUP(number, digits)', description: 'Rounds away from zero.', example: '=ROUNDUP(A1, 1)' },
  { name: 'ROUNDDOWN', category: 'Math', syntax: 'ROUNDDOWN(number, digits)', description: 'Rounds toward zero.', example: '=ROUNDDOWN(A1, 1)' },
  { name: 'INT', category: 'Math', syntax: 'INT(number)', description: 'Rounds down to the nearest integer.', example: '=INT(A1)' },
  { name: 'MOD', category: 'Math', syntax: 'MOD(number, divisor)', description: 'Returns the remainder after division.', example: '=MOD(A1, 3)' },
  { name: 'POWER', category: 'Math', syntax: 'POWER(number, power)', description: 'Raises a number to a power.', example: '=POWER(2, 8)' },
  { name: 'SQRT', category: 'Math', syntax: 'SQRT(number)', description: 'Returns the positive square root.', example: '=SQRT(A1)' },
  { name: 'PI', category: 'Math', syntax: 'PI()', description: 'Returns π to 15 digits.', example: '=PI()' },
  { name: 'MIN', category: 'Statistics', syntax: 'MIN(number1, [number2], …)', description: 'Returns the smallest number.', example: '=MIN(A1:A4)' },
  { name: 'MAX', category: 'Statistics', syntax: 'MAX(number1, [number2], …)', description: 'Returns the largest number.', example: '=MAX(A1:A4)' },
  { name: 'COUNT', category: 'Statistics', syntax: 'COUNT(value1, [value2], …)', description: 'Counts numeric cells.', example: '=COUNT(A1:A4)' },
  { name: 'COUNTA', category: 'Statistics', syntax: 'COUNTA(value1, [value2], …)', description: 'Counts cells that are not empty.', example: '=COUNTA(A1:A4)' },
  { name: 'COUNTBLANK', category: 'Statistics', syntax: 'COUNTBLANK(range)', description: 'Counts empty cells in a range.', example: '=COUNTBLANK(A1:A4)' },
  { name: 'COUNTIF', category: 'Statistics', syntax: 'COUNTIF(range, criteria)', description: 'Counts cells that meet one condition.', example: '=COUNTIF(A1:A4, ">10")' },
  { name: 'COUNTIFS', category: 'Statistics', syntax: 'COUNTIFS(criteria_range1, criteria1, …)', description: 'Counts cells that meet every condition.', example: '=COUNTIFS(A1:A4, ">10")' },
  { name: 'AVERAGE', category: 'Statistics', syntax: 'AVERAGE(number1, [number2], …)', description: 'Returns the arithmetic mean.', example: '=AVERAGE(A1:A4)' },
  { name: 'AVERAGEIF', category: 'Statistics', syntax: 'AVERAGEIF(range, criteria, [average_range])', description: 'Averages cells that meet one condition.', example: '=AVERAGEIF(A1:A4, ">0")' },
  { name: 'MEDIAN', category: 'Statistics', syntax: 'MEDIAN(number1, [number2], …)', description: 'Returns the middle value.', example: '=MEDIAN(A1:A4)' },
  { name: 'IF', category: 'Logic', syntax: 'IF(test, if_true, if_false)', description: 'Returns a value based on a condition.', example: '=IF(A1>0, "Gain", "Loss")' },
  { name: 'IFS', category: 'Logic', syntax: 'IFS(test1, value1, [test2, value2], …)', description: 'Returns the value for the first true condition.', example: '=IFS(A1>9, "High", A1>4, "Mid", TRUE, "Low")' },
  { name: 'IFERROR', category: 'Logic', syntax: 'IFERROR(value, value_if_error)', description: 'Returns a fallback when a formula produces an error.', example: '=IFERROR(A1/B1, 0)' },
  { name: 'SWITCH', category: 'Logic', syntax: 'SWITCH(expression, value1, result1, …, [default])', description: 'Returns the result for the first matching value.', example: '=SWITCH(A1, 1, "One", 2, "Two", "Other")' },
  { name: 'AND', category: 'Logic', syntax: 'AND(logical1, [logical2], …)', description: 'Returns TRUE when all conditions are true.', example: '=AND(A1>0, B1>0)' },
  { name: 'OR', category: 'Logic', syntax: 'OR(logical1, [logical2], …)', description: 'Returns TRUE when any condition is true.', example: '=OR(A1>0, B1>0)' },
  { name: 'XOR', category: 'Logic', syntax: 'XOR(logical1, [logical2], …)', description: 'Returns TRUE when an odd number of conditions are true.', example: '=XOR(A1>0, B1>0)' },
  { name: 'NOT', category: 'Logic', syntax: 'NOT(logical)', description: 'Reverses a logical value.', example: '=NOT(A1=0)' },
  { name: 'ISBLANK', category: 'Information', syntax: 'ISBLANK(value)', description: 'Returns TRUE for an empty cell.', example: '=ISBLANK(A1)' },
  { name: 'ISNUMBER', category: 'Information', syntax: 'ISNUMBER(value)', description: 'Returns TRUE for a number.', example: '=ISNUMBER(A1)' },
  { name: 'ISTEXT', category: 'Information', syntax: 'ISTEXT(value)', description: 'Returns TRUE for text.', example: '=ISTEXT(A1)' },
  { name: 'LEN', category: 'Text', syntax: 'LEN(text)', description: 'Counts characters in text.', example: '=LEN(A1)' },
  { name: 'LEFT', category: 'Text', syntax: 'LEFT(text, [count])', description: 'Returns characters from the start of text.', example: '=LEFT(A1, 3)' },
  { name: 'RIGHT', category: 'Text', syntax: 'RIGHT(text, [count])', description: 'Returns characters from the end of text.', example: '=RIGHT(A1, 3)' },
  { name: 'MID', category: 'Text', syntax: 'MID(text, start, count)', description: 'Returns characters from the middle of text.', example: '=MID(A1, 2, 3)' },
  { name: 'UPPER', category: 'Text', syntax: 'UPPER(text)', description: 'Converts text to uppercase.', example: '=UPPER(A1)' },
  { name: 'LOWER', category: 'Text', syntax: 'LOWER(text)', description: 'Converts text to lowercase.', example: '=LOWER(A1)' },
  { name: 'TRIM', category: 'Text', syntax: 'TRIM(text)', description: 'Removes extra spaces between and around words.', example: '=TRIM(A1)' },
  { name: 'CONCAT', category: 'Text', syntax: 'CONCAT(text1, [text2], …)', description: 'Joins text and ranges.', example: '=CONCAT(A1, " ", B1)' },
  { name: 'CONCATENATE', category: 'Text', syntax: 'CONCATENATE(text1, [text2], …)', description: 'Joins text values.', example: '=CONCATENATE(A1, " ", B1)' },
  { name: 'TEXTJOIN', category: 'Text', syntax: 'TEXTJOIN(delimiter, ignore_empty, text1, …)', description: 'Joins text with a delimiter.', example: '=TEXTJOIN(", ", TRUE, A1:A4)' },
  { name: 'FIND', category: 'Text', syntax: 'FIND(find_text, within_text, [start])', description: 'Finds text with matching case.', example: '=FIND("-", A1)' },
  { name: 'SEARCH', category: 'Text', syntax: 'SEARCH(find_text, within_text, [start])', description: 'Finds text ignoring case.', example: '=SEARCH("total", A1)' },
  { name: 'SUBSTITUTE', category: 'Text', syntax: 'SUBSTITUTE(text, old_text, new_text, [instance])', description: 'Replaces matching text.', example: '=SUBSTITUTE(A1, "-", " ")' },
  { name: 'REPT', category: 'Text', syntax: 'REPT(text, count)', description: 'Repeats text.', example: '=REPT("*", A1)' },
  { name: 'EXACT', category: 'Text', syntax: 'EXACT(text1, text2)', description: 'Returns TRUE when two texts match exactly.', example: '=EXACT(A1, B1)' },
  { name: 'VLOOKUP', category: 'Lookup', syntax: 'VLOOKUP(value, table, column, [approximate])', description: 'Finds a value in the first column of a table.', example: '=VLOOKUP(A1, D1:E9, 2, FALSE)' },
  { name: 'HLOOKUP', category: 'Lookup', syntax: 'HLOOKUP(value, table, row, [approximate])', description: 'Finds a value in the first row of a table.', example: '=HLOOKUP(A1, D1:K2, 2, FALSE)' },
  { name: 'INDEX', category: 'Lookup', syntax: 'INDEX(range, row, [column])', description: 'Returns the value at a position in a range.', example: '=INDEX(D1:E9, 3, 2)' },
  { name: 'MATCH', category: 'Lookup', syntax: 'MATCH(value, range, [match_type])', description: 'Returns the position of a value in a range.', example: '=MATCH(A1, D1:D9, 0)' },
  { name: 'DATE', category: 'Date & time', syntax: 'DATE(year, month, day)', description: 'Returns the serial number of a date. Apply a date format to show it as a date.', example: '=DATE(2026, 11, 26)', date1900: true },
  { name: 'YEAR', category: 'Date & time', syntax: 'YEAR(date)', description: 'Returns the year of a date.', example: '=YEAR(A1)', date1900: true },
  { name: 'MONTH', category: 'Date & time', syntax: 'MONTH(date)', description: 'Returns the month of a date, 1 to 12.', example: '=MONTH(A1)', date1900: true },
  { name: 'DAY', category: 'Date & time', syntax: 'DAY(date)', description: 'Returns the day of the month, 1 to 31.', example: '=DAY(A1)', date1900: true },
  { name: 'WEEKDAY', category: 'Date & time', syntax: 'WEEKDAY(date, [type])', description: 'Returns the day of the week. Sunday is 1 by default.', example: '=WEEKDAY(A1)', date1900: true },
  { name: 'TODAY', category: 'Date & time', syntax: 'TODAY()', description: 'Returns today’s date in the workbook timezone and 1900 date system.', example: '=TODAY()', date1900: true },
  { name: 'NOW', category: 'Date & time', syntax: 'NOW()', description: 'Returns the current date and time in the workbook timezone and 1900 date system.', example: '=NOW()', date1900: true },
]

const byName = new Map(formulaCatalog.map(entry => [entry.name, entry]))

export function catalogFunction(name: string) {
  return byName.get(name.toUpperCase())
}

/** Argument labels from the documented syntax, for example `number1`, `[number2]` and `…`. */
export function formulaArguments(entry: FormulaFunction) {
  const inner = entry.syntax.slice(entry.syntax.indexOf('(') + 1, entry.syntax.lastIndexOf(')'))
  return inner ? inner.split(/,\s*/) : []
}
