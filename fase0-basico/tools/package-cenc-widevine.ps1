param(
  [ValidateSet("raw-key", "widevine-service")]
  [string]$Mode = "raw-key"
)

$ErrorActionPreference = "Stop"

$phaseDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $phaseDir
$contentRoot = Join-Path $repoRoot "origin-content"
$inputFile = Join-Path $contentRoot "mp4\video_144p_108k_h264.mp4"
$outputDir = Join-Path $contentRoot "dash-widevine"

if (-not (Test-Path -LiteralPath $inputFile)) {
  throw "No existe el MP4 de entrada: $inputFile"
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$descriptor = "in=/media/mp4/video_144p_108k_h264.mp4,stream=video,init_segment=/media/dash-widevine/video_init.mp4,segment_template=/media/dash-widevine/video_`$Number`$.m4s"
$commonArgs = @(
  $descriptor,
  "--protection_scheme", "cenc",
  "--clear_lead", "0",
  "--mpd_output", "/media/dash-widevine/stream.mpd"
)

if ($Mode -eq "widevine-service") {
  $required = @(
    "WIDEVINE_KEY_SERVER_URL",
    "WIDEVINE_CONTENT_ID",
    "WIDEVINE_SIGNER",
    "WIDEVINE_AES_SIGNING_KEY",
    "WIDEVINE_AES_SIGNING_IV"
  )

  foreach ($name in $required) {
    if (-not [Environment]::GetEnvironmentVariable($name)) {
      throw "Falta la variable de entorno $name para usar Widevine Cloud Service."
    }
  }

  $drmArgs = @(
    "--enable_widevine_encryption",
    "--key_server_url", $env:WIDEVINE_KEY_SERVER_URL,
    "--content_id", $env:WIDEVINE_CONTENT_ID,
    "--signer", $env:WIDEVINE_SIGNER,
    "--aes_signing_key", $env:WIDEVINE_AES_SIGNING_KEY,
    "--aes_signing_iv", $env:WIDEVINE_AES_SIGNING_IV
  )
} else {
  # Claves de laboratorio, no productivas. Sirven para generar CENC con senalizacion Widevine.
  $keyId = "1e5d4f9f3a2b4c7d8e9f001122334455"
  $key = "00112233445566778899aabbccddeeff"
  $drmArgs = @(
    "--enable_raw_key_encryption",
    "--keys", "label=:key_id=${keyId}:key=${key}",
    "--protection_systems", "Widevine"
  )
}

$packagerArgs = @($commonArgs + $drmArgs)

docker run --rm `
  -v "${contentRoot}:/media" `
  google/shaka-packager:latest `
  packager `
  @packagerArgs

if ($LASTEXITCODE -ne 0) {
  throw "Shaka Packager fallo con codigo $LASTEXITCODE. Comprueba que Docker Desktop esta arrancado."
}

Write-Host "Contenido generado en $outputDir"
Write-Host "MPD: $outputDir\stream.mpd"
