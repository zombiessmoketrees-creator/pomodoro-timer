# Video Studio

Local-first, code-rendered video production driven by Claude Code.

- **Obsidian note → faceless video** in 16:9 (1920×1080) and 9:16 (1080×1920), rendered with Remotion.
- **Long video → vertical clips** with hook detection, active-speaker reframing and animated captions.
- **Zero cloud video tokens:** every frame comes from Remotion (TSX) or FFmpeg on your own hardware.
- **Two machines, one repo:** NVENC on the NVIDIA PC, VideoToolbox on the Apple Silicon Mac, detected at runtime.

## Setup

| Machine | Command |
|---|---|
| macOS | `./setup.sh` |
| Windows | `powershell -ExecutionPolicy Bypass -File .\setup.ps1` |

Then edit `.env` (created from `.env.example`) and set `OBSIDIAN_VAULT_PATH`. `.env`, `media/`, `output/`
and all `.mp4` files are git-ignored; code, skills, styles and manifests sync through Git.

## Use it from Claude Code

Open the folder with `claude` and ask in plain language. `CLAUDE.md` routes the work:

| Ask for | Skill | Models |
|---|---|---|
| "Turn my note *X* into a 60-second short" | `obsidian-to-video` | Haiku runs, Sonnet scripts |
| "Clip the best moments from *URL*" | `clip-youtube-video` | Haiku runs, Sonnet picks hooks |
| "Make a style that looks like …" | `add-video-style` | Sonnet builds |
| Broken render, custom animation | `studio-doctor` agent | Opus |

## Use it directly

`PY` = `.venv/bin/python` (macOS) or `.venv\Scripts\python.exe` (Windows).

```
PY engine/render.py doctor                                  # check tools + GPU encoder
PY engine/render.py render sample --format vertical         # render the bundled sample
PY engine/render.py preview sample                          # open Remotion Studio

PY engine/obsidian_bridge.py scan                           # list video notes in the vault
PY engine/obsidian_bridge.py build "My Note"                # note -> studio/manifests/<id>.json
PY engine/render.py render <id>                             # render + log back to the note

PY engine/clipper.py auto "https://youtube.com/watch?v=..." --top 3 --style kinetic-typography
```

## Writing a video note

Add `video: true` to the frontmatter; see `examples/vault/Videos/Why Sleep Beats Hustle.md`.

```yaml
---
title: "Why Sleep Beats Hustle"
video: true
style: documentary-dark        # any file in styles/
format: both                   # landscape | vertical | both
target_duration: 45            # seconds, "45s", "1m30s" or "1:30"
cta: "Follow for more"
---
```

Paragraphs become text scenes, lists become bullets, `> [!stat] 73%` a statistic, `> quote` a quote,
code fences a code window, `![[image.png]]` a full-bleed image, `**bold**` accent emphasis. After a render
the bridge sets `video_status`, `video_outputs` and appends to `## Render Log` in that note — and writes
nowhere else in the vault.

## Layout

```
studio/    Remotion project: compositions, scene components, manifests
engine/    Python: obsidian_bridge.py, render.py, clipper.py, hw.py, manifest.py
styles/    Theme presets + _schema.json + _template.json
.claude/   Skills and subagents (model routing)
examples/  A sample vault note
```

## Notes

- **Styles:** `documentary-dark`, `kinetic-typography`, `reddit-story`, `tech-explainer`, `retro-16bit`. Add more with the
  `add-video-style` skill or by copying `styles/_template.json`; `PY engine/render.py check-style` validates.
- **Narration:** add `narrate: true` to a note and every scene is read aloud by a local Piper voice
  (`engine/narrate.py`; change it with `TTS_VOICE` in `.env`). Scenes are re-timed to the voice.
  `music: chiptune` adds a code-synthesised 16-bit score.
- **16-bit story videos:** `style: retro-16bit` plus `> [!pixel] <art-id>` blocks give full-screen pixel art
  with an RPG dialog box. Art ids live in `studio/src/scenes/pixel/art.ts`; see
  `examples/vault/Videos/The Mothman of Point Pleasant.md`.
- **Audio:** put music or your own recorded narration in `studio/public/audio/` and reference it from
  frontmatter (`music: audio/track.mp3`, `voiceover: audio/take1.wav`).
- **Caption fonts for clips** are drawn with system fonts (Impact/Arial stand in for Anton/Inter). Drop the
  real TTF files into `engine/fonts/` for an exact match.
- **Encoder:** `VIDEO_ENCODER` in `.env` forces one (`nvenc`, `videotoolbox`, `qsv`, `amf`, `x264`).
- Only download and clip videos you own or have permission to reuse.
