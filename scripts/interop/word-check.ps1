# Opens one Folio-generated DOCX read-only in Microsoft Word through COM automation and writes what Word sees
# to <name>.word.json beside it. Macros are force-disabled for this automation session only (AutomationSecurity = 3).
# No Office setting is changed and no document is saved.
#
# Usage, from a local folder outside OneDrive:
#   powershell -NoProfile -File scripts/interop/word-check.ps1 -Path C:\path\to\folio-formatting.docx
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$file = Get-Item -LiteralPath $Path
$output = Join-Path $file.DirectoryName ($file.BaseName + '.word.json')
function Hex($bgr) { $v = [int]$bgr; if ($v -lt 0) { return "auto($v)" }; '#{0:X2}{1:X2}{2:X2}' -f ($v -band 0xFF), (($v -shr 8) -band 0xFF), (($v -shr 16) -band 0xFF) }

$word = New-Object -ComObject Word.Application
try {
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, ..., Revert, ..., Visible, OpenAndRepair = false)
  $doc = $word.Documents.Open($file.FullName, $false, $true, $false, [Type]::Missing, [Type]::Missing, $false, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, $false, $false)
  $report = [ordered]@{ word = "$($word.Version) build $($word.Build)"; file = $file.Name; openedName = $doc.Name; protectedView = $word.ProtectedViewWindows.Count; paragraphs = @() }
  for ($i = 1; $i -le $doc.Paragraphs.Count; $i++) {
    $paragraph = $doc.Paragraphs.Item($i)
    $range = $paragraph.Range
    $font = $range.Font
    $report.paragraphs += [ordered]@{
      text = $range.Text.Trim(); style = $paragraph.Style.NameLocal; alignment = $paragraph.Alignment; leftIndentPoints = $paragraph.LeftIndent
      list = $range.ListFormat.ListType
      fontName = $font.Name; fontSize = $font.Size; color = Hex $font.Color; strike = $font.StrikeThrough; bold = $font.Bold
      highlight = $range.HighlightColorIndex; shading = Hex $font.Shading.BackgroundPatternColor
    }
  }
  $doc.Close($false)
  $report | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $output
  Write-Output "wrote $output"
} finally {
  $word.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
