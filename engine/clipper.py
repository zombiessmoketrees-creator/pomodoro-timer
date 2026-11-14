#!/usr/bin/env python3
"""YouTube / local video clipper: download -> transcribe -> find hooks -> reframe -> caption.

    python engine/clipper.py auto <url-or-file> [--count 3] [--aspect 9:16] [--style kinetic-typography]
    python engine/clipper.py download <url>
    python engine/clipper.py transcribe <url|file|video-id>
    python engine/clipper.py candidates <url|file|video-id> [--count 8] [--min 20] [--max 60]
    python engine/clipper.py cut <url|file|video-id> --clips clips.json
    python engine/clipper.py cut <url|file|video-id> --top 3
    python engine/clipper.py cut <url|file|video-id> --start 1:02 --end 1:41 --title "The hook line"

Everything runs locally: yt-dlp downloads, faster-whisper gives word-level
timestamps, OpenCV + MediaPipe track the active speaker for the vertical crop,
and FFmpeg cuts, burns the animated captions and encodes with the GPU encoder
detected by hw.py.

Working files live in media/raw/<video-id>/ and finished clips in
output/clips/<video-id>/ (both git-ignored). Only download videos you own or
have permission to reuse.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import hw  # noqa: E402
from common import (  # noqa: E402
    ENGINE_DIR, MODELS_DIR, die, env, log, media_dir, output_dir, probe_media, read_json,
    require_tool, run, slugify, write_json,
)
from manifest import list_styles, load_style  # noqa: E402

MODEL_BASE = "https://storage.googleapis.com/mediapipe-models"
# Stage 1 finds faces of any size in the wide frame; stage 2 reads lip landmarks on each face crop.
FACE_MODELS = {
    "face_detector.tflite": f"{MODEL_BASE}/face_detector/blaze_face_full_range/float16/latest/blaze_face_full_range.tflite",
    "face_landmarker.task": f"{MODEL_BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
}
OUTPUT_SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350)}
CLIP_FPS = 30
ANALYSIS_FPS = 6          # face/motion samples per second
SPEAKER_WINDOW = 0.8      # seconds of mouth movement considered on each side of a sample
SPEAKER_HOLD = 0.7        # a new speaker must lead this long before the camera switches

# Burned-in captions are drawn by libass with *system* fonts. Theme families map
# to fonts that ship with both Windows and macOS unless the real TTF/OTF is in
# engine/fonts (drop e.g. Anton-Regular.ttf there for an exact match).
SYSTEM_FONT_FALLBACK = {
    "Anton": "Impact", "Inter": "Arial", "Space Grotesk": "Arial", "IBM Plex Sans": "Arial",
    "Playfair Display": "Georgia", "JetBrains Mono": "Courier New",
}
DEFAULT_CAPTIONS = {"fontFamily": "Anton", "fontSize": 92, "color": "#ffffff", "highlight": "#ffe600",
                    "outline": "#000000", "position": "bottom", "wordsPerGroup": 3, "uppercase": True}

POWER_WORDS = {
    "secret", "truth", "mistake", "mistakes", "never", "always", "nobody", "everyone", "worst", "best",
    "biggest", "crazy", "insane", "shocking", "surprising", "wrong", "lie", "lies", "myth", "actually",
    "literally", "million", "billion", "free", "easy", "hard", "impossible", "dangerous", "warning",
    "stop", "quit", "fail", "failed", "failure", "win", "won", "lost", "money", "rich", "broke", "love",
    "hate", "fear", "afraid", "regret", "changed", "destroyed", "killed", "genius", "stupid", "weird",
    "hidden", "proof", "proven", "science", "study", "simple", "fastest", "instantly", "problem", "reason",
}
STRONG_OPENERS = re.compile(
    r"^(here'?s|here is|this is (the|why|how|what)|the (biggest|real|truth|secret|reason|problem|first|only|most|best|worst)"
    r"|why|how|what if|what happens|imagine|nobody|no one|most people|stop|never|everyone|everybody"
    r"|i (was|used to|spent|lost|made|quit|learned|realized|thought)|you('re| are| need| should| don'?t| will| can| have)"
    r"|if you|one thing|the moment|there'?s (a|one|this)|let me tell you|did you know|have you ever)\b", re.IGNORECASE)
DANGLING_OPENERS = re.compile(
    r"^(and|but|so|because|or|which|that|it|they|he|she|this|those|these|then|also|yeah|yes|no|um|uh|right|okay|ok|well|like|i mean|you know)\b",
    re.IGNORECASE)


# --------------------------------------------------------------------------- #
# Source handling
# --------------------------------------------------------------------------- #
def is_url(value: str) -> bool:
    return bool(re.match(r"^https?://", value))


def parse_time(value: str | float | int) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    parts = str(value).strip().split(":")
    try:
        seconds = 0.0
        for part in parts:
            seconds = seconds * 60 + float(part)
        return seconds
    except ValueError:
        die(f"Could not read time '{value}'. Use seconds (83.5) or mm:ss / hh:mm:ss.")


def download(url: str, max_height: int = 1080) -> Path:
    """Download a video with yt-dlp into media/raw/<id>/ and return that folder."""
    try:
        import yt_dlp
    except ImportError:
        die("yt-dlp is not installed. Run: pip install -r engine/requirements.txt")
    require_tool("ffmpeg", "yt-dlp needs FFmpeg to merge video and audio.")

    raw = media_dir() / "raw"
    with yt_dlp.YoutubeDL({"quiet": True, "noplaylist": True, "skip_download": True}) as ydl:
        try:
            meta = ydl.extract_info(url, download=False)
        except yt_dlp.utils.DownloadError as exc:
            die(f"yt-dlp could not read that URL: {exc}")
    video_id = slugify(str(meta.get("id") or meta.get("title") or "video"), 40)
    work = raw / video_id
    work.mkdir(parents=True, exist_ok=True)

    existing = next((p for p in work.glob("source.*") if p.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov")), None)
    if existing:
        log(f"Already downloaded: {existing}")
    else:
        options = {
            # Prefer H.264/AAC up to the height cap: it decodes everywhere without a transcode.
            "format": f"bv*[height<={max_height}]+ba/b[height<={max_height}]/b",
            "format_sort": [f"res:{max_height}", "vcodec:h264", "acodec:m4a"],
            "merge_output_format": "mp4",
            "outtmpl": str(work / "source.%(ext)s"),
            "noplaylist": True,
            "quiet": False,
            "no_warnings": False,
            "retries": 5,
        }
        with yt_dlp.YoutubeDL(options) as ydl:
            try:
                ydl.download([url])
            except yt_dlp.utils.DownloadError as exc:
                die(f"Download failed: {exc}")
        existing = next((p for p in work.glob("source.*") if p.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov")), None)
        if not existing:
            die(f"Download finished but no video file was found in {work}")

    write_json(work / "info.json", {
        "id": video_id,
        "title": meta.get("title") or video_id,
        "uploader": meta.get("uploader") or meta.get("channel") or "",
        "url": meta.get("webpage_url") or url,
        "duration": meta.get("duration") or 0,
        "sourceFile": str(existing),
        "chapters": [{"start": c.get("start_time"), "end": c.get("end_time"), "title": c.get("title")}
                     for c in (meta.get("chapters") or [])],
        # YouTube's "most replayed" curve, when available — a real audience signal for hook finding.
        "categories": meta.get("categories") or [],
        "heatmap": [{"start": h.get("start_time"), "end": h.get("end_time"), "value": h.get("value")}
                    for h in (meta.get("heatmap") or [])],
    })
    return work


def resolve_source(arg: str) -> tuple[Path, Path, dict]:
    """Turn a URL, a local file or a video id into (work dir, source file, info)."""
    if is_url(arg):
        work = download(arg)
    elif Path(arg).expanduser().is_file():
        source = Path(arg).expanduser().resolve()
        digest = hashlib.sha1(str(source).encode("utf-8")).hexdigest()[:8]
        work = media_dir() / "raw" / f"{slugify(source.stem, 32)}-{digest}"
        work.mkdir(parents=True, exist_ok=True)
        if not (work / "info.json").exists():
            write_json(work / "info.json", {"id": work.name, "title": source.stem, "uploader": "", "url": "",
                                            "duration": probe_media(source)["duration"], "sourceFile": str(source),
                                            "chapters": [], "heatmap": []})
    else:
        work = Path(arg).expanduser() if Path(arg).expanduser().is_dir() else media_dir() / "raw" / arg
        if not (work / "info.json").exists():
            die(f"'{arg}' is not a URL, a video file, or a known video id under {media_dir() / 'raw'}")
    info = read_json(work / "info.json")
    source = Path(info["sourceFile"])
    if not source.is_file():
        die(f"Source video is missing: {source}. Download it again on this machine.")
    return work, source, info


# --------------------------------------------------------------------------- #
# Transcription
# --------------------------------------------------------------------------- #
def expose_nvidia_libraries() -> None:
    """Windows only: let CTranslate2 find cuBLAS/cuDNN installed by pip (nvidia-*-cu12 wheels)."""
    if sys.platform != "win32":
        return
    import os
    import site

    for base in [*site.getsitepackages(), site.getusersitepackages()]:
        for bin_dir in Path(base).glob("nvidia/*/bin"):
            try:
                os.add_dll_directory(str(bin_dir))
                os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"
            except OSError:
                pass


def transcribe(work: Path, source: Path, force: bool = False) -> dict:
    """Word-level transcript via faster-whisper, cached in <work>/transcript.json."""
    cached = work / "transcript.json"
    if cached.exists() and not force:
        return read_json(cached)
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        die("faster-whisper is not installed. Run: pip install -r engine/requirements.txt")

    expose_nvidia_libraries()
    device = env("WHISPER_DEVICE", "auto").lower()
    if device == "auto":
        try:
            import ctranslate2

            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:  # noqa: BLE001 - any probing failure means CPU
            device = "cpu"
    # Bigger model on a GPU; a CPU-friendly one otherwise (Apple Silicon runs on CPU here).
    model_name = env("WHISPER_MODEL") or ("large-v3-turbo" if device == "cuda" else "small")
    language = env("WHISPER_LANGUAGE") or None

    def attempt(dev: str) -> dict:
        compute = env("WHISPER_COMPUTE_TYPE") or ("float16" if dev == "cuda" else "int8")
        log(f"Transcribing with faster-whisper '{model_name}' on {dev} ({compute}) — the first run downloads the model")
        model = WhisperModel(model_name, device=dev, compute_type=compute)
        segments_iter, meta = model.transcribe(str(source), word_timestamps=True, vad_filter=True,
                                               language=language, beam_size=5)
        segments = []
        for seg in segments_iter:
            words = [{"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3),
                      "prob": round(w.probability, 3)} for w in (seg.words or []) if w.word.strip()]
            if words:
                segments.append({"start": round(seg.start, 3), "end": round(seg.end, 3),
                                 "text": seg.text.strip(), "words": words})
            if len(segments) % 40 == 0 and segments:
                log(f"  ...{seg.end:.0f}s / {meta.duration:.0f}s")
        return {"language": meta.language, "duration": round(meta.duration, 3), "model": model_name,
                "device": dev, "segments": segments}

    try:
        transcript = attempt(device)
    except Exception as exc:  # noqa: BLE001 - typically missing CUDA/cuDNN libraries
        if device == "cpu":
            die(f"Transcription failed: {exc}")
        log(f"GPU transcription failed ({exc}); retrying on CPU.")
        model_name = env("WHISPER_MODEL") or "small"
        transcript = attempt("cpu")

    if not transcript["segments"]:
        die("No speech was detected in this video, so there is nothing to clip or caption.")
    write_json(cached, transcript)
    lines = [f"[{fmt_clock(s['start'])} - {fmt_clock(s['end'])}] {s['text']}" for s in transcript["segments"]]
    (work / "transcript.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return transcript


def fmt_clock(seconds: float) -> str:
    minutes, secs = divmod(max(0.0, seconds), 60)
    hours, minutes = divmod(int(minutes), 60)
    return f"{hours:d}:{minutes:02d}:{secs:04.1f}" if hours else f"{minutes:d}:{secs:04.1f}"


def all_words(transcript: dict) -> list[dict]:
    return [w for seg in transcript["segments"] for w in seg["words"]]


# --------------------------------------------------------------------------- #
# Hook / candidate detection
# --------------------------------------------------------------------------- #
def build_sentences(words: list[dict]) -> list[dict]:
    sentences: list[dict] = []
    current: list[dict] = []
    for i, word in enumerate(words):
        current.append(word)
        gap = words[i + 1]["start"] - word["end"] if i + 1 < len(words) else 99.0
        if re.search(r"[.!?…][\"')\]]*$", word["word"]) or gap > 0.9 or len(current) >= 40:
            sentences.append({"start": current[0]["start"], "end": current[-1]["end"],
                              "text": " ".join(w["word"] for w in current), "words": len(current),
                              "gap_after": gap})
            current = []
    return sentences


def score_window(sentences: list[dict], i: int, j: int, heatmap: list[dict]) -> tuple[float, list[str]]:
    first, last = sentences[i], sentences[j]
    duration = last["end"] - first["start"]
    text = " ".join(s["text"] for s in sentences[i:j + 1])
    tokens = re.findall(r"[a-z']+", text.lower())
    opener = first["text"].strip()
    score, reasons = 0.0, []

    if STRONG_OPENERS.match(opener):
        score += 1.5
        reasons.append("strong opening line")
    elif DANGLING_OPENERS.match(opener):
        score -= 2.0
        reasons.append("opens mid-thought")
    if "?" in opener:
        score += 2.0
        reasons.append("opens with a question")
    if re.search(r"\d", opener):
        score += 1.0
        reasons.append("number in the hook")
    hook_power = sum(1 for t in re.findall(r"[a-z']+", opener.lower()) if t in POWER_WORDS)
    if hook_power:
        score += min(1.5, 0.5 * hook_power)
        reasons.append("emotive wording in the hook")
    if first["words"] > 30:
        score -= 1.0
        reasons.append("slow first sentence")

    pace = len(tokens) / max(1.0, duration)
    score += max(-1.0, min(1.0, pace - 2.2))
    if pace >= 2.8:
        reasons.append("fast pace")
    longest_pause = max((s["gap_after"] for s in sentences[i:j]), default=0.0)
    if longest_pause > 2.0:
        score -= 1.0
        reasons.append(f"{longest_pause:.1f}s pause inside")

    body_power = sum(1 for t in tokens if t in POWER_WORDS)
    score += min(1.0, body_power / max(1, len(tokens)) * 25)
    if re.search(r"[.!?…][\"')\]]*$", last["text"]) and last["gap_after"] >= 0.4:
        score += 0.7
        reasons.append("ends on a finished thought")

    if heatmap:
        values = [h["value"] for h in heatmap
                  if h.get("value") is not None and h["end"] > first["start"] and h["start"] < last["end"]]
        if values:
            heat = sum(values) / len(values)
            score += 3.0 * heat
            if heat > 0.5:
                reasons.append("most-replayed section")
    return round(score, 3), reasons


def find_candidates(transcript: dict, info: dict, count: int, min_len: float, max_len: float) -> list[dict]:
    words = all_words(transcript)
    sentences = build_sentences(words)
    total = transcript.get("duration") or (words[-1]["end"] if words else 0)
    windows: list[dict] = []
    ideal = (min_len + max_len) / 2

    for i in range(len(sentences)):
        best: dict | None = None
        for j in range(i, len(sentences)):
            duration = sentences[j]["end"] - sentences[i]["start"]
            if duration > max_len:
                break
            if duration < min_len:
                continue
            score, reasons = score_window(sentences, i, j, info.get("heatmap") or [])
            score -= abs(duration - ideal) / ideal * 0.4  # mild preference for the middle of the range
            if best is None or score > best["score"]:
                best = {"i": i, "j": j, "score": round(score, 3), "reasons": reasons}
        if best:
            windows.append(best)

    windows.sort(key=lambda w: w["score"], reverse=True)
    chosen: list[dict] = []
    for window in windows:
        start, end = sentences[window["i"]]["start"], sentences[window["j"]]["end"]
        overlaps = any(min(end, c["end"]) - max(start, c["start"]) > 0.3 * min(end - start, c["end"] - c["start"])
                       for c in chosen)
        if overlaps:
            continue
        chosen.append({
            "start": round(max(0.0, start - 0.15), 2),
            "end": round(min(total or end + 0.3, end + 0.3), 2),
            "score": window["score"],
            "hook": sentences[window["i"]]["text"],
            "reasons": window["reasons"],
            "text": " ".join(s["text"] for s in sentences[window["i"]:window["j"] + 1]),
        })
        if len(chosen) >= count:
            break
    for rank, candidate in enumerate(chosen, start=1):
        candidate["rank"] = rank
        candidate["duration"] = round(candidate["end"] - candidate["start"], 2)
        candidate["title"] = candidate["hook"][:80]
    return chosen


# --------------------------------------------------------------------------- #
# Music mode: rank moments by sound, not words
# --------------------------------------------------------------------------- #
def resolve_mode(args: argparse.Namespace, info: dict) -> str:
    """speech = rank by transcript hooks; music = rank by audio energy (songs, live sets, music videos)."""
    mode = getattr(args, "mode", "auto")
    if mode != "auto":
        return mode
    return "music" if "music" in [str(c).lower() for c in info.get("categories") or []] else "speech"


def energy_envelope(source: Path, hop: float = 0.25):
    """Loudness (RMS) of the soundtrack in `hop`-second steps."""
    import numpy as np

    ffmpeg = require_tool("ffmpeg", "Install FFmpeg (run setup.sh / setup.ps1).")
    rate = 8000
    result = subprocess.run([ffmpeg, "-v", "error", "-i", str(source), "-vn", "-ac", "1", "-ar", str(rate),
                             "-f", "s16le", "-"], capture_output=True)
    if result.returncode != 0 or not result.stdout:
        die(f"Could not read the audio track of {source}: {result.stderr.decode(errors='replace').strip()}")
    samples = np.frombuffer(result.stdout, dtype="<i2").astype("float32") / 32768.0
    size = int(rate * hop)
    frames = samples[: len(samples) // size * size].reshape(-1, size)
    return np.sqrt((frames ** 2).mean(axis=1)), hop


def find_music_candidates(source: Path, info: dict, count: int, min_len: float, max_len: float) -> list[dict]:
    """The strongest sections of a song: loud, and starting where the energy jumps (a drop or a chorus)."""
    import numpy as np

    env, hop = energy_envelope(source)
    total = len(env) * hop
    length = min(max_len, max(min_len, 28.0))
    if total < min_len:
        die(f"The video is only {total:.0f}s long - shorter than the minimum clip length ({min_len:.0f}s).")
    length = min(length, total)
    span = int(length / hop)
    smooth = np.convolve(env / (np.percentile(env, 95) + 1e-6), np.ones(4) / 4, mode="same")
    csum = np.concatenate([[0.0], np.cumsum(smooth)])
    two_s = int(2 / hop)

    def rise_at(i: int) -> float:
        before = smooth[max(0, i - two_s):i]
        after = smooth[i:i + two_s]
        return float(after.mean() - before.mean()) if len(before) and len(after) else 0.0

    heatmap = [h for h in info.get("heatmap") or [] if h.get("value") is not None]
    windows = []
    for coarse in range(0, max(1, len(env) - span + 1), 2):
        # Snap the start to the sharpest energy jump nearby so the clip opens on a hit, not mid-phrase.
        lo, hi = max(0, coarse - 6), min(len(env) - span, coarse + 6)
        start = max(range(lo, hi + 1), key=rise_at) if hi >= lo else coarse
        mean_energy = float((csum[start + span] - csum[start]) / span)
        rise = rise_at(start)
        t0, t1 = start * hop, (start + span) * hop
        heat_values = [h["value"] for h in heatmap if h["end"] > t0 and h["start"] < t1]
        heat = sum(heat_values) / len(heat_values) if heat_values else 0.0
        windows.append({"start": t0, "end": t1, "energy": mean_energy, "rise": rise, "heat": heat,
                        "score": mean_energy * 2 + max(0.0, rise) * 1.5 + heat * 3})
    if not windows:
        return []
    top_energy = max(w["energy"] for w in windows)
    windows.sort(key=lambda w: w["score"], reverse=True)
    chosen: list[dict] = []
    for w in windows:
        if any(min(w["end"], c["end"]) - max(w["start"], c["start"]) > 0.3 * length for c in chosen):
            continue
        reasons = []
        if w["energy"] >= top_energy * 0.92:
            reasons.append("loudest section")
        if w["rise"] > 0.2:
            reasons.append("opens on a jump in energy")
        if w["heat"] > 0.5:
            reasons.append("most-replayed section")
        chosen.append({"start": round(w["start"], 2), "end": round(min(total, w["end"]), 2), "score": round(w["score"], 3),
                       "hook": "", "reasons": reasons or ["high energy"], "text": ""})
        if len(chosen) >= count:
            break
    for rank, candidate in enumerate(chosen, start=1):
        candidate["rank"] = rank
        candidate["duration"] = round(candidate["end"] - candidate["start"], 2)
        candidate["title"] = f"{info.get('title') or 'clip'} {rank}"
    return chosen


# --------------------------------------------------------------------------- #
# Smart reframing
# --------------------------------------------------------------------------- #
def ensure_model(name: str) -> Path | None:
    """Return a model file from engine/models, downloading it on first use."""
    path = MODELS_DIR / name
    if path.exists() and path.stat().st_size > 100_000:
        return path
    try:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        log(f"Downloading MediaPipe model {name} (one time)")
        tmp = path.with_suffix(path.suffix + ".part")
        urllib.request.urlretrieve(FACE_MODELS[name], tmp)  # noqa: S310 - fixed https URL
        tmp.replace(path)
        return path
    except Exception as exc:  # noqa: BLE001 - offline, proxy, disk...
        log(f"Could not download {name} ({exc}).")
        return None


class FaceAnalyzer:
    """Two-stage face analysis.

    MediaPipe's landmark model only finds faces that fill a good part of the
    image, which fails on wide podcast shots. So a full-range detector locates
    every face first, then the landmark model runs on each padded face crop to
    measure how far the lips are apart.
    """

    DETECT_WIDTH = 640
    MAX_FACES = 4

    def __init__(self, mp, detector, landmarker) -> None:
        self.mp, self.detector, self.landmarker = mp, detector, landmarker

    @classmethod
    def create(cls) -> "FaceAnalyzer | None":
        detector_model = ensure_model("face_detector.tflite")
        if not detector_model:
            log("No face detector model; falling back to motion tracking.")
            return None
        try:
            import mediapipe as mp
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision

            detector = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
                base_options=mp_python.BaseOptions(model_asset_path=str(detector_model)),
                min_detection_confidence=0.5))
            landmarker = None
            landmark_model = ensure_model("face_landmarker.task")
            if landmark_model:
                landmarker = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
                    base_options=mp_python.BaseOptions(model_asset_path=str(landmark_model)),
                    num_faces=1, min_face_detection_confidence=0.3, min_face_presence_confidence=0.3))
            else:
                log("No landmark model: following the largest face instead of the active speaker.")
            return cls(mp, detector, landmarker)
        except Exception as exc:  # noqa: BLE001 - mediapipe missing or incompatible build
            log(f"MediaPipe is unavailable ({exc}); falling back to motion tracking. "
                "On headless Linux install libegl1 and libgles2.")
            return None

    def _image(self, bgr):
        import cv2
        import numpy as np

        return self.mp.Image(image_format=self.mp.ImageFormat.SRGB,
                             data=np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))

    def _mouth_openness(self, frame, x: float, y: float, w: float, h: float) -> float:
        """Lip gap relative to face height (scale-free), from a padded crop around one face."""
        import cv2

        if not self.landmarker:
            return 0.0
        height, width = frame.shape[:2]
        pad_x, pad_y = w * 0.5, h * 0.6
        x0, y0 = int(max(0, x - pad_x)), int(max(0, y - pad_y))
        x1, y1 = int(min(width, x + w + pad_x)), int(min(height, y + h + pad_y))
        if x1 - x0 < 24 or y1 - y0 < 24:
            return 0.0
        crop = frame[y0:y1, x0:x1]
        scale = 256 / max(crop.shape[:2])
        if scale < 1:
            crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        result = self.landmarker.detect(self._image(crop))
        if not result.face_landmarks:
            return 0.0
        lm = result.face_landmarks[0]
        face_height = max(1e-4, abs(lm[152].y - lm[10].y))  # chin to forehead
        return math.hypot(lm[13].x - lm[14].x, lm[13].y - lm[14].y) / face_height  # inner lips

    def faces(self, frame) -> list[tuple[float, float, float]]:
        """Faces in a BGR frame as (centre x 0..1, relative area, mouth openness)."""
        import cv2

        height, width = frame.shape[:2]
        scale = self.DETECT_WIDTH / width
        small = cv2.resize(frame, (self.DETECT_WIDTH, max(2, int(height * scale))), interpolation=cv2.INTER_AREA)
        detections = self.detector.detect(self._image(small)).detections or []
        boxes = sorted((d.bounding_box for d in detections), key=lambda b: -(b.width * b.height))[:self.MAX_FACES]
        found = []
        for box in boxes:
            x, y, w, h = box.origin_x / scale, box.origin_y / scale, box.width / scale, box.height / scale
            found.append(((x + w / 2) / width, (w * h) / (width * height), self._mouth_openness(frame, x, y, w, h)))
        return found

    def close(self) -> None:
        self.detector.close()
        if self.landmarker:
            self.landmarker.close()


def plan_crop(clip: Path, crop_w: int, mode: str) -> tuple[list[int], dict]:
    """Per-frame left edge of the crop window, following the active speaker.

    Samples the clip a few times a second, finds faces, groups them into tracks,
    scores each track by how much its mouth is moving, and then drives a smoothed
    virtual camera toward the speaker. Hard cuts snap instead of panning.
    """
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(clip))
    if not cap.isOpened():
        die(f"OpenCV could not open {clip}")
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    fps = cap.get(cv2.CAP_PROP_FPS) or CLIP_FPS
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    centre_left = (width - crop_w) // 2
    stats = {"mode": "center", "samples": 0, "faceSamples": 0, "cuts": 0, "speakerSwitches": 0}
    if mode == "center" or crop_w >= width - 2:
        cap.release()
        return [max(0, centre_left)] * max(1, total), stats

    analyzer = FaceAnalyzer.create()
    step = max(1, round(fps / ANALYSIS_FPS))
    samples: list[dict] = []  # {frame, faces, motion, cut}
    prev_gray = prev_hist = None
    index = 0
    while True:
        if index % step:
            if not cap.grab():
                break
            index += 1
            continue
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.resize(frame, (640, max(2, int(frame.shape[0] * 640 / frame.shape[1]))), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(cv2.resize(small, (160, 90)), cv2.COLOR_BGR2GRAY)
        hist = cv2.calcHist([cv2.cvtColor(small, cv2.COLOR_BGR2HSV)], [0, 1], None, [16, 16], [0, 180, 0, 256])
        cv2.normalize(hist, hist)

        cut = prev_hist is not None and cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL) < 0.55
        motion = None
        if prev_gray is not None and not cut:
            diff = cv2.absdiff(gray, prev_gray).astype("float32")
            diff[diff < 12] = 0
            columns = diff.sum(axis=0)
            if columns.sum() > 160 * 90 * 0.4:
                motion = float((columns * np.arange(160)).sum() / columns.sum() / 160)
        faces: list[tuple[float, float, float]] = []
        if analyzer:
            try:
                faces = analyzer.faces(frame)
            except Exception as exc:  # noqa: BLE001 - keep going on a per-frame failure
                log(f"Face detection failed on frame {index} ({exc}); using motion tracking from here.")
                analyzer = None
        samples.append({"frame": index, "faces": faces, "motion": motion, "cut": cut})
        prev_gray, prev_hist = gray, hist
        index += 1
    cap.release()
    if analyzer:
        analyzer.close()
    total = max(total, index)
    if not samples:
        return [max(0, centre_left)] * max(1, total), stats

    # Split into shots at hard cuts, then solve each shot independently.
    shots: list[list[dict]] = [[]]
    for sample in samples:
        if sample["cut"] and shots[-1]:
            shots.append([])
        shots[-1].append(sample)
    stats.update(samples=len(samples), cuts=len(shots) - 1,
                 faceSamples=sum(1 for s in samples if s["faces"]))

    half_window = max(1, round(SPEAKER_WINDOW * ANALYSIS_FPS))
    hold = max(1, round(SPEAKER_HOLD * ANALYSIS_FPS))
    targets: list[float | None] = []   # normalised centre x per sample
    snap_at: set[int] = set()          # sample indices where the camera jumps (shot starts)

    for shot in shots:
        snap_at.add(len(targets))
        tracks: list[dict] = []        # {"x": last centre, "points": {sample index: (x, size, mouth)}}
        for k, sample in enumerate(shot):
            used: set[int] = set()
            for cx, size, mouth in sorted(sample["faces"], key=lambda f: -f[1]):
                best, best_d = None, 0.15
                for t_index, track in enumerate(tracks):
                    d = abs(track["x"] - cx)
                    if t_index not in used and d < best_d:
                        best, best_d = t_index, d
                if best is None:
                    tracks.append({"x": cx, "points": {}})
                    best = len(tracks) - 1
                used.add(best)
                tracks[best]["x"] = cx
                tracks[best]["points"][k] = (cx, size, mouth)
        # Ignore blips: a real face stays for at least half a second.
        tracks = [t for t in tracks if len(t["points"]) >= max(2, ANALYSIS_FPS // 2)]

        current: int | None = None
        challenger, challenger_run = None, 0
        for k, sample in enumerate(shot):
            scores: dict[int, float] = {}
            for t_index, track in enumerate(tracks):
                window = [track["points"][n] for n in range(k - half_window, k + half_window + 1) if n in track["points"]]
                if not window:
                    continue
                mouths = [p[2] for p in window]
                size = sum(p[1] for p in window) / len(window)
                activity = float(np.std(mouths)) if len(mouths) >= 3 else 0.0
                # Talking shows up as variance in mouth opening; size breaks ties toward the foreground face.
                scores[t_index] = activity * 12 + math.sqrt(size) * 0.6
            if scores:
                leader = max(scores, key=scores.get)  # type: ignore[arg-type]
                if current is None or current not in scores:
                    current, challenger, challenger_run = leader, None, 0
                elif leader != current and scores[leader] > scores[current] * 1.25:
                    challenger_run = challenger_run + 1 if challenger == leader else 1
                    challenger = leader
                    if challenger_run >= hold:
                        current, challenger, challenger_run = leader, None, 0
                        stats["speakerSwitches"] += 1
                else:
                    challenger, challenger_run = None, 0
                points = tracks[current]["points"]
                nearest = min(points, key=lambda n: abs(n - k))
                targets.append(points[nearest][0])
            elif sample["motion"] is not None:
                targets.append(sample["motion"])
            else:
                targets.append(None)

    if any(s["faces"] for s in samples):
        stats["mode"] = "face"
    elif any(t is not None for t in targets):
        stats["mode"] = "motion"

    # Fill gaps (no face, no motion) from the nearest known target inside the same shot.
    bounds = sorted(snap_at) + [len(targets)]
    for a, b in zip(bounds, bounds[1:]):
        known = [n for n in range(a, b) if targets[n] is not None]
        for n in range(a, b):
            if targets[n] is None:
                targets[n] = targets[min(known, key=lambda m: abs(m - n))] if known else 0.5
        # Median-of-5 removes single-sample jitter without lagging real moves.
        segment = [float(t) for t in targets[a:b]]  # type: ignore[arg-type]
        for n in range(len(segment)):
            neighbourhood = sorted(segment[max(0, n - 2):n + 3])
            targets[a + n] = neighbourhood[len(neighbourhood) // 2]

    # Virtual camera: hold still inside a dead zone, ease toward the target when it leaves it.
    sample_frames = [s["frame"] for s in samples]
    per_frame = np.interp(np.arange(total), sample_frames, [float(t) * width for t in targets])  # type: ignore[arg-type]
    snap_frames = {samples[n]["frame"] for n in snap_at if n < len(samples)}
    dead_zone, max_speed = crop_w * 0.07, crop_w * 0.035
    camera = float(per_frame[0])
    moving = False
    lefts: list[int] = []
    for f in range(total):
        target = float(per_frame[f])
        if f in snap_frames:
            ahead = per_frame[f:f + int(fps * 0.5) + 1]
            camera, moving = float(np.median(ahead)), False
        delta = target - camera
        if abs(delta) > dead_zone:
            moving = True
        if moving:
            camera += max(-max_speed, min(max_speed, delta * 0.12))
            if abs(delta) < crop_w * 0.01:
                moving = False
        lefts.append(int(round(max(0, min(width - crop_w, camera - crop_w / 2)))))
    return lefts, stats


# --------------------------------------------------------------------------- #
# Animated captions (ASS)
# --------------------------------------------------------------------------- #
def ass_color(hex_color: str, alpha: int = 0) -> str:
    r, g, b = hex_color[1:3], hex_color[3:5], hex_color[5:7]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def ass_time(seconds: float) -> str:
    cs = max(0, int(round(seconds * 100)))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def ass_text(text: str) -> str:
    return text.replace("\\", "/").replace("{", "(").replace("}", ")").replace("\n", " ")


def caption_font(family: str) -> tuple[str, bool]:
    """(font name for libass, whether a bundled font file was found in engine/fonts)."""
    fonts_dir = ENGINE_DIR / "fonts"
    key = family.replace(" ", "").lower()
    if fonts_dir.is_dir() and any(key in p.stem.replace("-", "").replace("_", "").lower()
                                  for p in fonts_dir.iterdir() if p.suffix.lower() in (".ttf", ".otf")):
        return family, True
    return SYSTEM_FONT_FALLBACK.get(family, family), False


def build_ass(words: list[dict], style: dict, out_w: int, out_h: int, duration: float,
              position: str, hook: str = "") -> str:
    """Word-synced captions: a few words on screen, the spoken one highlighted, each group pops in."""
    unit = min(out_w, out_h) / 1080
    font, _ = caption_font(style["fontFamily"])
    size = int(style["fontSize"] * unit)
    outline = max(3, int(size * 0.075))
    base, highlight = ass_color(style["color"]), ass_color(style["highlight"])
    alignment, margin_v = {"bottom": (2, int(out_h * 0.2)), "middle": (5, 0), "top": (8, int(out_h * 0.14))}[position]
    margin_h = int(out_w * 0.07)
    hook_size = int(size * 0.62)

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {out_w}
PlayResY: {out_h}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{font},{size},{base},{base},{ass_color(style['outline'])},{ass_color('#000000', 0x60)},-1,0,0,0,100,100,0,0,1,{outline},{max(1, outline // 3)},{alignment},{margin_h},{margin_h},{margin_v},1
Style: Hook,{font},{hook_size},{ass_color('#111111')},{ass_color('#111111')},{ass_color('#ffffff')},{ass_color('#ffffff')},-1,0,0,0,100,100,0,0,3,{max(8, hook_size // 3)},0,8,{margin_h},{margin_h},{int(out_h * 0.09)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    max_words = int(style.get("wordsPerGroup", 3))
    max_chars = 18 if out_h > out_w else 28
    groups: list[list[dict]] = []
    current: list[dict] = []
    chars = 0
    for word in words:
        display = re.sub(r"^[\"'“”‘(\[]+|[\"'“”’)\],.;:]+$", "", word["word"]).strip()
        if not display:
            continue
        if style.get("uppercase"):
            display = display.upper()
        gap = word["start"] - current[-1]["end"] if current else 0
        if current and (len(current) >= max_words or chars + len(display) > max_chars or gap > 0.5):
            groups.append(current)
            current, chars = [], 0
        current.append({"text": display, "start": word["start"], "end": word["end"]})
        chars += len(display) + 1
        if re.search(r"[.!?…][\"')\]]*$", word["word"]):
            groups.append(current)
            current, chars = [], 0
    if current:
        groups.append(current)

    events: list[str] = []
    for g, group in enumerate(groups):
        next_group_start = groups[g + 1][0]["start"] if g + 1 < len(groups) else duration
        for k, word in enumerate(group):
            start = word["start"]
            end = group[k + 1]["start"] if k + 1 < len(group) else min(word["end"] + 0.3, next_group_start)
            end = min(duration, max(end, start + 0.06))
            if start >= duration:
                continue
            parts = [f"{{\\c{highlight}}}{ass_text(w['text'])}{{\\c{base}}}" if n == k else ass_text(w["text"])
                     for n, w in enumerate(group)]
            # Only the first word of a group pops, so the line does not re-bounce on every word.
            pop = "{\\fscx82\\fscy82\\t(0,90,\\fscx100\\fscy100)}" if k == 0 else ""
            events.append(f"Dialogue: 1,{ass_time(start)},{ass_time(end)},Caption,,0,0,0,,{pop}{' '.join(parts)}")

    if hook:
        wrapped, line = [], ""
        for token in ass_text(hook).split():
            if line and len(line) + len(token) > 24:
                wrapped.append(line)
                line = token
            else:
                line = f"{line} {token}".strip()
        wrapped.append(line)
        hook_lines = "\\N".join(wrapped[:3])
        events.append(f"Dialogue: 0,{ass_time(0)},{ass_time(min(3.5, duration))},Hook,,0,0,0,,"
                      "{\\fad(150,250)}" + hook_lines)
    return header + "\n".join(events) + "\n"


# --------------------------------------------------------------------------- #
# Cutting
# --------------------------------------------------------------------------- #
def cut_clip(source: Path, words: list[dict], spec: dict, index: int, work: Path, out_dir: Path,
             args: argparse.Namespace, caption_style: dict, hardware: hw.Hardware) -> dict:
    import cv2

    ffmpeg = require_tool("ffmpeg", "Install FFmpeg (run setup.sh / setup.ps1).")
    start, end = parse_time(spec["start"]), parse_time(spec["end"])
    if end - start < 1:
        die(f"Clip {index} is shorter than one second ({start} -> {end}).")
    duration = end - start
    out_w, out_h = OUTPUT_SIZES[args.aspect]
    title = str(spec.get("title") or spec.get("hook") or f"clip {index}")
    name = f"clip_{index:02d}_{slugify(title, 40)}"
    tmp = work / "tmp" / name
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)

    # 1. Frame-accurate cut to a constant-frame-rate intermediate, so OpenCV's frame
    #    index, the audio and the caption timings all share one clock.
    intermediate = tmp / "cut.mp4"
    run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-i", source,
         "-t", f"{duration:.3f}", "-map", "0:v:0", "-map", "0:a:0?",
         "-vf", f"fps={CLIP_FPS},scale=-2:'min(1080,ih)'", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "14", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", intermediate],
        quiet=True)
    probe = probe_media(intermediate)
    src_w, src_h = probe["width"], probe["height"]

    # 2. Crop geometry: pan horizontally when the source is wider than the target,
    #    otherwise trim top/bottom around the upper-middle of the frame.
    target_ratio = out_w / out_h
    if src_w / src_h > target_ratio:
        crop_w, crop_h = min(src_w, int(round(src_h * target_ratio / 2)) * 2), src_h
    else:
        crop_w, crop_h = src_w, min(src_h, int(round(src_w / target_ratio / 2)) * 2)
    top = int((src_h - crop_h) * 0.4)
    log(f"[{index}] {fmt_clock(start)} -> {fmt_clock(end)} ({duration:.1f}s) — analysing framing")
    lefts, stats = plan_crop(intermediate, crop_w, args.reframe)

    # 3. Captions.
    filters = []
    clip_words = [] if args.no_captions else [
        {"word": w["word"], "start": max(0.0, w["start"] - start), "end": min(duration, w["end"] - start)}
        for w in words if w["end"] > start and w["start"] < end]
    hook = "" if args.no_hook else str(spec.get("hook_text") or spec.get("overlay") or "")
    if clip_words or hook:
        (tmp / "captions.ass").write_text(
            build_ass(clip_words, caption_style, out_w, out_h, duration, args.caption_position, hook),
            encoding="utf-8")
        fonts_dir = ENGINE_DIR / "fonts"
        font_files = [p for p in fonts_dir.iterdir() if p.suffix.lower() in (".ttf", ".otf")] if fonts_dir.is_dir() else []
        if font_files:
            (tmp / "fonts").mkdir()
            for font_file in font_files:
                shutil.copy2(font_file, tmp / "fonts" / font_file.name)
        # FFmpeg runs inside tmp/, so these relative names need no Windows path escaping.
        filters.append("ass=captions.ass" + (":fontsdir=fonts" if font_files else ""))

    # 4. Crop + scale every frame in Python and pipe it to FFmpeg for captions + encode.
    out_path = out_dir / f"{name}.mp4"
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{out_w}x{out_h}", "-r", str(CLIP_FPS), "-i", "-",
           "-i", "cut.mp4", "-map", "0:v:0", "-map", "1:a:0?"]
    if filters:
        cmd += ["-vf", ",".join(filters)]
    # Short fades stop a cut in the middle of music or speech from clicking.
    fade_out = max(0.0, duration - 0.4)
    cmd += [*hardware.ffmpeg_video_args(), "-af", f"afade=t=in:d=0.06,afade=t=out:st={fade_out:.3f}:d=0.4",
            "-c:a", "aac", "-b:a", "192k", "-shortest", str(out_path.resolve())]

    cap = cv2.VideoCapture(str(intermediate))
    interpolation = cv2.INTER_AREA if crop_w >= out_w else cv2.INTER_CUBIC
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, cwd=str(tmp))
    frames = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            left = lefts[min(frames, len(lefts) - 1)]
            window = frame[top:top + crop_h, left:left + crop_w]
            process.stdin.write(cv2.resize(window, (out_w, out_h), interpolation=interpolation).tobytes())  # type: ignore[union-attr]
            frames += 1
    except BrokenPipeError:
        pass  # FFmpeg exited early; its own error message is already on stderr
    finally:
        cap.release()
        if process.stdin:
            try:
                process.stdin.close()
            except BrokenPipeError:
                pass
        code = process.wait()
    if code != 0 or not out_path.exists():
        die(f"FFmpeg failed while encoding clip {index} (exit code {code}). Working files kept in {tmp}")
    if not args.keep_temp:
        shutil.rmtree(tmp, ignore_errors=True)

    final = probe_media(out_path)
    return {
        "index": index, "title": title, "path": str(out_path), "start": round(start, 2), "end": round(end, 2),
        "duration": round(final["duration"], 2), "width": final["width"], "height": final["height"],
        "sizeMB": round(out_path.stat().st_size / 1_048_576, 2), "encoder": hardware.encoder,
        "reframe": stats, "captions": bool(clip_words), "score": spec.get("score"),
        "text": spec.get("text", ""),
    }


def load_clip_specs(args: argparse.Namespace, work: Path, find) -> list[dict]:
    """`find(count)` produces ranked candidates when none were given or cached."""
    if args.clips:
        specs = json.loads(args.clips) if args.clips.lstrip().startswith(("[", "{")) else read_json(Path(args.clips).expanduser())
        specs = specs.get("clips", specs) if isinstance(specs, dict) else specs
        if not isinstance(specs, list) or not all(isinstance(s, dict) and "start" in s and "end" in s for s in specs):
            die("--clips must be a JSON list of {start, end, title?, hook_text?} objects.")
        return specs
    if args.start is not None and args.end is not None:
        return [{"start": args.start, "end": args.end, "title": args.title or "", "hook_text": args.hook_text or ""}]
    candidates_file = work / "candidates.json"
    candidates = read_json(candidates_file) if candidates_file.exists() else find(max(args.top, 8))
    if not candidates:
        die("No clip candidates found. Try a wider --min/--max range or pass --start/--end.")
    return candidates[:args.top]


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_download(args: argparse.Namespace) -> None:
    work = download(args.source, args.max_height)
    print(json.dumps({"workDir": str(work), **read_json(work / "info.json")}, indent=2))


def cmd_transcribe(args: argparse.Namespace) -> None:
    work, source, info = resolve_source(args.source)
    transcript = transcribe(work, source, args.force)
    print(json.dumps({"id": info["id"], "transcript": str(work / "transcript.json"),
                      "readable": str(work / "transcript.txt"), "language": transcript["language"],
                      "duration": transcript["duration"], "words": len(all_words(transcript))}, indent=2))


def ranked_candidates(args: argparse.Namespace, work: Path, source: Path, info: dict, count: int) -> tuple[str, list[dict]]:
    mode = resolve_mode(args, info)
    if mode == "music":
        return mode, find_music_candidates(source, info, count, args.min, args.max)
    return mode, find_candidates(transcribe(work, source), info, count, args.min, args.max)


def cmd_candidates(args: argparse.Namespace) -> None:
    work, source, info = resolve_source(args.source)
    mode, candidates = ranked_candidates(args, work, source, info, args.count)
    write_json(work / "candidates.json", candidates)
    print(json.dumps({"id": info["id"], "title": info["title"], "mode": mode,
                      "candidatesFile": str(work / "candidates.json"), "candidates": candidates},
                     indent=2, ensure_ascii=False))


def cmd_cut(args: argparse.Namespace) -> None:
    work, source, info = resolve_source(args.source)
    mode = resolve_mode(args, info)
    specs = load_clip_specs(args, work, lambda count: ranked_candidates(args, work, source, info, count)[1])
    # Music clips carry no word captions (sung lyrics transcribe poorly); the hook headline still shows.
    words = [] if mode == "music" or args.no_captions else all_words(transcribe(work, source))
    caption_style = dict(load_style(args.style)["captions"]) if args.style else dict(DEFAULT_CAPTIONS)
    hardware = hw.detect(args.encoder or "")
    out_dir = Path(args.out).expanduser() if args.out else output_dir() / "clips" / info["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    log(f"Cutting {len(specs)} clip(s) in {mode} mode at {args.aspect} with {hardware.encoder} -> {out_dir}")

    clips = [cut_clip(source, words, spec, i, work, out_dir, args, caption_style, hardware)
             for i, spec in enumerate(specs, start=1)]
    result = {"id": info["id"], "title": info["title"], "url": info.get("url", ""), "mode": mode, "aspect": args.aspect,
              "captionStyle": args.style or "default", "clips": clips}
    write_json(out_dir / "clips.json", result)
    print(json.dumps(result, indent=2, ensure_ascii=False))


def cmd_auto(args: argparse.Namespace) -> None:
    work, source, info = resolve_source(args.source)
    _, candidates = ranked_candidates(args, work, source, info, max(args.top, 8))
    write_json(work / "candidates.json", candidates)
    cmd_cut(args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Clip long videos into captioned vertical shorts, locally.")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_source(p: argparse.ArgumentParser) -> None:
        p.add_argument("source", help="YouTube URL, local video file, or a video id from media/raw")

    def add_range(p: argparse.ArgumentParser) -> None:
        p.add_argument("--min", type=float, default=20, help="Shortest clip in seconds (default 20)")
        p.add_argument("--max", type=float, default=60, help="Longest clip in seconds (default 60)")
        p.add_argument("--mode", choices=["auto", "speech", "music"], default="auto",
                       help="speech = rank by spoken hooks; music = rank by audio energy, no word captions. "
                            "auto picks music for videos YouTube files under Music.")

    def add_cut(p: argparse.ArgumentParser) -> None:
        p.add_argument("--clips", help="JSON file or inline JSON list of {start, end, title?, hook_text?}")
        p.add_argument("--top", type=int, default=3, help="Cut the N best auto-detected candidates (default 3)")
        p.add_argument("--start", help="Manual clip start (seconds or mm:ss)")
        p.add_argument("--end", help="Manual clip end (seconds or mm:ss)")
        p.add_argument("--title", help="Title for a manual clip (used in the file name)")
        p.add_argument("--hook-text", help="Headline shown at the top for the first seconds of a manual clip")
        p.add_argument("--aspect", choices=list(OUTPUT_SIZES), default="9:16")
        p.add_argument("--reframe", choices=["track", "center"], default="track",
                       help="track = follow the active speaker (default); center = static centre crop")
        p.add_argument("--style", choices=list_styles(), help="Take caption font/colours from a style preset")
        p.add_argument("--caption-position", choices=["bottom", "middle", "top"], default="bottom")
        p.add_argument("--no-captions", action="store_true")
        p.add_argument("--no-hook", action="store_true", help="Do not draw the hook headline overlay")
        p.add_argument("--encoder", help="auto | nvenc | videotoolbox | qsv | amf | x264")
        p.add_argument("--out", help="Output directory (default: output/clips/<video-id>)")
        p.add_argument("--keep-temp", action="store_true", help="Keep intermediate files for debugging")
        add_range(p)

    p = sub.add_parser("download", help="Download a video with yt-dlp")
    add_source(p)
    p.add_argument("--max-height", type=int, default=1080)
    p.set_defaults(func=cmd_download)

    p = sub.add_parser("transcribe", help="Word-level transcript with faster-whisper")
    add_source(p)
    p.add_argument("--force", action="store_true", help="Re-transcribe even if a transcript is cached")
    p.set_defaults(func=cmd_transcribe)

    p = sub.add_parser("candidates", help="Rank clip-worthy moments by hook strength")
    add_source(p)
    p.add_argument("--count", type=int, default=8)
    add_range(p)
    p.set_defaults(func=cmd_candidates)

    p = sub.add_parser("cut", help="Cut, reframe and caption clips")
    add_source(p)
    add_cut(p)
    p.set_defaults(func=cmd_cut)

    p = sub.add_parser("auto", help="Download, transcribe, pick the best hooks and cut them")
    add_source(p)
    add_cut(p)
    p.set_defaults(func=cmd_auto)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
