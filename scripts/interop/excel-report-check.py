"""Checks the <name>.excel.json reports written by excel-check.ps1 against the fixture expectations.

Usage: python -I scripts/interop/excel-report-check.py <folder with the .excel.json reports>
The expectations match scripts/interop/openpyxl-check.py, as Microsoft Excel reports them through COM.
"""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
failures = []


def check(label, actual, expected):
    ok = actual == expected
    print(f"  {'ok  ' if ok else 'FAIL'} {label}: {actual!r}" + ('' if ok else f' (expected {expected!r})'))
    if not ok:
        failures.append(label)


def report(name):
    data = json.loads((root / f'{name}.excel.json').read_text(encoding='utf-8-sig'))
    print(f"== {name}.xlsx (Excel {data['excel']})")
    check('opened without repair', (data['repairLogs'], data['protectedView'], data['openedName']), ([], 0, f'{name}.xlsx'))
    sheets = {sheet['name']: sheet for sheet in data['sheets']}
    return data, [sheet['name'] for sheet in data['sheets']], sheets


def cell(sheets, sheet, address):
    return sheets[sheet]['cells'].get(address, {})


def borders(entry):
    # Edges 8 top, 9 bottom. LineStyle 1 continuous, -4119 double. Weight 2 thin, 4 thick.
    return dict(part.split(':') for part in entry.get('borders', '').split() if part)


data, order, sheets = report('folio-features')
s = 'Summary'
check('sheet order', order, ['Summary', 'Data 2026', 'Notes'])
check('leading-zero identifier is text', (cell(sheets, s, 'B2')['value'], cell(sheets, s, 'B2')['text']), ('00420', '00420'))
check('number format', (cell(sheets, s, 'B3')['value'], cell(sheets, s, 'B3')['text']), (1234.5, '1,234.50'))
check('currency format', (cell(sheets, s, 'B4')['value'], cell(sheets, s, 'B4')['text']), (19.99, '$19.99'))
check('percent format', cell(sheets, s, 'B5')['text'], '12.50%')
check('boolean', cell(sheets, s, 'B6')['text'], 'TRUE')
check('serial date', (cell(sheets, s, 'B7')['text'], cell(sheets, s, 'B7')['numberFormat']), ('2026-11-26', 'yyyy-mm-dd'))
check('ISO date cell is a date', cell(sheets, s, 'B8')['value'], 46352)
check('title font', cell(sheets, s, 'A1')['font'].split(' b=')[0] + ' b=' + cell(sheets, s, 'A1')['font'].split(' b=')[1][:4], 'Georgia 16 b=True')
font = cell(sheets, s, 'A9')['font']
check('italic, underline, strike', ('i=True' in font, 'u=2' in font, 's=True' in font), (True, True, True))
check('fill and font color', (cell(sheets, s, 'B9')['fill'], cell(sheets, s, 'B9')['font'].endswith('#FFFFFF')), ('#3A6B35', True))
check('centered and wrapped', (cell(sheets, s, 'B9')['horizontal'], cell(sheets, s, 'B9')['wrap']), (-4108, True))
check('theme accent fill', cell(sheets, s, 'A10')['fill'], '#E5EEDF')
edges = borders(cell(sheets, s, 'A11'))
check('thin top and double bottom border', (edges.get('8'), edges.get('9', '').split('/')[0]), ('1/2', '-4119'))
check('merge', cell(sheets, s, 'A12')['merged'], 'A12:C12')
check('conditional formats', sheets[s]['conditionalFormats'], 2)
check('theme accent1 (Forest)', data['themeAccent1'], '#3A6B35')
check('cross-sheet formula', cell(sheets, s, 'A14')['formula'], "=SUM('Data 2026'!B2:B4)")
check('stored results', [cell(sheets, s, a)['text'] for a in ('A14', 'A15', 'A16', 'A17')], ['60', '154.31', 'Yes', '2'])
check('Excel recalculation matches', [data['recalculated'].get(f'Summary!{a}') for a in ('A14', 'A15', 'A16', 'A17')], ['60', '154.31', 'Yes', '2'])

data, order, sheets = report('folio-structure')
check('renamed sheet and order', order, ['Summary', 'Data Renamed', 'Notes'])
check('row insert and rename in formula', cell(sheets, s, 'A14')['formula'], "=SUM('Data Renamed'!B2:B5)")
check('column insert and delete keep references', cell(sheets, s, 'A15')['formula'], '=ROUND(B3*B5, 2)')
check('ROUND stored and recalculated agree', (cell(sheets, s, 'A15')['text'], data['recalculated'].get('Summary!A15')), (cell(sheets, s, 'A15')['text'],) * 2)
check('inserted row', (cell(sheets, 'Data Renamed', 'A3')['value'], cell(sheets, 'Data Renamed', 'B3')['value']), ('Inserted', 5))
check('merge', cell(sheets, s, 'A12')['merged'], 'A12:C12')
check('stored and recalculated sum agree', (cell(sheets, s, 'A14')['text'], data['recalculated'].get('Summary!A14')), (cell(sheets, s, 'A14')['text'],) * 2)

for name, extra in (('folio-native-save', None), ('folio-native-save-as', 'Save As copy')):
    data, order, sheets = report(name)
    check('sheet order', order, ['Summary', 'Data 2026', 'Notes'])
    check('identifier', cell(sheets, s, 'A2')['value'], '00420')
    check('styled title', (cell(sheets, s, 'A1')['font'].startswith('Georgia'), cell(sheets, s, 'A1')['fill']), (True, '#3A6B35'))
    check('currency and double border', (cell(sheets, s, 'A3')['numberFormat'], borders(cell(sheets, s, 'A3')).get('9', '').split('/')[0]), ('$#,##0.00', '-4119'))
    check('formula, stored and recalculated', (cell(sheets, s, 'A4')['formula'], cell(sheets, s, 'A4')['text'], data['recalculated'].get('Summary!A4')), ("=SUM('Data 2026'!B1:B2)", '30', '30'))
    check('merge', cell(sheets, s, 'A6')['merged'], 'A6:C6')
    check('conditional formatting', sheets[s]['conditionalFormats'], 1)
    check('edit saved by Folio', cell(sheets, s, 'C2').get('value'), 'Edited in Folio')
    check('Save As edit only in the new file', cell(sheets, s, 'C3').get('value'), extra)
    check('theme accent1 (Forest)', data['themeAccent1'], '#3A6B35')

print('FAILED: ' + ', '.join(failures) if failures else 'ALL EXCEL CHECKS PASSED')
sys.exit(1 if failures else 0)
