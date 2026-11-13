---
name: add-video-style
description: Create a new reusable visual theme preset from a described aesthetic (mood, colours, typography, motion) and save it to styles/. Use when the user describes a look they want for videos, asks for a new style, theme or preset, says "make it look like …", or wants to tweak an existing style into a variant.
---

# Described aesthetic → reusable style preset

A style is one JSON file in `styles/`. Remotion auto-discovers it (no code change) and the clipper uses its
`captions` block. Owner: `remotion-builder` (Sonnet). `PY` is the venv interpreter.

## Steps

### 1. Translate the description into design decisions
Before writing JSON, decide — and state in one line each:
- **Mood → motion.** Calm/serious: `blur` or `fade` text, `fade` transitions, spring damping ~200.
  Energetic: `kinetic` or `slide-up`, `cut` or `slide`, damping 10–18. Technical: `typewriter`, `wipe`.
- **Palette.** One background pair, one text colour, one accent, one secondary accent. Text on background
  must reach **7:1** contrast and accent on background **3:1** (the validator enforces both). Video
  compression punishes low contrast and thin saturated text.
- **Type.** Pick from the bundled families only: Inter, Space Grotesk, IBM Plex Sans, Playfair Display,
  Anton, JetBrains Mono. Display face for headings, a text face for body.
- **Background.** `solid`, `gradient` (drifting glow), `grid` (tech), `particles` (energy). Add `vignette`
  and `grain` for a filmic look; keep both at 0 for flat/clean looks.
- **Pacing.** `wordsPerSecond` 2.3–2.6 for long-form, 2.8–3.2 for shorts.

Do not copy a named creator's or brand's exact identity; build an original look in that spirit.

### 2. Write the preset
Copy `styles/_template.json` to `styles/<kebab-name>.json` and edit every field. `name` must equal the file
name. `styles/_schema.json` documents every field, its range and allowed values — follow it exactly; no
extra keys. Write a real `description` (the look, the mood, what content it suits): other agents choose
styles by reading it.

### 3. Validate
```
PY engine/render.py check-style <name>
```
Fix every reported error (it lists them all at once, with paths).

### 4. Look at it in both formats
```
PY engine/render.py still sample --style <name> --scene s01 --format landscape
PY engine/render.py still sample --style <name> --scene s02 --format vertical
PY engine/render.py still sample --style <name> --scene s04 --format vertical
PY engine/render.py still sample --style <name> --scene s06 --format landscape
```
Read each PNG. Check hierarchy (heading clearly dominant), legibility at phone size, accent used sparingly,
code window readable (`surface` vs `text`). Adjust and re-render until it matches the description.
Motion cannot be judged from stills: render a quick draft when motion matters —
`PY engine/render.py render sample --style <name> --format vertical --scale 0.5 --no-log`.

### 5. Report
Show the user the stills, the file path, and how to use it: `style: <name>` in a note's frontmatter or
`--style <name>` on any command.

## When JSON is not enough
The preset can only combine what the components already support. If the aesthetic needs something new —
- **a new font** → `npm i @fontsource/<family>` in `studio/`, import the weights in
  `studio/src/lib/fonts.ts`, add the family to `FONT_FAMILIES` there and to the `enum`s in
  `styles/_schema.json`. For burned clip captions also drop the TTF into `engine/fonts/`.
- **a new background / text animation / transition** → add the option to `studio/src/types.ts`, implement it
  in `studio/src/components/` (or `ManifestVideo.tsx` for transitions), and add it to the matching `enum`
  in `styles/_schema.json`. Run `npm run typecheck`.

Simple additions stay with `remotion-builder`. Physics, shaders, 3D, SVG morphing or audio-reactive motion
go to `studio-doctor` (Opus).
