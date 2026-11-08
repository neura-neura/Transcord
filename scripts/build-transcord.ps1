$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$hex = Join-Path $PWD "vendor/hex/hex.exe"
$hash = "8EB6DFB49D59D30D7834FDBE52E4AC598A650989C2611590585FB4210D4FD1B2"
if (!(Test-Path -LiteralPath $hex)) {
    curl.exe --fail --location --retry 2 "https://github.com/anomalyco/hex/releases/download/v3.3.0/hex-3.3.0-windows-x64.exe" --output "$hex.download"
    if ($LASTEXITCODE -ne 0) { throw "Could not download Hex." }
    if ((Get-FileHash -LiteralPath "$hex.download").Hash -ne $hash) { throw "Hex checksum mismatch." }
    Move-Item -LiteralPath "$hex.download" -Destination $hex
}
if ((Get-FileHash -LiteralPath $hex).Hash -ne $hash) { throw "Hex checksum mismatch." }


$ollama = Join-Path $PWD "vendor/ollama"
if (!(Test-Path -LiteralPath (Join-Path $ollama "ollama.exe"))) {
    $archive = Join-Path $PWD "dist/ollama-windows-amd64-v0.40.14.zip"
    $extract = Join-Path $PWD "dist/ollama-v0.40.14"
    New-Item -ItemType Directory -Force (Split-Path $archive), $extract | Out-Null
    $ollamaHash = "65D68CADE6CF6375F398B518224F8C8A15E062387F38CF477ABFC848DE7E7E29"
    if (!(Test-Path -LiteralPath $archive)) {
        curl.exe --fail --location --retry 2 "https://github.com/ollama/ollama/releases/download/v0.40.14/ollama-windows-amd64.zip" --output "$archive.download"
        if ($LASTEXITCODE -ne 0) { throw "Could not download Ollama." }
        if ((Get-FileHash -LiteralPath "$archive.download").Hash -ne $ollamaHash) { throw "Ollama checksum mismatch." }
        Move-Item -LiteralPath "$archive.download" -Destination $archive
    }
    if ((Get-FileHash -LiteralPath $archive).Hash -ne $ollamaHash) { throw "Ollama checksum mismatch." }
    tar.exe -xf $archive -C $extract
    if ($LASTEXITCODE -ne 0) { throw "Could not extract Ollama." }
    $runtime = Join-Path $ollama "lib/ollama"
    New-Item -ItemType Directory -Force $runtime | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $extract "lib/ollama") -File | Copy-Item -Destination $runtime
    Copy-Item -LiteralPath (Join-Path $extract "ollama.exe") -Destination $ollama
}
if (!(Test-Path -LiteralPath (Join-Path $ollama "lib/ollama/ggml.dll"))) { throw "Ollama CPU runtime is incomplete." }

npx.cmd --yes pnpm@12.16.1 install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Could not install dependencies." }
node node_modules/tsx/dist/cli.mjs scripts/build/build.mts
if ($LASTEXITCODE -ne 0) { throw "Could not build Transcord." }
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
node node_modules/electron-builder/out/cli/cli.js --win nsis --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw "Could not package Transcord." }
