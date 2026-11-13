# Windows setup (NVIDIA gaming PC). Run from the repo folder in PowerShell:
#     powershell -ExecutionPolicy Bypass -File .\setup.ps1
# Safe to re-run: every step is idempotent.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Say($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}
function Install-WithWinget($id, $name) {
    if (-not (Have "winget")) { Fail "$name is missing and winget is not available. Install $name manually, then re-run." }
    Say "Installing $name"
    winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

# --- System tools -----------------------------------------------------------
if (-not (Have "node"))   { Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS" }
if (-not (Have "ffmpeg")) { Install-WithWinget "Gyan.FFmpeg" "FFmpeg (full build)" }

# Find Python 3.10-3.12 (the versions MediaPipe and faster-whisper ship wheels for).
function Find-Python {
    foreach ($v in @("3.12", "3.11", "3.10")) {
        if (Have "py") {
            & py "-$v" -c "import sys" 2>$null
            if ($LASTEXITCODE -eq 0) { return @{ Exe = "py"; Args = @("-$v") } }
        }
    }
    if (Have "python") {
        & python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) { return @{ Exe = "python"; Args = @() } }
    }
    return $null
}
$python = Find-Python
if (-not $python) {
    Install-WithWinget "Python.Python.3.12" "Python 3.12"
    $python = Find-Python
}
if (-not $python) { Fail "Python 3.10+ was not found. Close and reopen PowerShell, then re-run this script." }
if (-not (Have "node"))   { Fail "Node.js was installed but is not on PATH yet. Reopen PowerShell and re-run." }
if (-not (Have "ffmpeg")) { Fail "FFmpeg was installed but is not on PATH yet. Reopen PowerShell and re-run." }

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) { Fail "Node.js 18+ is required (found $(node -v))." }
if (-not ((& ffmpeg -hide_banner -filters 2>$null) -match " subtitles ")) {
    Fail "This FFmpeg build lacks libass (needed for burned-in captions). Install the full build: winget install Gyan.FFmpeg"
}
Say "Tools: node $(node -v), $(& $python.Exe @($python.Args) --version), ffmpeg ok"

# --- Python engine ----------------------------------------------------------
Say "Creating Python virtual environment (.venv)"
if (-not (Test-Path ".venv")) { & $python.Exe @($python.Args) -m venv .venv }
$venvPy = ".\.venv\Scripts\python.exe"
& $venvPy -m pip install --quiet --upgrade pip
Say "Installing Python packages (yt-dlp, faster-whisper, OpenCV, MediaPipe)"
& $venvPy -m pip install --quiet -r engine\requirements.txt
if ($LASTEXITCODE -ne 0) { Fail "pip install failed." }

# NVIDIA: CUDA runtime libraries so faster-whisper transcribes on the GPU.
if (Have "nvidia-smi") {
    Say "NVIDIA GPU detected - installing CUDA runtime libraries for GPU transcription"
    & $venvPy -m pip install --quiet nvidia-cublas-cu12 "nvidia-cudnn-cu12>=9,<10"
    if ($LASTEXITCODE -ne 0) { Write-Host "  (could not install CUDA libraries - transcription will use the CPU)" -ForegroundColor Yellow }
} else {
    Write-Host "  nvidia-smi not found - rendering and transcription will use the CPU." -ForegroundColor Yellow
}

# --- Remotion studio --------------------------------------------------------
Say "Installing Remotion studio packages"
Push-Location studio
if (Test-Path "package-lock.json") { npm ci --no-fund --no-audit } else { npm install --no-fund --no-audit }
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "npm install failed." }
Say "Making sure Remotion's headless browser is available"
npx --no-install remotion browser ensure
Pop-Location

# --- Face-tracking models (git-ignored, ~5 MB) -------------------------------
Say "Downloading MediaPipe face models"
$base = "https://storage.googleapis.com/mediapipe-models"
New-Item -ItemType Directory -Force -Path "engine\models" | Out-Null
$models = @{
    "engine\models\face_detector.tflite" = "$base/face_detector/blaze_face_full_range/float16/latest/blaze_face_full_range.tflite"
    "engine\models\face_landmarker.task" = "$base/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
}
foreach ($file in $models.Keys) {
    if (-not (Test-Path $file)) {
        try { Invoke-WebRequest -Uri $models[$file] -OutFile $file -UseBasicParsing }
        catch { Write-Host "  (download failed for $file - the clipper retries on first use)" -ForegroundColor Yellow }
    }
}

# --- Local config -----------------------------------------------------------
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Say "Created .env - set OBSIDIAN_VAULT_PATH in it before using the Obsidian bridge"
}
New-Item -ItemType Directory -Force -Path "media", "output" | Out-Null

Say "Running environment check"
& $venvPy engine\render.py doctor

Write-Host @"

Setup complete.
  Test render:   .\.venv\Scripts\python.exe engine\render.py render sample --format vertical
  Preview:       .\.venv\Scripts\python.exe engine\render.py preview sample
  Then open this folder in Claude Code:  claude
"@
