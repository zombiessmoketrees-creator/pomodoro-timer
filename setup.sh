#!/usr/bin/env bash
# macOS setup (Apple Silicon MacBook Pro). Also works on Linux if node, python3
# and ffmpeg are already installed. Safe to re-run: every step is idempotent.
set -euo pipefail

cd "$(dirname "$0")"
say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"

# --- System tools -----------------------------------------------------------
if [ "$OS" = "Darwin" ]; then
  have brew || fail "Homebrew is required. Install it from https://brew.sh and re-run ./setup.sh"
  say "Checking Homebrew packages"
  have node   || brew install node
  have ffmpeg || brew install ffmpeg
  # MediaPipe and faster-whisper publish wheels for 3.10-3.12; pin a known-good interpreter.
  have python3.12 || brew install python@3.12
fi

have node   || fail "Node.js 18+ is not installed."
have ffmpeg || fail "FFmpeg is not installed."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js 18+ is required (found $(node -v)). Run: brew upgrade node"

PYTHON=""
for candidate in python3.12 python3.11 python3.10 python3; do
  if have "$candidate" && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
    PYTHON="$candidate"; break
  fi
done
[ -n "$PYTHON" ] || fail "Python 3.10+ is required."

ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' subtitles ' \
  || fail "This FFmpeg build lacks libass (needed for burned-in captions). Run: brew reinstall ffmpeg"

say "Tools: node $(node -v), $($PYTHON --version), $(ffmpeg -version | head -n1 | cut -d' ' -f1-3)"

# --- Python engine ----------------------------------------------------------
say "Creating Python virtual environment (.venv)"
[ -d .venv ] || "$PYTHON" -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
say "Installing Python packages (yt-dlp, faster-whisper, OpenCV, MediaPipe)"
.venv/bin/python -m pip install --quiet -r engine/requirements.txt

# --- Remotion studio --------------------------------------------------------
say "Installing Remotion studio packages"
if [ -f studio/package-lock.json ]; then (cd studio && npm ci --no-fund --no-audit); else (cd studio && npm install --no-fund --no-audit); fi
say "Making sure Remotion's headless browser is available"
(cd studio && npx --no-install remotion browser ensure) || echo "  (skipped — Remotion will download it on the first render)"

# --- Face-tracking models (git-ignored, ~5 MB) -------------------------------
say "Downloading MediaPipe face models"
BASE="https://storage.googleapis.com/mediapipe-models"
mkdir -p engine/models
[ -s engine/models/face_detector.tflite ] || curl -fsSL -o engine/models/face_detector.tflite \
  "$BASE/face_detector/blaze_face_full_range/float16/latest/blaze_face_full_range.tflite" \
  || echo "  (download failed — the clipper retries on first use)"
[ -s engine/models/face_landmarker.task ] || curl -fsSL -o engine/models/face_landmarker.task \
  "$BASE/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
  || echo "  (download failed — the clipper retries on first use)"

# --- Local config -----------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env — set OBSIDIAN_VAULT_PATH in it before using the Obsidian bridge"
fi
mkdir -p media output

say "Running environment check"
.venv/bin/python engine/render.py doctor

cat <<'DONE'

Setup complete.
  Test render:   .venv/bin/python engine/render.py render sample --format vertical
  Preview:       .venv/bin/python engine/render.py preview sample
  Then open this folder in Claude Code:  claude
DONE
