---
name: obsidian-to-video
description: Turn an Obsidian note into a faceless, code-rendered video (16:9 YouTube and/or 9:16 Shorts/Reels/TikTok) with Remotion. Use when the user asks to make, render, build or produce a video, short or reel from a note, from their vault, or from "my notes on X" — or asks which notes are ready to render.
---

# Obsidian note → faceless video

Pipeline: vault note → JSON manifest → still check → hardware-accelerated render → log written back to the note.
Everything is local (see the Zero-Video-Token policy in `CLAUDE.md`). `PY` below is the venv interpreter
(`.venv/bin/python` on macOS, `.venv\Scripts\python.exe` on Windows).

## Steps

### 1. Find the note — `media-runner` (Haiku)
- If the user named a note, use it. Otherwise run `PY engine/obsidian_bridge.py scan --pending` and show the list.
- If the vault is not configured, the command says so: ask the user to set `OBSIDIAN_VAULT_PATH` in `.env`. Stop there.
- A note qualifies when its frontmatter has `video: true`, a `video_status`, or the tag `video`.
  If the user's note lacks that, ask before adding `video: true` (it is their vault).

### 2. Shape the script — `research-and-script` (Sonnet) — only when needed
Skip this step when the note already reads like a script. Use it when the note is raw notes, far longer
than `target_duration` allows (~2.5 spoken words per second), or lacks a hook.
- The agent reads the note and proposes a `## Script` section. **Show the user the proposed script and get
  approval before writing it into the note.** Research notes stay under `## Notes` (the bridge skips that heading).
- Script conventions the bridge understands:

  | Markdown | Scene |
  |---|---|
  | `# Heading` | section title card |
  | `## Heading` | label above the next scenes |
  | paragraph | text scene (split at sentences when long) |
  | `- item` list | numbered bullets |
  | `> quote` + `> — Name` | quote |
  | `> [!stat] 73%` + label line | animated statistic |
  | `> [!reddit] r/sub u/name 4.2k` + title + body | forum-post card |
  | `> [!cta] Follow for more` + line | outro |
  | fenced code block | code window |
  | `![[image.png]]` | full-bleed image |
  | `**bold**` / `==mark==` | accent-coloured emphasis |

### 3. Build the manifest — `media-runner`
```
PY engine/obsidian_bridge.py build "<note>" [--style <name>] [--format landscape|vertical|both] [--duration <sec>]
```
Frontmatter supplies `title`, `style`, `target_duration`, `format`; flags override it. Read the JSON result:
`id`, `scenes`, `durationSeconds`, `sceneTypes`. If the duration misses the target by more than ~10% or a
scene type looks wrong, fix the note (step 2) or edit `studio/manifests/<id>.json` directly, then
`PY engine/render.py validate <id>`.

### 4. Visual check — `media-runner`, then look yourself
```
PY engine/render.py still <id> --scene s01 --format vertical
PY engine/render.py still <id> --scene <a mid scene> --format landscape
```
Read the PNGs. Check: text fits and is legible, nothing sits in the vertical safe zones, emphasis colour
shows. Text overflow → shorten the scene text in the manifest or split the scene. A look the user dislikes
→ try `--style <other>`; a look that needs new code → `remotion-builder`.

### 5. Render — `media-runner`
```
PY engine/render.py render <id>
```
The encoder is picked at runtime (NVENC on the PC, VideoToolbox on the Mac). A full render takes minutes:
run it in the background and report when the JSON result arrives. On failure hand the output to `studio-doctor`.

### 6. Confirm
The render command logs back to the note automatically (`video_status: rendered`, `video_outputs`, and a line
under `## Render Log`). Report to the user: output paths, duration, file size, encoder used, and that the
note was updated. If logging failed (note missing on this machine), say so and give the manual command:
`PY engine/obsidian_bridge.py log "<note>" --render output/videos/<id>/render.json`.

## Notes
- Voiceover or music: put the file in `studio/public/audio/` and set `voiceover:` / `music:` in frontmatter
  (e.g. `music: audio/track.mp3`). Record narration yourself — no cloud TTS.
- A draft render is 4x faster: add `--scale 0.5`.
- `PY engine/obsidian_bridge.py new "Title"` creates a starter note with the right frontmatter.
