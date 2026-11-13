"""Shared paths, environment loading and small helpers for the engine scripts."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parent.parent
ENGINE_DIR = ROOT / "engine"
STUDIO_DIR = ROOT / "studio"
STYLES_DIR = ROOT / "styles"
MANIFEST_DIR = STUDIO_DIR / "manifests"
PUBLIC_DIR = STUDIO_DIR / "public"
MODELS_DIR = ENGINE_DIR / "models"

_ENV_LOADED = False


def load_env() -> None:
    """Load <repo>/.env once. Real environment variables win over the file."""
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    _ENV_LOADED = True
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    try:
        from dotenv import load_dotenv

        load_dotenv(env_file, override=False)
    except ImportError:
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env(name: str, default: str = "") -> str:
    load_env()
    return os.environ.get(name, default).strip()


def env_path(name: str, default: Path) -> Path:
    """A directory setting from .env; relative values resolve against the repo root."""
    value = env(name)
    if not value:
        return default
    path = Path(os.path.expandvars(value)).expanduser()
    return path if path.is_absolute() else ROOT / path


def media_dir() -> Path:
    return env_path("MEDIA_DIR", ROOT / "media")


def output_dir() -> Path:
    return env_path("OUTPUT_DIR", ROOT / "output")


def log(message: str) -> None:
    print(f"[studio] {message}", file=sys.stderr, flush=True)


def die(message: str, code: int = 1) -> "NoReturn":  # type: ignore[name-defined]  # noqa: F821
    print(f"[studio] ERROR: {message}", file=sys.stderr, flush=True)
    raise SystemExit(code)


def slugify(text: str, max_length: int = 60) -> str:
    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return slug[:max_length].strip("-") or "untitled"


def which(tool: str) -> str | None:
    """Locate an executable. On Windows this also finds .cmd shims such as npx.cmd."""
    return shutil.which(tool)


def require_tool(tool: str, hint: str) -> str:
    path = which(tool)
    if not path:
        die(f"`{tool}` was not found on PATH. {hint}")
    return path


def run(cmd: Sequence[str | os.PathLike[str]], cwd: Path | None = None, quiet: bool = False) -> None:
    """Run a command, streaming its output; exit with a clear message if it fails."""
    printable = " ".join(str(c) for c in cmd)
    if not quiet:
        log(f"$ {printable}")
    # Child output goes to stderr so each engine command's stdout stays pure JSON.
    result = subprocess.run([str(c) for c in cmd], cwd=str(cwd) if cwd else None, stdout=sys.stderr)
    if result.returncode != 0:
        die(f"Command failed with exit code {result.returncode}: {printable}", result.returncode)


def capture(cmd: Sequence[str | os.PathLike[str]], cwd: Path | None = None) -> tuple[int, str]:
    """Run a command and return (exit code, combined output) without raising."""
    try:
        result = subprocess.run(
            [str(c) for c in cmd],
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except (FileNotFoundError, PermissionError) as exc:
        return 127, str(exc)
    return result.returncode, (result.stdout or "") + (result.stderr or "")


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")  # per-process, so parallel commands cannot collide
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    tmp.replace(path)


def probe_media(path: Path) -> dict[str, Any]:
    """Width/height/fps/duration/has_audio for a media file via ffprobe."""
    ffprobe = require_tool("ffprobe", "Install FFmpeg (it ships ffprobe).")
    code, out = capture(
        [ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]
    )
    if code != 0:
        die(f"ffprobe could not read {path}: {out.strip()}")
    info = json.loads(out)
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    fps = 30.0
    if video and video.get("avg_frame_rate", "0/0") not in ("0/0", ""):
        num, _, den = video["avg_frame_rate"].partition("/")
        fps = float(num) / float(den or 1) if float(den or 1) else 30.0
    return {
        "width": int(video["width"]) if video else 0,
        "height": int(video["height"]) if video else 0,
        "fps": fps,
        "duration": float(info.get("format", {}).get("duration", 0) or 0),
        "has_audio": audio is not None,
        "has_video": video is not None,
    }
