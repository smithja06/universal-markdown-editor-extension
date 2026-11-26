// Keep the supported formula help and worker admission list together.
export const formulaCatalog = [
  { name: 'SUM', category: 'Math', syntax: 'SUM(number1, [number2], …)', description: 'Adds numbers or cell ranges.', example: '=SUM(A1:A4)' },
  { name: 'ABS', category: 'Math', syntax: 'ABS(number)', description: 'Returns magnitude without a sign.', example: '=ABS(-12)' },
  { name: 'ROUND', category: 'Math', syntax: 'ROUND(number, digits)', description: 'Rounds to a chosen number of digits.', example: '=ROUND(A1, 2)' },
  { name: 'MIN', category: 'Statistics', syntax: 'MIN(number1, [number2], …)', description: 'Returns the smallest number.', example: '=MIN(A1:A4)' },
  { name: 'MAX', category: 'Statistics', syntax: 'MAX(number1, [number2], …)', description: 'Returns the largest number.', example: '=MAX(A1:A4)' },
  { name: 'COUNT', category: 'Statistics', syntax: 'COUNT(value1, [value2], …)', description: 'Counts numeric cells.', example: '=COUNT(A1:A4)' },
  { name: 'AVERAGE', category: 'Statistics', syntax: 'AVERAGE(number1, [number2], …)', description: 'Returns the arithmetic mean.', example: '=AVERAGE(A1:A4)' },
  { name: 'IF', category: 'Logic', syntax: 'IF(test, if_true, if_false)', description: 'Returns a value based on a condition.', example: '=IF(A1>0, "Gain", "Loss")' },
  { name: 'AND', category: 'Logic', syntax: 'AND(logical1, [logical2], …)', description: 'Returns TRUE when all conditions are true.', example: '=AND(A1>0, B1>0)' },
  { name: 'OR', category: 'Logic', syntax: 'OR(logical1, [logical2], …)', description: 'Returns TRUE when any condition is true.', example: '=OR(A1>0, B1>0)' },
  { name: 'NOT', category: 'Logic', syntax: 'NOT(logical)', description: 'Reverses a logical value.', example: '=NOT(A1=0)' },
  { name: 'LEN', category: 'Text', syntax: 'LEN(text)', description: 'Counts characters in text.', example: '=LEN(A1)' },
  { name: 'TODAY', category: 'Date & time', syntax: 'TODAY()', description: 'Returns today’s date in the workbook timezone and 1900 date system.', example: '=TODAY()' },
  { name: 'NOW', category: 'Date & time', syntax: 'NOW()', description: 'Returns the current date and time in the workbook timezone and 1900 date system.', example: '=NOW()' },
] as const
