#!/usr/bin/env python3
"""Local voice narration (and optional chiptune score) for a manifest.

    python engine/narrate.py <manifest> [--voice am_michael] [--speed 0.95] [--force]
    python engine/narrate.py voices

Every scene that has `narration` text is spoken by a text-to-speech voice that
runs entirely on this machine, saved as a WAV under
studio/public/assets/<id>/narration/, attached to the scene (`audio`), and the
scene's duration is re-timed to the length of the spoken line. No cloud TTS.

Engines, in order of preference:
  kokoro   Kokoro neural voices (CPU, offline) - the most natural option and the
           default. Voice ids look like am_michael. Model (~340 MB) is downloaded
           once into engine/models/tts/kokoro/.
  piper    Lighter Piper voices (ids like en_US-ryan-high), 60-130 MB each.
  say      macOS built-in voices   (fallback when piper-tts is not installed)
  sapi     Windows built-in voices (fallback when piper-tts is not installed)

Settings in .env: TTS_VOICE, TTS_SPEED, TTS_ENGINE (auto | kokoro | piper | say | sapi).

`music: chiptune` in a note's frontmatter (manifest audio.music == "chiptune")
makes this script synthesise a looping 16-bit style track in code as well.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tarfile
import urllib.request
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import MODELS_DIR, PUBLIC_DIR, capture, die, env, log, read_json, require_tool, which, write_json  # noqa: E402
from manifest import load_style, manifest_duration, resolve_manifest_path, validate_manifest  # noqa: E402

PIPER_VOICES = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
VOICE_MIRROR = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-{voice}.tar.bz2"
KOKORO_FILES = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
DEFAULT_VOICE = "am_michael"
SUGGESTED_VOICES = {
    "am_michael": "Kokoro - US male, warm storyteller (default)",
    "am_fenrir": "Kokoro - US male, deeper and darker",
    "am_onyx": "Kokoro - US male, low and calm",
    "bm_george": "Kokoro - British male, documentary",
    "bm_fable": "Kokoro - British male, storybook",
    "af_heart": "Kokoro - US female, the model's most natural voice",
    "af_bella": "Kokoro - US female, expressive",
    "bf_emma": "Kokoro - British female",
    "en_US-ryan-high": "Piper - US male (lighter model, more robotic)",
    "en_GB-alan-medium": "Piper - British male (lighter model, more robotic)",
}
LEAD_SECONDS = 0.3   # silence before the voice starts in each scene
TAIL_SECONDS = 0.6   # breathing room after the line ends
SENTENCE_PAUSE = 0.32  # gap inserted between sentences so the delivery is not rushed


# --------------------------------------------------------------------------- #
# Engines — each returns (float samples in -1..1, sample rate)
# --------------------------------------------------------------------------- #
def voice_urls(voice: str) -> list[tuple[str, str]]:
    """(model url, config url) on the official Piper voice repository, e.g. en_US-ryan-high."""
    locale, name, quality = voice.split("-", 2)
    base = f"{PIPER_VOICES}/{locale.split('_')[0]}/{locale}/{name}/{quality}/{voice}.onnx"
    return [(base, base + ".json")]


def ensure_voice(voice: str) -> Path:
    """Path to <voice>.onnx (with its .onnx.json beside it), downloading the voice on first use."""
    if voice.count("-") < 2:
        die(f"'{voice}' is not a Piper voice id (expected e.g. en_US-ryan-high). See `narrate.py voices`.")
    tts_dir = MODELS_DIR / "tts"
    for candidate in (tts_dir / f"{voice}.onnx", tts_dir / f"vits-piper-{voice}" / f"{voice}.onnx"):
        if candidate.exists() and Path(str(candidate) + ".json").exists():
            return candidate
    tts_dir.mkdir(parents=True, exist_ok=True)
    log(f"Downloading narrator voice '{voice}' (one time, 60-130 MB)")
    model = tts_dir / f"{voice}.onnx"
    try:
        for model_url, config_url in voice_urls(voice):
            urllib.request.urlretrieve(config_url, str(model) + ".json")  # noqa: S310 - fixed https URL
            urllib.request.urlretrieve(model_url, str(model) + ".part")   # noqa: S310
            Path(str(model) + ".part").replace(model)
        return model
    except Exception as first:  # noqa: BLE001 - blocked host, offline...
        Path(str(model) + ".part").unlink(missing_ok=True)
        log(f"Primary voice host failed ({first}); trying the mirror archive.")
    archive = tts_dir / f"{voice}.tar.bz2"
    try:
        urllib.request.urlretrieve(VOICE_MIRROR.format(voice=voice), archive)  # noqa: S310
        with tarfile.open(archive, "r:bz2") as tar:
            tar.extractall(tts_dir, filter="data")
    except Exception as exc:  # noqa: BLE001
        die(f"Could not download voice '{voice}': {exc}. Run `python engine/narrate.py voices` for known names.")
    finally:
        archive.unlink(missing_ok=True)
    mirrored = tts_dir / f"vits-piper-{voice}" / f"{voice}.onnx"
    if not mirrored.exists():
        die(f"Voice archive for '{voice}' did not contain the expected files.")
    return mirrored


def is_kokoro_voice(voice: str) -> bool:
    """Kokoro ids look like am_michael / bf_emma; Piper ids look like en_US-ryan-high."""
    return bool(re.fullmatch(r"[a-z]{2}_[a-z]+", voice))


def kokoro_engine(voice: str, speed: float):
    from kokoro_onnx import Kokoro

    folder = MODELS_DIR / "tts" / "kokoro"
    folder.mkdir(parents=True, exist_ok=True)
    for name in ("kokoro-v1.0.onnx", "voices-v1.0.bin"):
        target = folder / name
        if not target.exists():
            log(f"Downloading Kokoro voice model file {name} (one time; the model is ~310 MB)")
            try:
                urllib.request.urlretrieve(f"{KOKORO_FILES}/{name}", str(target) + ".part")  # noqa: S310 - fixed https URL
                Path(str(target) + ".part").replace(target)
            except Exception as exc:  # noqa: BLE001
                Path(str(target) + ".part").unlink(missing_ok=True)
                die(f"Could not download {name}: {exc}")
    model = Kokoro(str(folder / "kokoro-v1.0.onnx"), str(folder / "voices-v1.0.bin"))
    if voice not in model.get_voices():
        die(f"Unknown Kokoro voice '{voice}'. Run `python engine/narrate.py voices`.")
    lang = "en-gb" if voice.startswith("b") else "en-us"

    def speak(text: str, _out: Path):
        import numpy as np

        # One sentence at a time keeps intonation natural and lets us control the pauses.
        sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
        parts, rate = [], 24000
        for i, sentence in enumerate(sentences):
            samples, rate = model.create(sentence, voice=voice, speed=speed, lang=lang)
            samples = np.asarray(samples, dtype="float32")
            # Trim the model's own leading/trailing silence so pauses are consistent.
            loud = np.flatnonzero(np.abs(samples) > 0.01)
            if loud.size:
                samples = samples[max(0, loud[0] - 600):loud[-1] + 2400]
            if i:
                parts.append(np.zeros(int(SENTENCE_PAUSE * rate), dtype="float32"))
            parts.append(samples)
        if not parts:
            die(f"The voice produced no audio for: {text!r}")
        return np.concatenate(parts), int(rate)

    return speak


def piper_engine(voice: str, speed: float):
    import numpy as np
    from piper import PiperVoice, SynthesisConfig

    model = PiperVoice.load(str(ensure_voice(voice)))
    config = SynthesisConfig(length_scale=1 / max(0.5, speed))

    def speak(text: str, _out: Path):
        chunks = list(model.synthesize(text, syn_config=config))  # one chunk per sentence
        if not chunks:
            die(f"The voice produced no audio for: {text!r}")
        rate = chunks[0].sample_rate
        pause = np.zeros(int(SENTENCE_PAUSE * rate), dtype="float32")
        parts = []
        for i, chunk in enumerate(chunks):
            if i:
                parts.append(pause)
            parts.append(np.asarray(chunk.audio_float_array, dtype="float32"))
        return np.concatenate(parts), int(rate)

    return speak


def read_wav(path: Path):
    import numpy as np

    with wave.open(str(path), "rb") as handle:
        rate, channels, width = handle.getframerate(), handle.getnchannels(), handle.getsampwidth()
        raw = handle.readframes(handle.getnframes())
    if width != 2:
        die(f"Expected 16-bit audio from the system voice, got {width * 8}-bit.")
    data = np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data.tolist(), rate


def say_engine(voice: str, speed: float):
    ffmpeg = require_tool("ffmpeg", "FFmpeg converts the macOS voice output.")

    def speak(text: str, out: Path):
        aiff = out.with_suffix(".aiff")
        cmd = ["say", "-o", str(aiff), "-r", str(int(175 * speed))]
        if voice and "_" not in voice:  # a macOS voice name such as "Daniel", not a Piper id
            cmd += ["-v", voice]
        code, output = capture([*cmd, text])
        if code != 0:
            die(f"`say` failed: {output.strip()}")
        tmp = out.with_suffix(".sys.wav")
        code, output = capture([ffmpeg, "-y", "-loglevel", "error", "-i", str(aiff), "-ac", "1", "-ar", "44100",
                                "-c:a", "pcm_s16le", str(tmp)])
        aiff.unlink(missing_ok=True)
        if code != 0:
            die(f"FFmpeg could not convert the narration: {output.strip()}")
        samples = read_wav(tmp)
        tmp.unlink(missing_ok=True)
        return samples

    return speak


def sapi_engine(voice: str, speed: float):
    def speak(text: str, out: Path):
        tmp = out.with_suffix(".sys.wav")
        rate = max(-10, min(10, round((speed - 1) * 10)))
        script = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"$s.Rate = {rate}; "
            + (f"$s.SelectVoice({json.dumps(voice)}); " if voice and "_" not in voice else "")
            + f"$s.SetOutputToWaveFile({json.dumps(str(tmp))}); "
            f"$s.Speak({json.dumps(text)}); $s.Dispose()"
        )
        code, output = capture(["powershell", "-NoProfile", "-Command", script])
        if code != 0 or not tmp.exists():
            die(f"Windows speech synthesis failed: {output.strip()}")
        samples = read_wav(tmp)
        tmp.unlink(missing_ok=True)
        return samples

    return speak


def pick_engine(voice: str, speed: float):
    choice = env("TTS_ENGINE", "auto").lower()
    if choice in ("auto", "kokoro") and is_kokoro_voice(voice):
        try:
            import kokoro_onnx  # noqa: F401

            return "kokoro", kokoro_engine(voice, speed)
        except ImportError:
            die("kokoro-onnx is not installed. Run: pip install -r engine/requirements.txt "
                "(or set TTS_VOICE to a Piper voice such as en_US-ryan-high).")
    if choice in ("auto", "piper"):
        try:
            import piper  # noqa: F401

            return "piper", piper_engine(voice, speed)
        except ImportError:
            if choice == "piper":
                die("piper-tts is not installed. Run: pip install -r engine/requirements.txt")
            log("piper-tts is not installed; falling back to the operating system's voice.")
    if choice in ("auto", "say") and sys.platform == "darwin" and which("say"):
        return "say", say_engine(voice, speed)
    if choice in ("auto", "sapi") and sys.platform == "win32":
        return "sapi", sapi_engine(voice, speed)
    die("No local text-to-speech engine is available. Run: pip install -r engine/requirements.txt")


# --------------------------------------------------------------------------- #
# Audio helpers
# --------------------------------------------------------------------------- #
def write_wav(path: Path, samples, rate: int) -> float:
    import numpy as np

    data = np.asarray(samples, dtype="float32")
    peak = float(np.max(np.abs(data))) if data.size else 0.0
    if peak > 0:
        data = data * (0.89 / peak)  # consistent level from line to line
    lead = np.zeros(int(LEAD_SECONDS * rate), dtype="float32")
    data = np.concatenate([lead, data])
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes((np.clip(data, -1, 1) * 32767).astype("<i2").tobytes())
    return len(data) / rate


def chiptune(path: Path, bars: int = 8, bpm: int = 84, rate: int = 32000) -> None:
    """A slow, eerie A-minor loop from square, triangle and noise channels — synthesised, not sampled."""
    import numpy as np

    step = 60 / bpm / 4                      # one sixteenth note
    total = int(bars * 16 * step * rate)
    mix = np.zeros(total, dtype="float32")
    rng = np.random.default_rng(1966)

    def freq(semitones_from_a4: float) -> float:
        return 440.0 * 2 ** (semitones_from_a4 / 12)

    def note(start_step: float, length_steps: float, semis: float, kind: str, volume: float, duty: float = 0.5) -> None:
        start = int(start_step * step * rate)
        count = min(int(length_steps * step * rate), total - start)
        if count <= 0:
            return
        t = np.arange(count) / rate
        phase = (t * freq(semis)) % 1.0
        if kind == "square":
            wave_data = np.where(phase < duty, 1.0, -1.0)
        elif kind == "triangle":
            wave_data = 4 * np.abs(phase - 0.5) - 1
        else:
            wave_data = rng.uniform(-1, 1, count)
        envelope = np.exp(-t * (9 if kind == "noise" else 2.2 / max(0.2, length_steps * step)))
        envelope[: min(60, count)] *= np.linspace(0, 1, min(60, count))  # no clicks
        mix[start:start + count] += (wave_data * envelope * volume).astype("float32")

    # A minor -> F -> D minor -> E: (bass root, arpeggio tones), semitones from A4.
    chords = [(-24, [-12, -9, -5, 0]), (-28, [-16, -12, -9, -4]), (-31, [-19, -14, -10, -7]), (-29, [-17, -13, -10, -5])]
    melody = {0: 12, 6: 10, 8: 7, 22: 8, 24: 7, 30: 3, 32: 5, 38: 3, 40: 0, 54: -1, 56: 2, 60: 4}
    for bar in range(bars):
        root, tones = chords[bar % 4]
        base = bar * 16
        note(base, 7, root, "triangle", 0.34)
        note(base + 8, 6, root + (7 if bar % 2 else 0), "triangle", 0.3)
        for i in range(8):
            note(base + i * 2, 1.8, tones[[0, 1, 2, 3, 2, 1, 2, 3][i]], "square", 0.085, duty=0.25)
        for i in (4, 12):
            note(base + i, 0.6, 0, "noise", 0.05)
        for offset, semis in melody.items():
            if base <= offset + (bar // 4) * 64 < base + 16 and bar >= 0:
                note(offset + (bar // 4) * 64, 5, semis, "square", 0.075, duty=0.125)

    # Gentle low-pass (3-tap) takes the harsh edge off, like an old TV speaker.
    mix = np.convolve(mix, np.array([0.25, 0.5, 0.25], dtype="float32"), mode="same")
    mix *= 0.8 / max(1e-6, float(np.max(np.abs(mix))))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes((mix * 32767).astype("<i2").tobytes())


# --------------------------------------------------------------------------- #
# Manifest narration
# --------------------------------------------------------------------------- #
def needs_narration(manifest: dict) -> bool:
    """True when a narrated manifest still has an unvoiced scene (or a missing audio file)."""
    if not manifest.get("narrate"):
        return False
    for scene in manifest.get("scenes", []):
        if scene.get("narration") and not (scene.get("audio") and (PUBLIC_DIR / scene["audio"]).is_file()):
            return True
    return (manifest.get("audio") or {}).get("music") == "chiptune"


def narrate_manifest(path: Path, voice: str = "", speed: float = 0.0, force: bool = False) -> dict:
    manifest = read_json(path)
    errors = validate_manifest(manifest)
    if errors:
        die(f"{path.name} is not a valid manifest:\n  - " + "\n  - ".join(errors))
    theme = load_style(manifest["style"])
    voice = voice or env("TTS_VOICE", DEFAULT_VOICE)
    speed = speed or float(env("TTS_SPEED", "0.95"))
    fps = manifest.get("fps", 30)
    overlap = 0.0 if theme["motion"]["transition"] == "cut" else theme["motion"]["transitionFrames"] / fps

    engine_name, speak = None, None
    out_dir = PUBLIC_DIR / "assets" / manifest["id"] / "narration"
    spoken = 0
    for scene in manifest["scenes"]:
        text = (scene.get("narration") or "").replace("**", "").strip()
        if not text:
            continue
        wav = out_dir / f"{scene['id']}.wav"
        if force or not wav.is_file() or scene.get("narrationVoice") != voice:
            if speak is None:
                engine_name, speak = pick_engine(voice, speed)
                log(f"Narrating with {engine_name} voice '{voice}' at speed {speed}")
            samples, rate = speak(text, wav)
            length = write_wav(wav, samples, rate)
            spoken += 1
        else:
            with wave.open(str(wav), "rb") as handle:
                length = handle.getnframes() / handle.getframerate()
        scene["audio"] = wav.relative_to(PUBLIC_DIR).as_posix()
        scene["narrationVoice"] = voice
        # The picture holds for the whole line, plus a beat, plus any transition overlap.
        floor = 4.0 if scene["type"] in ("title", "outro") else 2.0  # title cards need time to be read
        scene["durationInSeconds"] = round(max(floor, length + TAIL_SECONDS + overlap), 2)

    audio = manifest.get("audio") or {}
    if audio.get("music") == "chiptune":
        track = PUBLIC_DIR / "assets" / manifest["id"] / "chiptune.wav"
        chiptune(track)
        audio["music"] = track.relative_to(PUBLIC_DIR).as_posix()
        audio.setdefault("musicVolume", 0.14)
        manifest["audio"] = audio
        log(f"Synthesised chiptune score: {track}")

    manifest.pop("targetDuration", None)  # the voice sets the length now
    write_json(path, manifest)
    return {"manifest": str(path), "voice": voice, "engine": engine_name or "cached", "scenesSpoken": spoken,
            "scenesNarrated": sum(1 for s in manifest["scenes"] if s.get("audio")),
            "durationSeconds": round(manifest_duration(manifest, theme), 2),
            "music": (manifest.get("audio") or {}).get("music", "")}


def main() -> None:
    parser = argparse.ArgumentParser(description="Voice a manifest's scenes with a local text-to-speech engine.")
    parser.add_argument("manifest", help="Manifest path/id, or the word `voices` to list suggested voices")
    parser.add_argument("--voice", help=f"Piper voice id (default: TTS_VOICE or {DEFAULT_VOICE})")
    parser.add_argument("--speed", type=float, help="1.0 = normal, lower = slower (default: TTS_SPEED or 0.95)")
    parser.add_argument("--force", action="store_true", help="Re-record every line")
    args = parser.parse_args()
    if args.manifest == "voices":
        print(json.dumps(SUGGESTED_VOICES, indent=2))
        return
    print(json.dumps(narrate_manifest(resolve_manifest_path(args.manifest), args.voice or "", args.speed or 0.0, args.force), indent=2))


if __name__ == "__main__":
    main()
