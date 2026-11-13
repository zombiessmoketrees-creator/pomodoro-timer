---
name: clip-youtube-video
description: Turn a long video into short vertical clips — download with yt-dlp, transcribe with faster-whisper, find the strongest viral hooks, crop to 9:16 with active-speaker tracking, and burn in animated word-by-word captions. Use when the user gives a YouTube URL (or a local video file) and asks for clips, shorts, reels, TikToks, highlights, or "the best moments".
---

# Long video → captioned vertical clips

Pipeline: download → word-level transcript → ranked candidates → **you pick the hooks** → reframe + captions + encode.
All local. `PY` is the venv interpreter (`.venv/bin/python` on macOS, `.venv\Scripts\python.exe` on Windows).

Only clip videos the user owns or has permission to reuse. If it is clearly someone else's content and the
user has not said they have rights, ask once before downloading.

## Steps

### 1. Download + transcribe + rank — `media-runner` (Haiku)
```
PY engine/clipper.py candidates "<url-or-file>" --count 10 --min 20 --max 60
```
This downloads (cached in `media/raw/<id>/`), transcribes (cached), and prints ranked candidates with
`start`, `end`, `score`, `hook`, `reasons`, `text`. Transcription of a long video takes a while — run it in
the background. The readable transcript is `media/raw/<id>/transcript.txt`.

Adjust `--min/--max` to the platform: 15–35s for punchy TikToks, 30–60s for Shorts/Reels.

### 2. Choose and tighten the hooks — `research-and-script` (Sonnet)
The heuristic ranking is a shortlist, not a decision. Give the agent the candidates JSON and the path to
`transcript.txt`, and have it return a `clips.json`:

```json
[
  {"start": 312.4, "end": 351.9, "title": "Why most people quit", "hook_text": "Why most people quit after 3 weeks"}
]
```
Selection criteria, in order:
1. **The first 2 seconds stand alone** — a question, a bold claim, a number, or a stake. No "so", "and", "like I said".
2. **One complete idea** with a payoff before the end; never cut mid-sentence. Move `start`/`end` to word
   boundaries using the word timestamps in `transcript.json`.
3. **No missing context** — a viewer who never saw the full video must follow it.
4. Prefer sections flagged `most-replayed section` (real audience data from YouTube).
5. Distinct topics; do not return overlapping clips.

`hook_text` is a ≤ 8-word headline shown at the top for the first seconds. It must be true to the clip.
Save the file to `media/raw/<id>/clips.json`. Unless the user asked for full automation, show the picks
(time range, hook line, one-line reason) and let them drop or swap any before cutting.

### 3. Cut, reframe and caption — `media-runner`
```
PY engine/clipper.py cut <id> --clips media/raw/<id>/clips.json --style kinetic-typography
```
- `--aspect 9:16` (default) | `1:1` | `4:5` | `16:9`
- `--reframe track` (default) follows the active speaker: faces are detected in every sampled frame, the
  one whose lips are moving wins, the virtual camera eases toward them and snaps on hard cuts.
  `--reframe center` is a static crop for screen recordings or gameplay.
- `--style <preset>` takes caption font, colours and words-per-line from `styles/<preset>.json`.
- `--caption-position bottom|middle|top`, `--no-captions`, `--no-hook`.
- Encoder is auto-detected (NVENC / VideoToolbox / x264).

### 4. Check and report
Read the JSON result. For each clip check `reframe.mode`:
- `face` — speaker tracking worked.
- `motion` — no faces found; the crop followed movement. Fine for b-roll, worth a look for talking heads.
- `center` — static crop.

Extract one frame per clip and look at it (`ffmpeg -ss 3 -i <clip> -frames:v 1 <png>`): the speaker is in
frame, captions are readable and not covering the mouth. Then report the paths (under
`output/clips/<id>/`), durations, and hook lines.

## Fully automatic mode
When the user says "just do it" or wants no review:
```
PY engine/clipper.py auto "<url-or-file>" --top 3 --style kinetic-typography
```
This cuts the top heuristic candidates without the Sonnet pass — faster, lower quality hooks.

## Troubleshooting
- Download fails → update yt-dlp (`PY -m pip install -U yt-dlp`), retry once, then report the error verbatim.
- Captions drift or words are wrong → re-transcribe with a bigger model:
  set `WHISPER_MODEL=medium` (or `large-v3`) in `.env`, then `PY engine/clipper.py transcribe <id> --force`.
- Camera follows the wrong person or jitters, FFmpeg errors, anything not fixed by a flag → `studio-doctor`.
