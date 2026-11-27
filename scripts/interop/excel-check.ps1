# Opens one Folio-generated XLSX file read-only in Microsoft Excel through COM automation and writes what Excel sees
# to <name>.excel.json beside it. Macros are force-disabled for this automation session only (AutomationSecurity = 3).
# No Office setting is changed and no workbook is saved.
#
# Usage (one Excel process per file, from a local folder outside OneDrive):
#   powershell -NoProfile -File scripts/interop/excel-check.ps1 -Path C:\path\to\fixture.xlsx
#
# In a new Office profile Excel shows a one-time "Your privacy, your choice" dialog shortly after a workbook loads.
# The read finishes first; the caller then stops this process. Answer the dialog once in Excel to avoid it.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$file = Get-Item -LiteralPath $Path
$output = Join-Path $file.DirectoryName ($file.BaseName + '.excel.json')
$log = Join-Path $file.DirectoryName ($file.BaseName + '.excel.log')
Set-Content $log "start $(Get-Date -Format o)"
function Note([string]$text) { Add-Content $log "$(Get-Date -Format HH:mm:ss) $text" }
function Hex($bgr) { $v = [int]$bgr; '#{0:X2}{1:X2}{2:X2}' -f ($v -band 0xFF), (($v -shr 8) -band 0xFF), (($v -shr 16) -band 0xFF) }

$excel = New-Object -ComObject Excel.Application
# Excel can reject calls while it starts. Wait until it accepts one, then call it directly.
for ($i = 0; $i -lt 120; $i++) { try { $excel.DisplayAlerts = $false; if ($excel.Ready) { break } } catch { }; Start-Sleep -Milliseconds 500 }
try {
  $excel.Visible = $false
  $excel.AutomationSecurity = 3
  $repairBefore = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object FullName)
  # Open(FileName, UpdateLinks = 0, ReadOnly = true)
  $wb = $excel.Workbooks.Open($file.FullName, 0, $true)
  Note "opened $($wb.Name)"
  $report = [ordered]@{
    excel = "$($excel.Version) build $($excel.Build)"; file = $file.Name; openedName = $wb.Name
    protectedView = $excel.ProtectedViewWindows.Count
    repairLogs = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | Where-Object { $repairBefore -notcontains $_.FullName } | ForEach-Object Name)
    calculation = $excel.Calculation; sheets = @(); recalculated = [ordered]@{}
  }
  try { $scheme = $wb.Theme.ThemeColorScheme; $report.themeAccent1 = Hex ($scheme.Colors(5).RGB); $report.themeDark2 = Hex ($scheme.Colors(3).RGB) }
  catch { $report.themeAccent1 = 'unavailable' }
  for ($w = 1; $w -le $wb.Worksheets.Count; $w++) {
    $ws = $wb.Worksheets.Item($w)
    $used = $ws.UsedRange
    $cells = [ordered]@{}
    for ($r = 1; $r -le $used.Rows.Count; $r++) {
      for ($c = 1; $c -le $used.Columns.Count; $c++) {
        $cell = $used.Cells.Item($r, $c)
        if (-not $cell.Formula -and $cell.Interior.ColorIndex -eq -4142 -and -not $cell.MergeCells) { continue }
        $borders = @()
        foreach ($edge in 8, 10, 9, 7) { $b = $cell.Borders.Item($edge); if ($b.LineStyle -ne -4142) { $borders += "${edge}:$($b.LineStyle)/$($b.Weight)" } }
        $cells[$cell.Address($false, $false)] = [ordered]@{
          formula = $cell.Formula; value = $cell.Value2; text = $cell.Text; numberFormat = $cell.NumberFormat
          font = "$($cell.Font.Name) $($cell.Font.Size) b=$($cell.Font.Bold) i=$($cell.Font.Italic) u=$($cell.Font.Underline) s=$($cell.Font.Strikethrough) $(Hex $cell.Font.Color)"
          fill = $(if ($cell.Interior.ColorIndex -ne -4142) { Hex $cell.Interior.Color } else { $null })
          merged = $(if ($cell.MergeCells) { $cell.MergeArea.Address($false, $false) } else { $null }); borders = ($borders -join ' ')
          horizontal = $cell.HorizontalAlignment; wrap = $cell.WrapText
        }
      }
    }
    $report.sheets += [ordered]@{ name = $ws.Name; conditionalFormats = $ws.Cells.FormatConditions.Count; cells = $cells }
  }
  Note 'read'
  # Recalculate each worksheet in memory to compare Excel's results with the stored caches. Nothing is saved.
  try {
    for ($w = 1; $w -le $wb.Worksheets.Count; $w++) {
      $ws = $wb.Worksheets.Item($w); $ws.Calculate(); $used = $ws.UsedRange
      for ($r = 1; $r -le $used.Rows.Count; $r++) { for ($c = 1; $c -le $used.Columns.Count; $c++) {
        $cell = $used.Cells.Item($r, $c)
        if ($cell.HasFormula) { $report.recalculated["$($ws.Name)!$($cell.Address($false, $false))"] = $cell.Text }
      } }
    }
  } catch { $report.recalculated['error'] = $_.Exception.Message }
  $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $output
  Note 'wrote report'
  $wb.Close($false)
} catch { Note "ERROR line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)" }
finally { try { $excel.Quit() } catch { } }
