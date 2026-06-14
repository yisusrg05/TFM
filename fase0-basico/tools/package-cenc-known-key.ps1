$ErrorActionPreference = "Stop"

$phaseDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $phaseDir
$contentRoot = Join-Path $repoRoot "origin-content"
$inputFile = Join-Path $contentRoot "mp4\video_144p_108k_h264.mp4"
$outputDir = Join-Path $contentRoot "dash-known-key"

$keyId = "1e5d4f9f3a2b4c7d8e9f001122334455"
$key = "00112233445566778899aabbccddeeff"

if (-not (Test-Path -LiteralPath $inputFile)) {
  throw "No existe el MP4 de entrada: $inputFile"
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$descriptor = "in=/media/mp4/video_144p_108k_h264.mp4,stream=video,init_segment=/media/dash-known-key/video_init.mp4,segment_template=/media/dash-known-key/video_`$Number`$.m4s"

docker run --rm `
  -v "${contentRoot}:/media" `
  google/shaka-packager:latest `
  $descriptor `
  --enable_raw_key_encryption `
  --keys "label=:key_id=$keyId:key=$key" `
  --protection_scheme cenc `
  --protection_systems CommonSystem `
  --clear_lead 0 `
  --mpd_output /media/dash-known-key/stream.mpd

if ($LASTEXITCODE -ne 0) {
  throw "Shaka Packager fallo con codigo $LASTEXITCODE. Comprueba que Docker Desktop esta arrancado."
}

Write-Host "Contenido CENC con clave conocida generado en $outputDir"
Write-Host "MPD: $outputDir\stream.mpd"
Write-Host "KID: $keyId"
Write-Host "KEY: $key"
