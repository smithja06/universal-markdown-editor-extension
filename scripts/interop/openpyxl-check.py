"""Independent check of Folio-generated XLSX fixtures with openpyxl (no Folio or IronCalc code).

Usage: python -I scripts/interop/openpyxl-check.py test-results/interop/xlsx
Exits non-zero when an expectation fails. Expectations match scripts/interop/xlsx-fixtures.ts and the
`XLSX Save and Save As keep sheets…` desktop case.
"""
import sys
import warnings
import zipfile
from pathlib import Path

import openpyxl

warnings.simplefilter('error')  # openpyxl warns about malformed parts; treat that as a failure.
root = Path(sys.argv[1])
failures = []


def check(label, actual, expected):
    ok = actual == expected
    print(f"  {'ok  ' if ok else 'FAIL'} {label}: {actual!r}" + ('' if ok else f' (expected {expected!r})'))
    if not ok:
        failures.append(label)


def rgb(color):
    return None if color is None or color.rgb is None or not isinstance(color.rgb, str) else '#' + color.rgb[-6:].lower()


def iso(value):
    return value.isoformat()[:10] if hasattr(value, 'isoformat') else value


def theme_accent(path, slot='accent1'):
    xml = zipfile.ZipFile(path).read('xl/theme/theme1.xml').decode()
    start = xml.index(f'<a:{slot}>')
    return xml[start:start + 80].split('val="')[1][:6].lower()


def workbook(path):
    print(f'== {path.name}')
    with warnings.catch_warnings():
        warnings.simplefilter('error')
        return openpyxl.load_workbook(path), openpyxl.load_workbook(path, data_only=True)


features = root / 'folio-features.xlsx'
wb, cached = workbook(features)
s, c = wb['Summary'], cached['Summary']
check('sheet order', wb.sheetnames, ['Summary', 'Data 2026', 'Notes'])
check('leading-zero identifier stays text', (s['B2'].value, s['B2'].data_type), ('00420', 's'))
check('number and format', (s['B3'].value, s['B3'].number_format), (1234.5, '#,##0.00'))
check('currency format', (s['B4'].value, s['B4'].number_format), (19.99, '"$"#,##0.00'))
check('percent format', (s['B5'].value, s['B5'].number_format), (0.125, '0.00%'))
check('boolean', s['B6'].value, True)
check('serial date with date format', (iso(s['B7'].value), s['B7'].number_format), ('2026-11-26', 'yyyy-mm-dd'))
check('ISO date cell', iso(s['B8'].value), '2026-11-26')
check('font family, size, bold', (s['A1'].font.name, s['A1'].font.sz, s['A1'].font.b), ('Georgia', 16.0, True))
check('italic, underline, strike', (s['A9'].font.i, s['A9'].font.u, s['A9'].font.strike), (True, 'single', True))
check('fill and font color', (rgb(s['B9'].fill.fgColor), rgb(s['B9'].font.color)), ('#3a6b35', '#ffffff'))
check('alignment and wrap', (s['B9'].alignment.horizontal, s['B9'].alignment.vertical, s['B9'].alignment.wrap_text), ('center', 'center', True))
check('theme accent style fill', rgb(s['A10'].fill.fgColor), '#e5eedf')
check('borders', (s['A11'].border.top.style, s['A11'].border.bottom.style, rgb(s['A11'].border.bottom.color)), ('thin', 'double', '#9b3240'))
check('merged range', [str(r) for r in s.merged_cells.ranges], ['A12:C12'])
check('conditional formatting ranges', sorted(str(r.sqref) for r in s.conditional_formatting), ['C2:C4', 'D2:D4'])
check('conditional rule types', sorted(rule.type for r in s.conditional_formatting for rule in r.rules), ['cellIs', 'colorScale'])
check('theme accent1 (Forest)', theme_accent(features), '3a6b35')
check('cross-sheet formula', s['A14'].value, "=SUM('Data 2026'!B2:B4)")
check('cached results', [c['A14'].value, c['A15'].value, c['A16'].value, c['A17'].value], [60, 154.31, 'Yes', 2])
check('column width set', s.column_dimensions['A'].width is not None, True)

structure = root / 'folio-structure.xlsx'
wb, cached = workbook(structure)
s = wb['Summary']
check('renamed sheet and order', wb.sheetnames, ['Summary', 'Data Renamed', 'Notes'])
check('row insert expands cross-sheet range, rename updates it', s['A14'].value, "=SUM('Data Renamed'!B2:B5)")
check('column insert then delete leaves references', s['A15'].value, '=ROUND(B3*B5, 2)')
check('inserted row content', (wb['Data Renamed']['A3'].value, wb['Data Renamed']['B3'].value, wb['Data Renamed']['A4'].value), ('Inserted', 5, 'South'))
check('merge survives column insert and delete', [str(r) for r in s.merged_cells.ranges], ['A12:C12'])

for name, extra in (('folio-native-save.xlsx', None), ('folio-native-save-as.xlsx', 'Save As copy')):
    wb, cached = workbook(root / name)
    s = wb['Summary']
    check('sheet order', wb.sheetnames, ['Summary', 'Data 2026', 'Notes'])
    check('identifier', s['A2'].value, '00420')
    check('styled title', (s['A1'].font.name, s['A1'].font.b, rgb(s['A1'].fill.fgColor)), ('Georgia', True, '#3a6b35'))
    check('currency and double border', (s['A3'].number_format, s['A3'].border.bottom.style), ('"$"#,##0.00', 'double'))
    check('formula and cache', (s['A4'].value, cached['Summary']['A4'].value), ("=SUM('Data 2026'!B1:B2)", 30))
    check('merge', [str(r) for r in s.merged_cells.ranges], ['A6:C6'])
    check('conditional formatting', len(list(s.conditional_formatting)), 1)
    check('edit saved by Folio', s['C2'].value, 'Edited in Folio')
    check('Save As edit only in the new file', s['C3'].value, extra)
    check('theme accent1 (Forest)', theme_accent(root / name), '3a6b35')

print('FAILED: ' + ', '.join(failures) if failures else 'ALL CHECKS PASSED')
sys.exit(1 if failures else 0)
