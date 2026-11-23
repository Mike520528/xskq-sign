$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT
& (Join-Path $ROOT 'node.exe') (Join-Path $ROOT 'sign-auto.mjs')