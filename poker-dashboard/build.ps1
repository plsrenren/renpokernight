# Builds two copies of the dashboard from template.html:
#   index.html         - for the claude.ai artifact, with a snapshot of the sheet built in (artifacts can't reach Google)
#   vercel/index.html  - for the hosted site, a full HTML page that reads the sheet live
$dir = $PSScriptRoot
$base = "https://docs.google.com/spreadsheets/d/1YxoWSWgeTRrEiPlm1Ys85s4UsHKxSzpPHEssynXEytM/gviz/tq?tqx=out:csv&sheet="
function Get-Tab($name) {
  $c = (Invoke-WebRequest -UseBasicParsing ($base + $name)).Content
  if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
  return $c.Trim()
}
$utf8 = New-Object Text.UTF8Encoding $false
$tpl = [IO.File]::ReadAllText((Join-Path $dir "template.html"))
$date = Get-Date -Format 'MMM d, yyyy'

$artifact = $tpl.Replace('/*__SNAPSHOT__*/', (Get-Tab 'Input')).Replace('/*__MEMBERS__*/', (Get-Tab 'Members')).Replace('/*__SNAPSHOT_DATE__*/', $date)
[IO.File]::WriteAllText((Join-Path $dir "index.html"), $artifact, $utf8)

$body = $tpl.Replace('/*__SNAPSHOT__*/', '').Replace('/*__MEMBERS__*/', '').Replace('/*__SNAPSHOT_DATE__*/', $date)
$site = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + $body + '</body></html>'
New-Item -ItemType Directory -Force (Join-Path $dir "vercel") | Out-Null
[IO.File]::WriteAllText((Join-Path $dir "vercel\index.html"), $site, $utf8)

"Built index.html ($($artifact.Length) chars) and vercel/index.html ($($site.Length) chars)"
