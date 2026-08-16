# Write the plan-review Neon URL to a local file. Never git. Never print the secret.
# Usage: powershell -File P:\plan-review\scripts\put-dsn.ps1

$ErrorActionPreference = "Stop"
$dir = Join-Path $env:USERPROFILE ".empressa"
$path = Join-Path $dir "plan-review.database_url"

New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host "Paste the Neon DATABASE_URL, then Enter. It will not be echoed to git."
$dsn = (Read-Host).Trim()
if ($dsn -notmatch '^postgres(ql)?://') {
  throw "Does not look like a postgres URL."
}
if ($dsn -match 'fancy-fire|lucky-truth|06136146|tiny-art|snowy-bread|hauska.mcp|cortex-prod') {
  throw "Refusing cortex-prod / smartcity / smart-files / atoms DSN. Plan-review Neon only."
}

Set-Content -Path $path -Value $dsn -NoNewline -Encoding utf8
icacls $path /inheritance:r | Out-Null
icacls $path /grant:r "$($env:USERNAME):(R,W)" | Out-Null

$item = Get-Item $path
Write-Host "Wrote $($item.FullName) length=$($item.Length) bytes at $($item.LastWriteTime.ToString('o'))"
Write-Host "DSN not printed. Verify later with: node P:\plan-review\scripts\apply-sql.mjs sql/001_foundation.sql"
