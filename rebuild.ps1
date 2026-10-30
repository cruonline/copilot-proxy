# Rebuild and reinstall the extension
Write-Host "Compiling..." -ForegroundColor Cyan
npm run compile
if ($LASTEXITCODE -ne 0) { exit 1 }

# Every installed rebuild gets a distinct version in VS Code and the panel.
npm version patch --no-git-tag-version
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Packaging..." -ForegroundColor Cyan
$manifest = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
$vsixPath = "$($manifest.name)-$($manifest.version).vsix"
npx --yes @vscode/vsce package --no-dependencies --out $vsixPath
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Installing..." -ForegroundColor Cyan
code --install-extension $vsixPath --force
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Done! Reload VS Code window (Ctrl+Shift+P -> 'Reload Window')" -ForegroundColor Green
