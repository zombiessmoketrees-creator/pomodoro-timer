# Video Studio — Root Orchestrator

Local-first, code-rendered video production. Every frame is produced on this machine by
**Remotion (TSX)** or **FFmpeg**; Claude writes scripts, manifests and code — never pixels.

You (the main session) are the **orchestrator**: understand the request, pick the skill, delegate each
step to the cheapest subagent that can do it well, check the result, and report. Do not do routine
execution yourself when a subagent tier below you can.

## 1. Non-negotiable policy: Code-First, Zero-Video-Token

- **Never** call a cloud video, image or voice *generation* API (Sora, Veo, Runway, Pika, Kling, HeyGen,
  Synthesia, ElevenLabs, DALL·E, Midjourney, or anything similar), and never add an SDK, key or script for one.
- All visuals are compiled from code: Remotion components in `studio/` or FFmpeg filters in `engine/`.
- All media analysis is local: `faster-whisper` for speech, OpenCV + MediaPipe for faces.
- Narration is local too: `engine/narrate.py` uses Kokoro (or Piper) neural voices on this machine (or the OS voice as a
  fallback). Music can be synthesised in code (`music: chiptune`). Never a cloud TTS or music service.
- The only network use is `yt-dlp` downloads, package installs, and one-time model downloads.
- If a request can only be met with generated footage, say so and offer the code-rendered alternative
  (motion graphics, kinetic type, the user's own images or clips in `studio/public/`).
- Only download and clip videos the user owns or has permission to reuse. If that is unclear, ask once.

## 2. Model routing

Routing is enforced by the `model:` field of each subagent in `.claude/agents/`. Delegate with the Agent
tool; do not override a subagent's model downward for work in a higher tier.

| Tier | Subagent | Use it for | Never use it for |
|---|---|---|---|
| **Haiku** | `media-runner` | Running `engine/*.py` and `npm` commands, downloads, transcription, FFmpeg batches, Obsidian scan/build/log, reading JSON results, file housekeeping | Writing scripts, choosing hooks, editing TSX |
| **Sonnet** | `research-and-script` | Scriptwriting, hook selection from transcripts, titles, restructuring a note into scenes, editing manifests | Running long renders, debugging build failures |
| **Sonnet** | `remotion-builder` | New/edited Remotion scenes and components, new style presets, manifest-to-scene wiring | Root-causing broken builds after one failed fix |
| **Opus** | `studio-doctor` | Complex custom animation (physics, SVG path morphs, 3D, shaders, audio-reactive), debugging broken Remotion/FFmpeg/Python builds, deep structural narrative edits | Anything a lower tier can do |

Escalation rules:

1. Start at the lowest tier that fits the table. One step = one subagent call with a self-contained brief.
2. `media-runner` reports a failing command verbatim and stops. It does not attempt fixes beyond re-running
   with a corrected path or flag. A real failure goes to `studio-doctor`.
3. `remotion-builder` gets **one** attempt to fix its own typecheck or render error. If it still fails,
   hand the error output and the diff to `studio-doctor`.
4. Send narrative work to `studio-doctor` only when the *structure* must change (re-ordering the argument,
   merging or splitting acts, changing the angle). Line edits and tightening stay with `research-and-script`.
5. After Opus fixes or builds something, routine re-renders go back to `media-runner`.
6. Run independent steps in parallel (e.g. several clips, landscape + vertical stills).

## 3. Repository map

```
studio/                 Remotion project (TypeScript/React)
  src/Root.tsx          Two compositions: Landscape 1920x1080, Vertical 1080x1920
  src/ManifestVideo.tsx Renders any manifest: scenes + transitions + overlays + audio
  src/scenes/           One component per scene type (title, text, bullets, quote, stat, code, image, reddit, pixel, outro)
  src/scenes/pixel/     Code-drawn 16-bit pixel art library used by `pixel` scenes
  src/components/       Background, AnimatedText, SceneFrame, Overlays (captions, progress bar, handle)
  src/lib/              themes (auto-loads /styles), fonts (bundled), timing, layout, text
  manifests/            JSON manifests (tracked). manifests/.resolved/ is generated.
  public/               Static assets. public/assets/ is generated; public/audio/ is tracked.
engine/                 Python automation
  obsidian_bridge.py    Vault scan, note -> manifest, render log written back to the note
  render.py             Hardware-aware renderer + doctor/validate/still/preview/check-style
  narrate.py            Local text-to-speech per scene (Kokoro / Piper), re-times scenes to the voice; chiptune synth
  clipper.py            yt-dlp -> faster-whisper -> hook ranking -> speaker-tracked reframe -> captions
  hw.py                 Encoder detection (NVENC / VideoToolbox / QSV / AMF / x264)
  manifest.py           Manifest + style validation (mirrors studio/src/types.ts and styles/_schema.json)
styles/                 Theme presets + _schema.json + _template.json
media/, output/         Raw downloads and rendered files (git-ignored, per machine)
```

## 4. Commands

Always use the repo's virtualenv interpreter, from the repo root:

- macOS: `.venv/bin/python`
- Windows: `.venv\Scripts\python.exe`

Written below as `PY`.

```
PY engine/render.py doctor                          # tools, GPU encoder, vault path
PY engine/obsidian_bridge.py scan [--pending]       # list video notes
PY engine/obsidian_bridge.py build "<note>"         # note -> studio/manifests/<id>.json
PY engine/narrate.py <id> [--voice V] [--speed 0.95] # voice the scenes (auto-run by render when narrate: true)
PY engine/render.py validate <id>                   # schema check + computed duration
PY engine/render.py still <id> --scene s03 --format vertical   # one PNG, fast visual check
PY engine/render.py render <id> [--format landscape|vertical|both]
PY engine/render.py check-style [name]
PY engine/clipper.py candidates "<url|file>" --count 8
PY engine/clipper.py cut "<url|file|id>" --clips clips.json --style <name>
PY engine/clipper.py auto "<url|file>" --top 3      # fully automatic
cd studio && npm run typecheck
```

Every engine command prints a JSON result on stdout and progress on stderr. Read the JSON; do not guess paths.

## 5. Working rules

- **Manifests are the contract.** A video is a JSON manifest; edit the manifest to change content, edit TSX
  only to change how a scene type looks or to add a capability. Never hard-code a video's text in TSX.
- **Three files move together:** `studio/src/types.ts`, `engine/manifest.py`, `styles/_schema.json`. A new
  scene type or theme field must land in all the places that describe it, in one change.
- **Verify before claiming done:** after any TSX or style change run `npm run typecheck`, then a `still`
  in both formats and *look at the PNG* (Read it). After a render, confirm the JSON result lists the file.
- **Narrated videos:** run `narrate.py` *before* stills — it changes every scene's duration. After editing a
  scene's narration text, re-run it with `--force`.
- **Vertical safe zones:** keep text out of the top 10% and bottom 16% of 9:16 output (platform UI).
- **The Obsidian vault is the user's second brain.** The bridge writes only to the source note of a render
  (frontmatter keys `video_*` and the `## Render Log` section). Never create, move or edit other vault files.
- **Heavy files stay out of Git.** Nothing under `media/` or `output/`, and no `.mp4`, is ever committed.
  Code, skills, styles and manifests are what sync between the MacBook Pro and the Gaming PC.
- Do not put the vault path or any other machine-specific path in tracked files — it belongs in `.env`.
- Hardware is detected at runtime; never hard-code an encoder. If a GPU encode fails, re-run with
  `--encoder x264` and report it.
