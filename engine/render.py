#!/usr/bin/env python3
"""Hardware-aware render runner for the Remotion studio.

    python engine/render.py doctor
    python engine/render.py validate <manifest>
    python engine/render.py still    <manifest> [--format vertical] [--scene s03 | --at 4.5]
    python engine/render.py render   <manifest> [--format landscape|vertical|both]
    python engine/render.py preview  <manifest>
    python engine/render.py check-style [name]

<manifest> is a path, a file name in studio/manifests, or a bare manifest id.

Render pipelines (chosen automatically from the detected hardware):
  direct  Remotion encodes the video itself. Used for software x264 and for
          Apple VideoToolbox (Remotion supports that hardware encoder natively).
  frames  Remotion renders a JPEG sequence + WAV audio, then FFmpeg encodes
          with the GPU encoder. Used for NVIDIA NVENC / Intel QSV / AMD AMF,
          which Remotion cannot drive itself.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import re
import shutil
import socket
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import hw  # noqa: E402
from common import (  # noqa: E402
    MANIFEST_DIR, ROOT, STUDIO_DIR, capture, die, env, log, output_dir, probe_media,
    read_json, require_tool, run, which, write_json,
)
from manifest import (  # noqa: E402
    COMPOSITIONS, list_styles, load_style, manifest_duration, resolve_manifest_path,
    validate_manifest,
)

ENTRY = "src/index.ts"
GPU_PIPELINE_ENCODERS = {"h264_nvenc", "h264_qsv", "h264_amf"}


# --------------------------------------------------------------------------- #
# Remotion invocation
# --------------------------------------------------------------------------- #
def remotion_cmd() -> list[str]:
    """Call the Remotion CLI through node directly (avoids npx/.cmd shims on Windows)."""
    node = require_tool("node", "Install Node.js 18+ (run setup.sh / setup.ps1).")
    cli = STUDIO_DIR / "node_modules" / "@remotion" / "cli" / "remotion-cli.js"
    if not cli.exists():
        die("Remotion is not installed. Run `npm install` inside studio/ (or re-run the setup script).")
    return [node, str(cli)]


def browser_args() -> list[str]:
    executable = env("REMOTION_BROWSER_EXECUTABLE")
    return [f"--browser-executable={executable}"] if executable else []


def common_render_args(args: argparse.Namespace, props: Path) -> list[str]:
    out = [f"--props={props}", "--log=info", *browser_args()]
    concurrency = args.concurrency or env("REMOTION_CONCURRENCY")
    if concurrency:
        out.append(f"--concurrency={concurrency}")
    if getattr(args, "scale", None) and args.scale != 1:
        out.append(f"--scale={args.scale}")
    return out


# --------------------------------------------------------------------------- #
# Manifest handling
# --------------------------------------------------------------------------- #
def load_resolved(manifest_arg: str, style_override: str | None = None) -> tuple[dict, dict, Path, Path]:
    """Validate the manifest, inline its theme, and write the props file Remotion reads."""
    path = resolve_manifest_path(manifest_arg)
    manifest = read_json(path)
    errors = validate_manifest(manifest)
    if errors:
        die(f"{path.name} is not a valid manifest:\n  - " + "\n  - ".join(errors))
    if style_override:
        manifest["style"] = style_override
    theme = load_style(manifest["style"])
    manifest.setdefault("version", 1)
    manifest.setdefault("fps", 30)
    manifest.setdefault("format", "both")
    resolved = {**manifest, "theme": theme}
    props = MANIFEST_DIR / ".resolved" / f"{manifest['id']}.json"
    write_json(props, resolved)
    return resolved, theme, path, props


def formats_for(manifest: dict, requested: str | None) -> list[str]:
    choice = requested or manifest.get("format", "both")
    return ["landscape", "vertical"] if choice == "both" else [choice]


def has_audio(manifest: dict) -> bool:
    audio = manifest.get("audio") or {}
    return bool(audio.get("voiceover") or audio.get("music") or any(s.get("audio") for s in manifest["scenes"]))


def scene_frame(manifest: dict, theme: dict, scene_id: str) -> int:
    """A representative frame (70% through) of the given scene, honouring transition overlap."""
    fps = manifest["fps"]
    frames = [max(1, round(s["durationInSeconds"] * fps)) for s in manifest["scenes"]]
    overlap = 0
    if theme["motion"]["transition"] != "cut" and len(frames) > 1:
        overlap = max(0, min(int(theme["motion"]["transitionFrames"]), min(frames) // 2 - 1))
    start = 0
    for scene, length in zip(manifest["scenes"], frames):
        if scene["id"] == scene_id:
            return start + int(length * 0.7)
        start += length - overlap
    die(f"Scene '{scene_id}' not found. Scene ids: {', '.join(s['id'] for s in manifest['scenes'])}")


# --------------------------------------------------------------------------- #
# Pipelines
# --------------------------------------------------------------------------- #
def render_direct(args, comp: str, props: Path, out: Path, hardware: hw.Hardware, vertical: bool) -> None:
    cmd = [*remotion_cmd(), "render", ENTRY, comp, str(out), "--codec=h264", "--overwrite",
           *common_render_args(args, props)]
    if hardware.encoder == "h264_videotoolbox":
        # CRF is not available with hardware encoding; target a bitrate instead.
        cmd += ["--hardware-acceleration=if-possible", f"--video-bitrate={'10M' if vertical else '12M'}"]
    else:
        cmd += ["--crf=18"]
    run(cmd, cwd=STUDIO_DIR)


def render_frames(args, comp: str, props: Path, out: Path, hardware: hw.Hardware, manifest: dict) -> None:
    ffmpeg = require_tool("ffmpeg", "Install FFmpeg (run setup.sh / setup.ps1).")
    work = out.parent / f"frames_{out.stem}"  # Remotion rejects sequence dirs containing a dot
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    try:
        run([*remotion_cmd(), "render", ENTRY, comp, str(work), "--sequence", "--image-format=jpeg",
             "--jpeg-quality=95", "--overwrite", *common_render_args(args, props)], cwd=STUDIO_DIR)

        frames = sorted(p.name for p in work.iterdir() if p.suffix.lower() in (".jpeg", ".jpg"))
        if not frames:
            die(f"Remotion produced no frames in {work}")
        match = re.match(r"^(.*?)(\d+)(\.jpe?g)$", frames[0])
        if not match:
            die(f"Unexpected frame file name: {frames[0]}")
        pattern = f"{match.group(1)}%0{len(match.group(2))}d{match.group(3)}"

        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "warning", "-stats",
               "-framerate", str(manifest["fps"]), "-start_number", str(int(match.group(2))),
               "-i", str(work / pattern)]
        if has_audio(manifest):
            audio = work / "audio.wav"
            run([*remotion_cmd(), "render", ENTRY, comp, str(audio), "--overwrite",
                 *common_render_args(args, props)], cwd=STUDIO_DIR)
            cmd += ["-i", str(audio), "-c:a", "aac", "-b:a", "192k", "-shortest"]
        cmd += [*hardware.ffmpeg_video_args(), "-r", str(manifest["fps"]), str(out)]
        run(cmd)
    finally:
        if not args.keep_frames:
            shutil.rmtree(work, ignore_errors=True)


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_render(args: argparse.Namespace) -> None:
    manifest, theme, manifest_path, props = load_resolved(args.manifest, args.style)
    hardware = hw.detect(args.encoder or "")
    out_root = Path(args.out).expanduser() if args.out else output_dir() / "videos" / manifest["id"]
    out_root.mkdir(parents=True, exist_ok=True)
    expected = manifest_duration(manifest, theme)
    log(f"{manifest['title']} — style {manifest['style']}, {len(manifest['scenes'])} scenes, {expected:.1f}s")
    log(f"Hardware: {hardware.os}/{hardware.arch}, GPU: {hardware.gpu}, encoder: {hardware.encoder}")

    records = []
    for fmt in formats_for(manifest, args.format):
        comp, width, height = COMPOSITIONS[fmt]
        out = out_root / f"{manifest['id']}-{fmt}.mp4"
        pipeline = args.pipeline
        if pipeline == "auto":
            pipeline = "frames" if hardware.encoder in GPU_PIPELINE_ENCODERS else "direct"
        log(f"Rendering {fmt} ({width}x{height}) via the {pipeline} pipeline -> {out}")
        started = time.time()
        if pipeline == "frames":
            render_frames(args, comp, props, out, hardware, manifest)
        else:
            render_direct(args, comp, props, out, hardware, fmt == "vertical")
        if not out.exists() or out.stat().st_size == 0:
            die(f"Render finished but {out} is missing or empty.")
        info = probe_media(out)
        records.append({
            "format": fmt,
            "path": str(out),
            "width": info["width"],
            "height": info["height"],
            "duration": round(info["duration"], 2),
            "sizeMB": round(out.stat().st_size / 1_048_576, 2),
            "encoder": hardware.encoder,
            "pipeline": pipeline,
            "renderSeconds": round(time.time() - started, 1),
        })

    result = {
        "id": manifest["id"],
        "title": manifest["title"],
        "style": manifest["style"],
        "manifest": str(manifest_path),
        "renderedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "machine": socket.gethostname(),
        "outputs": records,
    }
    write_json(out_root / "render.json", result)

    source = manifest.get("source") or {}
    note = source.get("notePath") or source.get("note")
    if note and not args.no_log:
        try:
            import obsidian_bridge

            logged = obsidian_bridge.log_render(note, result, source.get("note"))
            result["loggedTo"] = str(logged)
            log(f"Logged render to Obsidian note: {logged}")
        except SystemExit as exc:  # the render itself succeeded; do not fail it over logging
            log(f"Could not log to the Obsidian note ({exc}). Run: python engine/obsidian_bridge.py log \"{note}\" --render \"{out_root / 'render.json'}\"")
    print(json.dumps(result, indent=2))


def cmd_still(args: argparse.Namespace) -> None:
    manifest, theme, _, props = load_resolved(args.manifest, args.style)
    fmt = args.format or ("vertical" if manifest.get("format") == "vertical" else "landscape")
    comp = COMPOSITIONS[fmt][0]
    if args.scene:
        frame = scene_frame(manifest, theme, args.scene)
    elif args.at is not None:
        frame = int(args.at * manifest["fps"])
    else:
        frame = args.frame
    last = int(manifest_duration(manifest, theme) * manifest["fps"]) - 1
    frame = max(0, min(frame, last))
    out_root = Path(args.out).expanduser() if args.out else output_dir() / "stills" / manifest["id"]
    out_root.mkdir(parents=True, exist_ok=True)
    out = out_root / f"{manifest['id']}-{fmt}-f{frame:05d}.png"
    cmd = [*remotion_cmd(), "still", ENTRY, comp, str(out), f"--frame={frame}", f"--props={props}",
           "--overwrite", "--log=error", *browser_args()]
    if args.scale != 1:
        cmd.append(f"--scale={args.scale}")
    run(cmd, cwd=STUDIO_DIR)
    print(json.dumps({"still": str(out), "frame": frame, "format": fmt}))


def cmd_preview(args: argparse.Namespace) -> None:
    _, _, _, props = load_resolved(args.manifest, args.style)
    run([*remotion_cmd(), "studio", ENTRY, f"--props={props}"], cwd=STUDIO_DIR)


def cmd_validate(args: argparse.Namespace) -> None:
    manifest, theme, path, _ = load_resolved(args.manifest, args.style)
    print(json.dumps({
        "valid": True,
        "manifest": str(path),
        "style": manifest["style"],
        "scenes": len(manifest["scenes"]),
        "durationSeconds": round(manifest_duration(manifest, theme), 2),
        "formats": formats_for(manifest, None),
    }, indent=2))


def cmd_check_style(args: argparse.Namespace) -> None:
    """Validate one style preset (or all of them) against styles/_schema.json."""
    names = [args.name] if args.name else list_styles()
    for name in names:
        theme = load_style(name)  # exits with the full error list when invalid
        print(f"ok  {name}  —  {theme['label']}: enter={theme['motion']['enter']}, "
              f"transition={theme['motion']['transition']}, background={theme['background']['type']}")


def cmd_doctor(_: argparse.Namespace) -> None:
    """Report everything needed to render on this machine; exit 1 if something required is missing."""
    problems: list[str] = []
    rows: list[tuple[str, str]] = [("Platform", f"{platform.system()} {platform.release()} ({platform.machine()})"),
                                   ("Python", platform.python_version())]

    for tool, flag in (("node", "--version"), ("ffmpeg", "-version"), ("ffprobe", "-version")):
        path = which(tool)
        if path:
            _, out = capture([path, flag])
            rows.append((tool, (out.strip().splitlines() or ["?"])[0][:70]))
        else:
            rows.append((tool, "MISSING"))
            problems.append(f"{tool} is not on PATH")

    cli = STUDIO_DIR / "node_modules" / "@remotion" / "cli" / "package.json"
    if cli.exists():
        rows.append(("Remotion", read_json(cli).get("version", "?")))
    else:
        rows.append(("Remotion", "MISSING"))
        problems.append("Remotion not installed — run `npm install` in studio/")

    for module, required in (("yaml", True), ("dotenv", False), ("yt_dlp", True), ("faster_whisper", True),
                             ("cv2", True), ("mediapipe", False), ("numpy", True)):
        try:
            mod = __import__(module)
            version = getattr(mod, "__version__", None) or getattr(getattr(mod, "version", None), "__version__", "ok")
            rows.append((f"py:{module}", str(version)))
        except Exception as exc:  # noqa: BLE001 - report any import failure
            rows.append((f"py:{module}", f"MISSING ({type(exc).__name__})"))
            if required:
                problems.append(f"Python package {module} is missing — pip install -r engine/requirements.txt")

    if which("ffmpeg"):
        hardware = hw.detect()
        rows += [("GPU", hardware.gpu),
                 ("Encoder", f"{hardware.encoder} ({'hardware' if hardware.accelerated else 'software'})"),
                 ("Encoders tried", ", ".join(hardware.tried))]
        _, filters = capture(["ffmpeg", "-hide_banner", "-filters"])
        if " subtitles " not in filters:
            rows.append(("libass", "MISSING"))
            problems.append("FFmpeg was built without libass — burned-in captions will fail (install a full FFmpeg build)")
        else:
            rows.append(("libass", "ok"))

    vault = env("OBSIDIAN_VAULT_PATH")
    if not (ROOT / ".env").exists():
        rows.append((".env", "MISSING — copy .env.example to .env"))
    if vault:
        ok = Path(os.path.expandvars(vault)).expanduser().is_dir()
        rows.append(("Obsidian vault", f"{vault} ({'found' if ok else 'NOT FOUND'})"))
        if not ok:
            problems.append("OBSIDIAN_VAULT_PATH does not point at a folder")
    else:
        rows.append(("Obsidian vault", "not set (OBSIDIAN_VAULT_PATH in .env)"))
    rows.append(("Styles", ", ".join(list_styles())))

    width = max(len(k) for k, _ in rows)
    for key, value in rows:
        print(f"{key.ljust(width)}  {value}")
    if problems:
        print("\nProblems:")
        for problem in problems:
            print(f"  - {problem}")
        raise SystemExit(1)
    print("\nAll good — this machine can render.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Render Remotion manifests with the best encoder on this machine.")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_manifest(p: argparse.ArgumentParser) -> None:
        p.add_argument("manifest", help="Path, file name in studio/manifests, or manifest id")
        p.add_argument("--style", help="Override the manifest's style preset")

    p = sub.add_parser("render", help="Render a manifest to MP4")
    add_manifest(p)
    p.add_argument("--format", choices=["landscape", "vertical", "both"], help="Default: the manifest's format")
    p.add_argument("--pipeline", choices=["auto", "direct", "frames"], default="auto")
    p.add_argument("--encoder", help="auto | nvenc | videotoolbox | qsv | amf | x264")
    p.add_argument("--out", help="Output directory (default: output/videos/<id>)")
    p.add_argument("--concurrency", help="Remotion render concurrency, e.g. 8 or 50%%")
    p.add_argument("--scale", type=float, default=1, help="Resolution multiplier, e.g. 0.5 for a fast draft")
    p.add_argument("--keep-frames", action="store_true", help="Keep the JPEG sequence from the frames pipeline")
    p.add_argument("--no-log", action="store_true", help="Do not write render metadata back to the Obsidian note")
    p.set_defaults(func=cmd_render)

    p = sub.add_parser("still", help="Render one PNG frame for a fast visual check")
    add_manifest(p)
    p.add_argument("--format", choices=["landscape", "vertical"])
    p.add_argument("--frame", type=int, default=45)
    p.add_argument("--at", type=float, help="Time in seconds instead of a frame number")
    p.add_argument("--scene", help="Scene id — picks a frame 70%% through that scene")
    p.add_argument("--scale", type=float, default=1)
    p.add_argument("--out", help="Output directory (default: output/stills/<id>)")
    p.set_defaults(func=cmd_still)

    p = sub.add_parser("preview", help="Open Remotion Studio on a manifest")
    add_manifest(p)
    p.set_defaults(func=cmd_preview)

    p = sub.add_parser("validate", help="Validate a manifest and print its computed duration")
    add_manifest(p)
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("check-style", help="Validate a style preset (all presets when no name is given)")
    p.add_argument("name", nargs="?")
    p.set_defaults(func=cmd_check_style)

    p = sub.add_parser("doctor", help="Check tools, packages, GPU encoder and vault path")
    p.set_defaults(func=cmd_doctor)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
