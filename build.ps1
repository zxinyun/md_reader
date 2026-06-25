$ErrorActionPreference = 'Stop'
$env:PATH = "D:\code\rust\bin;D:\code\mingw64\bin;D:\Program Files (x86)\NSIS;$env:PATH"
$env:CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS = "fallback"

npm run tauri:build
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }

Write-Host "Build succeeded! Outputs:" -ForegroundColor Green
$msi = Get-ChildItem -LiteralPath "src-tauri\target\release\bundle\msi" -Filter "*.msi" | Select-Object -First 1
if ($msi) { Write-Host "  MSI: $($msi.FullName) ($([math]::Round($msi.Length/1KB)) KB)" -ForegroundColor Cyan }
$nsis = Get-ChildItem -LiteralPath "src-tauri\target\release\bundle\nsis" -Filter "*.exe" | Select-Object -First 1
if ($nsis) { Write-Host "  NSIS: $($nsis.FullName) ($([math]::Round($nsis.Length/1KB)) KB)" -ForegroundColor Cyan }
