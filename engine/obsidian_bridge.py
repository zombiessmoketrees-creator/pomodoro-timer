#!/usr/bin/env python3
"""Obsidian <-> studio bridge.

    python engine/obsidian_bridge.py scan [--json]
    python engine/obsidian_bridge.py build "<note>" [--style S] [--format F] [--duration SEC]
    python engine/obsidian_bridge.py build --all
    python engine/obsidian_bridge.py log "<note>" --render output/videos/<id>/render.json
    python engine/obsidian_bridge.py new "My Video Title" [--style S]

The vault location comes from OBSIDIAN_VAULT_PATH in .env. A note is a video
note when its frontmatter has `video: true`, a `video_status`, or the tag
`video`. Supported frontmatter:

    title, subtitle, kicker, style, target_duration (60, "60s", "1:30"),
    format (landscape|vertical|both), fps, handle, cta, outro,
    voiceover, music (a file, or "chiptune" to generate one), narrate (true = local
    text-to-speech reads every scene), subreddit, author, upvotes, comments

Body -> scenes:
    # Heading 1            section title card
    ## Heading 2+          label shown above the scenes that follow
    paragraph              text scene (long paragraphs split at sentences)
    - list / 1. list       bullets scene
    > quote / > — Name     quote scene
    > [!stat] 73%          stat scene (following lines are the label)
    > [!reddit] r/sub      forum-post card (following lines: title, then body)
    > [!cta] Subscribe     outro scene
    > [!pixel] mothman     16-bit pixel-art scene (following lines are the dialog-box text)
    ```lang ... ```        code scene
    ![[image.png]]         image scene (copied into studio/public/assets)
    **bold** / ==mark==    accent-coloured emphasis
If the note has a "## Script" heading, everything above it is ignored. Sections
titled Notes, Research, Sources, References, Links, Todo, Outline or Ideas are
skipped, and everything from "## Render Log" down is ignored — that section is
written by this tool.

The bridge only ever writes to the source note itself, and refuses any path
outside the vault.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import MANIFEST_DIR, PUBLIC_DIR, die, env, log, read_json, slugify, write_json  # noqa: E402
from manifest import FORMATS, list_styles, load_style, manifest_duration, validate_manifest  # noqa: E402

try:
    import yaml
except ImportError:  # pragma: no cover - reported by `render.py doctor`
    yaml = None  # type: ignore[assignment]

SKIP_DIRS = {".obsidian", ".trash", ".git", "node_modules", ".venv"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"}
NON_CONTENT_FENCES = {"dataview", "dataviewjs", "tasks", "mermaid", "button", "query", "ad-note", "excalidraw"}
LOG_HEADING = "Render Log"
EXCLUDED_SECTIONS = {"notes", "research", "sources", "references", "links", "todo", "to do", "outline", "ideas"}
OWNED_KEYS = ("video_status", "video_last_render", "video_manifest", "video_outputs")
FRONTMATTER_RE = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.DOTALL)


# --------------------------------------------------------------------------- #
# Vault access
# --------------------------------------------------------------------------- #
def vault_path() -> Path:
    raw = env("OBSIDIAN_VAULT_PATH")
    if not raw:
        die("OBSIDIAN_VAULT_PATH is not set. Copy .env.example to .env and point it at your vault.")
    path = Path(os.path.expandvars(raw)).expanduser()
    if not path.is_dir():
        die(f"OBSIDIAN_VAULT_PATH does not exist or is not a folder: {path}")
    return path.resolve()


def scan_root(vault: Path) -> Path:
    folder = env("OBSIDIAN_VIDEO_FOLDER")
    root = (vault / folder).resolve() if folder else vault
    if not root.is_dir():
        die(f"OBSIDIAN_VIDEO_FOLDER '{folder}' does not exist inside the vault ({vault}).")
    ensure_inside(root, vault)
    return root


def ensure_inside(path: Path, vault: Path) -> None:
    try:
        path.resolve().relative_to(vault)
    except ValueError:
        die(f"Refusing to touch {path}: it is outside the vault ({vault}).")


def iter_notes(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in sorted(filenames):
            if name.lower().endswith(".md"):
                yield Path(dirpath) / name


def split_note(text: str) -> tuple[dict[str, Any], str, str]:
    """Return (frontmatter dict, raw frontmatter text, body)."""
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, "", text
    if yaml is None:
        die("PyYAML is required to read frontmatter: pip install -r engine/requirements.txt")
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as exc:
        die(f"Invalid YAML frontmatter: {exc}")
    return (meta if isinstance(meta, dict) else {}), match.group(1), text[match.end():]


def is_video_note(meta: dict[str, Any]) -> bool:
    if meta.get("video") is True or meta.get("video_status"):
        return True
    tags = meta.get("tags") or meta.get("tag") or []
    if isinstance(tags, str):
        tags = re.split(r"[,\s]+", tags)
    return any(str(t).lstrip("#").lower() == "video" for t in tags)


def resolve_note(arg: str, vault: Path) -> Path:
    """Find a note by absolute path, vault-relative path, or (unique) note name."""
    root = scan_root(vault)
    for base in (None, vault, root):
        for suffix in ("", ".md"):
            candidate = Path(arg + suffix).expanduser() if base is None else base / (arg + suffix)
            if candidate.is_file():
                ensure_inside(candidate, vault)
                return candidate.resolve()
    wanted = Path(arg).stem.lower()
    matches = [p for p in iter_notes(root) if p.stem.lower() == wanted]
    if len(matches) == 1:
        return matches[0].resolve()
    if len(matches) > 1:
        die(f"'{arg}' matches several notes; pass a vault-relative path:\n  " + "\n  ".join(str(m.relative_to(vault)) for m in matches))
    die(f"Note not found: {arg} (searched {root})")


# --------------------------------------------------------------------------- #
# Markdown -> blocks
# --------------------------------------------------------------------------- #
def clean_inline(text: str) -> str:
    """Reduce Obsidian markdown to plain text, keeping **emphasis** markers."""
    text = re.sub(r"!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)", "", text)           # inline embeds
    text = re.sub(r"\[\[[^\]|]*\|([^\]]+)\]\]", r"\1", text)                    # [[target|alias]]
    text = re.sub(r"\[\[([^\]#|]+)(?:#[^\]]*)?\]\]", r"\1", text)               # [[target#heading]]
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)                        # [text](url)
    text = re.sub(r"\[\^[^\]]+\]", "", text)                                    # footnote refs
    text = re.sub(r"<[^>]+>", "", text)                                         # html
    text = re.sub(r"==(.+?)==", r"**\1**", text)                                # highlight -> emphasis
    text = re.sub(r"__(.+?)__", r"**\1**", text)
    text = re.sub(r"~~.+?~~", "", text)                                         # struck text is not said
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"(?<![*\w])\*(?!\*)([^*\n]+?)(?<!\*)\*(?![*\w])", r"\1", text)  # *italic*
    text = re.sub(r"(?<![_\w])_(?!_)([^_\n]+?)(?<!_)_(?![_\w])", r"\1", text)      # _italic_
    text = re.sub(r"(?<!\S)#[A-Za-z][\w/-]*", "", text)                         # #tags
    text = re.sub(r"\s\^[\w-]+\s*$", "", text)                                  # ^block-id
    return re.sub(r"\s+", " ", text).strip()


def plain(text: str) -> str:
    return text.replace("**", "")


def word_count(text: str) -> int:
    return len(plain(text).split())


def select_script(body: str) -> str:
    """Drop comments, the render log and working sections; start at '## Script' when present."""
    body = re.sub(r"%%.*?%%", "", body, flags=re.DOTALL)
    body = re.sub(r"<!--.*?-->", "", body, flags=re.DOTALL)
    lines = body.splitlines()
    for i, line in enumerate(lines):
        if re.match(rf"^#{{1,6}}\s+{LOG_HEADING}\s*$", line, re.IGNORECASE):
            lines = lines[:i]
            break
    for i, line in enumerate(lines):
        if re.match(r"^#{1,6}\s+Script\s*$", line, re.IGNORECASE):
            lines = lines[i + 1:]  # everything above the Script heading is preamble
            break
    # Remove working sections (Notes, Research, ...) together with their sub-headings.
    kept: list[str] = []
    skip_level = 0
    in_fence = False
    for line in lines:
        if line.strip().startswith(("```", "~~~")):
            in_fence = not in_fence
        heading = None if in_fence else re.match(r"^(#{1,6})\s+(.*?)\s*$", line)
        if heading:
            level = len(heading.group(1))
            if skip_level and level <= skip_level:
                skip_level = 0
            if not skip_level and heading.group(2).strip().lower() in EXCLUDED_SECTIONS:
                skip_level = level
        if not skip_level:
            kept.append(line)
    return "\n".join(kept)


def parse_blocks(body: str) -> list[dict[str, Any]]:
    lines = select_script(body).splitlines()
    blocks: list[dict[str, Any]] = []
    paragraph: list[str] = []

    def flush() -> None:
        if paragraph:
            text = clean_inline(" ".join(paragraph))
            if text:
                blocks.append({"kind": "paragraph", "text": text})
            paragraph.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        fence = re.match(r"^(`{3,}|~{3,})\s*([\w+#.-]*)", stripped)
        if fence:
            flush()
            marker, language = fence.group(1), fence.group(2).lower()
            code: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith(marker):
                code.append(lines[i].rstrip())
                i += 1
            i += 1
            if language not in NON_CONTENT_FENCES and any(c.strip() for c in code):
                blocks.append({"kind": "code", "language": language, "code": "\n".join(code).strip("\n")})
            continue

        heading = re.match(r"^(#{1,6})\s+(.*?)\s*#*$", stripped)
        if heading:
            flush()
            text = clean_inline(heading.group(2))
            if text:
                blocks.append({"kind": "heading", "level": len(heading.group(1)), "text": plain(text)})
            i += 1
            continue

        if stripped.startswith(">"):
            flush()
            quote: list[str] = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(re.sub(r"^\s*>\s?", "", lines[i]).rstrip())
                i += 1
            blocks.append(parse_quote(quote))
            continue

        if re.match(r"^\s*([-*+]|\d+[.)])\s+\S", line):
            flush()
            items: list[str] = []
            while i < len(lines) and (re.match(r"^\s*([-*+]|\d+[.)])\s+\S", lines[i]) or
                                      (items and lines[i].startswith(("  ", "\t")) and lines[i].strip())):
                item = re.match(r"^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$", lines[i])
                if item:
                    cleaned = clean_inline(item.group(1))
                    if cleaned:
                        items.append(cleaned)
                elif items:  # wrapped continuation line
                    items[-1] = clean_inline(items[-1] + " " + lines[i].strip())
                i += 1
            if items:
                blocks.append({"kind": "list", "items": items})
            continue

        embed = re.match(r"^!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]\s*(.*)$", stripped) or \
            re.match(r"^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$", stripped)
        if embed:
            flush()
            if stripped.startswith("![["):
                target, caption = embed.group(1).strip(), clean_inline(embed.group(2))
            else:
                target, caption = embed.group(2).strip(), clean_inline(embed.group(1))
            if Path(target.split("?")[0]).suffix.lower() in IMAGE_EXTENSIONS:
                blocks.append({"kind": "image", "target": target, "caption": caption})
            i += 1
            continue

        if not stripped or re.match(r"^([-*_])(\s*\1){2,}$", stripped) or stripped.startswith("|"):
            flush()  # blank line, horizontal rule or table row
            i += 1
            continue

        paragraph.append(stripped)
        i += 1
    flush()
    return blocks


def parse_quote(lines: list[str]) -> dict[str, Any]:
    callout = re.match(r"^\[!(\w+)\][+-]?\s*(.*)$", lines[0].strip()) if lines else None
    if callout:
        kind, head = callout.group(1).lower(), clean_inline(callout.group(2))
        rest = [clean_inline(line) for line in lines[1:] if line.strip()]
        if kind == "stat":
            return {"kind": "stat", "value": plain(head), "label": " ".join(rest)}
        if kind == "reddit":
            parts = head.split()
            return {"kind": "reddit",
                    "subreddit": next((p for p in parts if p.startswith("r/")), ""),
                    "author": next((p for p in parts if p.startswith("u/")), ""),
                    "upvotes": next((p for p in parts if re.match(r"^[\d.,]+[kKmM]?$", p)), ""),
                    "title": rest[0] if rest else "", "body": " ".join(rest[1:])}
        if kind == "pixel":
            return {"kind": "pixel", "art": plain(head).strip().lower(), "text": plain(" ".join(rest))}
        if kind in ("cta", "outro"):
            return {"kind": "outro", "title": " ".join(rest) or head, "cta": head if rest else ""}
        if kind == "quote":
            lines = ([callout.group(2)] if callout.group(2) else []) + lines[1:]
        else:  # [!note], [!info], ... -> ordinary narration
            return {"kind": "paragraph", "text": " ".join(filter(None, [head, *rest]))}
    content = [line for line in lines if line.strip()]
    attribution = ""
    if len(content) > 1 and re.match(r"^\s*(—|–|--|-)\s*\S", content[-1]):
        attribution = plain(clean_inline(re.sub(r"^\s*(—|–|--|-)\s*", "", content.pop())))
    return {"kind": "quote", "text": clean_inline(" ".join(content)), "attribution": attribution}


# --------------------------------------------------------------------------- #
# Blocks -> scenes
# --------------------------------------------------------------------------- #
def split_paragraph(text: str, max_words: int) -> list[str]:
    """Split at sentence boundaries so no scene carries more than max_words."""
    if word_count(text) <= max_words:
        return [text]
    sentences = re.split(r"(?<=[.!?…])[\"')\]]*\s+(?=[\"'(\[*A-Z0-9])", text)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if current and word_count(current) + word_count(sentence) > max_words:
            chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current)
    # A single very long sentence still needs breaking: fall back to word windows.
    out: list[str] = []
    for chunk in chunks:
        words = chunk.split()
        if len(words) <= max_words * 1.4:
            out.append(chunk)
        else:
            out += [" ".join(words[j:j + max_words]) for j in range(0, len(words), max_words)]
    return [rebalance_emphasis(c) for c in out]


def rebalance_emphasis(text: str) -> str:
    """Splitting can cut a **bold** span in two; drop the dangling marker."""
    return text if text.count("**") % 2 == 0 else text.replace("**", "")


def parse_duration(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip().lower()
    clock = re.match(r"^(\d+):(\d{1,2})$", text)
    if clock:
        return int(clock.group(1)) * 60 + int(clock.group(2))
    match = re.match(r"^(?:(\d+(?:\.\d+)?)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec)?)?$", text)
    if match and (match.group(1) or match.group(2)):
        return float(match.group(1) or 0) * 60 + float(match.group(2) or 0)
    try:
        return float(text)
    except ValueError:
        die(f"Could not read target_duration '{value}'. Use seconds (60), '60s', '1m30s' or '1:30'.")


class AssetCopier:
    """Resolves image embeds the way Obsidian does and copies them into studio/public."""

    def __init__(self, vault: Path, note: Path, slug: str) -> None:
        self.vault, self.note, self.slug = vault, note, slug
        self._index: dict[str, Path] | None = None

    def _lookup(self, target: str) -> Path | None:
        for candidate in (self.note.parent / target, self.vault / target):
            if candidate.is_file():
                return candidate
        if self._index is None:
            self._index = {}
            for dirpath, dirnames, filenames in os.walk(self.vault):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for name in filenames:
                    if Path(name).suffix.lower() in IMAGE_EXTENSIONS:
                        self._index.setdefault(name.lower(), Path(dirpath) / name)
        return self._index.get(Path(target).name.lower())

    def copy(self, target: str) -> str | None:
        if re.match(r"^https?://", target):
            return target
        source = self._lookup(target)
        if not source:
            log(f"Image not found in vault, skipping: {target}")
            return None
        dest_dir = PUBLIC_DIR / "assets" / self.slug
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{slugify(source.stem)}{source.suffix.lower()}"
        shutil.copy2(source, dest)
        return dest.relative_to(PUBLIC_DIR).as_posix()


def build_scenes(meta: dict, blocks: list[dict], theme: dict, title: str, assets: AssetCopier) -> list[dict]:
    pacing = theme["pacing"]
    wps = pacing["wordsPerSecond"]
    max_words = int(min(42, max(12, wps * pacing["maxSceneSeconds"])))
    scenes: list[dict] = []
    heading: str | None = None

    def add(scene: dict, seconds: float, narration: str = "") -> None:
        nonlocal heading
        if scene["type"] in ("text", "bullets", "code") and heading:
            scene["heading"] = heading
            heading = None
        scene["_natural"] = seconds
        if narration:
            scene["narration"] = plain(narration)
        scenes.append({k: v for k, v in scene.items() if v not in (None, "")})

    def read_time(text: str, base: float = 0.8) -> float:
        return word_count(text) / wps + base

    # Opening: a forum-post card for story styles, otherwise a title card.
    first_h1 = next((b for b in blocks if b["kind"] == "heading" and b["level"] == 1), None)
    if first_h1 and blocks and blocks[0] is first_h1:
        blocks = blocks[1:]
    opens_with_card = bool(blocks) and blocks[0]["kind"] == "reddit"
    if not opens_with_card:
        if meta.get("subreddit") or theme["name"] == "reddit-story":
            add({"type": "reddit", "subreddit": str(meta.get("subreddit") or "r/stories"),
                 "author": str(meta.get("author") or "u/anonymous"), "title": title,
                 "upvotes": str(meta.get("upvotes") or ""), "comments": str(meta.get("comments") or "")},
                read_time(title, 1.6), title)
        else:
            add({"type": "title", "title": title, "subtitle": str(meta.get("subtitle") or ""),
                 "kicker": str(meta.get("kicker") or "")},
                read_time(f"{title} {meta.get('subtitle') or ''}", 1.6), title)

    for block in blocks:
        kind = block["kind"]
        if kind == "heading":
            if block["level"] == 1:
                add({"type": "title", "title": block["text"]}, read_time(block["text"], 1.4), block["text"])
                heading = None
            else:
                heading = block["text"]
        elif kind == "paragraph":
            for chunk in split_paragraph(block["text"], max_words):
                add({"type": "text", "text": chunk}, read_time(chunk), chunk)
        elif kind == "list":
            items = block["items"]
            for start in range(0, len(items), 5):
                group = items[start:start + 5]
                add({"type": "bullets", "items": group},
                    sum(word_count(i) for i in group) / wps + 0.7 * len(group) + 0.8, ". ".join(group))
        elif kind == "quote" and block["text"]:
            add({"type": "quote", "text": block["text"], "attribution": block["attribution"]},
                read_time(block["text"], 1.6), block["text"])
        elif kind == "stat" and block["value"]:
            label = block["label"] or ""
            add({"type": "stat", "value": block["value"], "label": plain(label)},
                max(3.0, read_time(label, 2.0)), f"{block['value']} {label}")
        elif kind == "reddit" and block["title"]:
            add({"type": "reddit", "subreddit": block["subreddit"] or str(meta.get("subreddit") or "r/stories"),
                 "author": block["author"] or str(meta.get("author") or "u/anonymous"),
                 "title": block["title"], "body": block["body"], "upvotes": block["upvotes"]},
                read_time(f"{block['title']} {block['body']}", 1.6), f"{block['title']} {block['body']}")
        elif kind == "code":
            code_lines = block["code"].splitlines()[:16]
            add({"type": "code", "code": "\n".join(code_lines), "language": block["language"]},
                min(pacing["maxSceneSeconds"], 2.0 + 0.9 * len(code_lines)))
        elif kind == "image":
            src = assets.copy(block["target"])
            if src:
                add({"type": "image", "src": src, "caption": plain(block["caption"])},
                    max(3.5, read_time(block["caption"], 2.5)), block["caption"])
        elif kind == "pixel" and block["text"]:
            add({"type": "pixel", "art": block["art"], "text": block["text"]}, read_time(block["text"], 1.2), block["text"])
        elif kind == "outro":
            add({"type": "outro", "title": plain(block["title"]), "cta": plain(block["cta"])},
                max(3.0, read_time(block["title"], 2.0)), block["title"])

    if meta.get("cta") and not any(s["type"] == "outro" for s in scenes):
        outro_title = str(meta.get("outro") or "Thanks for watching")
        add({"type": "outro", "title": outro_title, "cta": str(meta["cta"])}, max(3.0, read_time(outro_title, 2.0)),
            outro_title)

    for index, scene in enumerate(scenes, start=1):
        scene["id"] = f"s{index:02d}"
    return scenes


def assign_durations(scenes: list[dict], theme: dict, fps: int, target: float | None) -> None:
    """Turn natural reading times into final durations, scaled to hit the target length."""
    pacing = theme["pacing"]
    for scene in scenes:
        natural = scene.pop("_natural")
        scene["durationInSeconds"] = min(pacing["maxSceneSeconds"], max(pacing["minSceneSeconds"], natural))
    if target:
        floor = 1.2
        for _ in range(4):  # clamping changes the sum, so converge over a few passes
            probe = {"fps": fps, "scenes": scenes}
            actual = manifest_duration(probe, theme)
            overlap = sum(s["durationInSeconds"] for s in scenes) - actual
            factor = (target + overlap) / max(0.1, actual + overlap)
            if abs(factor - 1) < 0.002:
                break
            for scene in scenes:
                scene["durationInSeconds"] = max(floor, scene["durationInSeconds"] * factor)
        # Put any remaining rounding error on the longest scene.
        drift = target - manifest_duration({"fps": fps, "scenes": scenes}, theme)
        longest = max(scenes, key=lambda s: s["durationInSeconds"])
        if longest["durationInSeconds"] + drift > floor:
            longest["durationInSeconds"] += drift
    for scene in scenes:
        scene["durationInSeconds"] = round(scene["durationInSeconds"], 2)


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def build_manifest(note: Path, vault: Path, style: str | None = None, fmt: str | None = None,
                   duration: float | None = None) -> tuple[dict, Path]:
    meta, _, body = split_note(note.read_text(encoding="utf-8"))
    blocks = parse_blocks(body)
    first_h1 = next((b["text"] for b in blocks if b["kind"] == "heading" and b["level"] == 1), None)
    leading_h1 = blocks[0]["text"] if blocks and blocks[0]["kind"] == "heading" and blocks[0]["level"] == 1 else None
    title = str(meta.get("title") or leading_h1 or first_h1 or note.stem).strip()

    style_name = str(style or meta.get("style") or env("DEFAULT_STYLE", "documentary-dark"))
    theme = load_style(style_name)
    video_format = str(fmt or meta.get("format") or env("DEFAULT_FORMAT", "both")).lower()
    if video_format not in FORMATS:
        die(f"format '{video_format}' in {note.name} must be one of {FORMATS}")
    fps = int(meta.get("fps") or 30)
    target = duration or parse_duration(
        meta.get("target_duration", meta.get("targetDuration", meta.get("duration"))))

    slug = slugify(title)
    scenes = build_scenes(meta, blocks, theme, title, AssetCopier(vault, note, slug))
    if len(scenes) < 2:
        die(f"{note.name} has no script content to turn into scenes (only a title was found).")
    assign_durations(scenes, theme, fps, target)

    manifest: dict[str, Any] = {
        "version": 1, "id": slug, "title": plain(title), "format": video_format, "fps": fps, "style": style_name,
    }
    if target:
        manifest["targetDuration"] = target
    handle = meta.get("handle") or env("CHANNEL_HANDLE")
    if handle:
        manifest["branding"] = {"handle": str(handle)}
    audio = {k: str(meta[k]) for k in ("voiceover", "music") if meta.get(k)}
    if audio:
        manifest["audio"] = audio
    if meta.get("narrate") is True:
        manifest["narrate"] = True  # engine/narrate.py voices each scene and re-times it to the audio
    manifest["scenes"] = scenes
    manifest["source"] = {"vault": str(vault), "note": note.relative_to(vault).as_posix(), "notePath": str(note)}

    errors = validate_manifest(manifest)
    if errors:
        die("Generated manifest failed validation (this is a bridge bug):\n  - " + "\n  - ".join(errors))
    path = MANIFEST_DIR / f"{slug}.json"
    write_json(path, manifest)
    return manifest, path


# --------------------------------------------------------------------------- #
# Write-back
# --------------------------------------------------------------------------- #
def _yaml_scalar(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)  # a JSON string is a valid YAML double-quoted scalar


def update_frontmatter(text: str, updates: dict[str, Any]) -> str:
    """Set the bridge-owned keys while leaving every other frontmatter line untouched."""
    match = FRONTMATTER_RE.match(text)
    kept: list[str] = []
    if match:
        skipping = False
        for line in match.group(1).splitlines():
            key = re.match(r"^([A-Za-z0-9_-]+)\s*:", line)
            if key:
                skipping = key.group(1) in updates
            elif skipping and (line.startswith((" ", "\t", "-")) or not line.strip()):
                continue  # continuation of a key we are replacing
            else:
                skipping = False
            if not skipping:
                kept.append(line)
    for key, value in updates.items():
        if isinstance(value, list):
            kept.append(f"{key}:")
            kept += [f"  - {_yaml_scalar(str(v))}" for v in value]
        else:
            kept.append(f"{key}: {_yaml_scalar(str(value))}")
    block = "---\n" + "\n".join(kept) + "\n---\n"
    return block + (text[match.end():] if match else "\n" + text)


def append_log(text: str, entry: str) -> str:
    lines = text.rstrip("\n").split("\n")
    for i, line in enumerate(lines):
        if re.match(rf"^#{{1,6}}\s+{LOG_HEADING}\s*$", line, re.IGNORECASE):
            end = len(lines)
            for j in range(i + 1, len(lines)):
                if re.match(r"^#{1,6}\s+", lines[j]):
                    end = j
                    break
            while end > i + 1 and not lines[end - 1].strip():
                end -= 1
            lines[end:end] = [entry]
            return "\n".join(lines) + "\n"
    return "\n".join(lines) + f"\n\n## {LOG_HEADING}\n\n{entry}\n"


def log_render(note_path: str | Path, result: dict, relative: str | None = None) -> Path:
    """Record a finished render in the source note: frontmatter status + a Render Log line.

    `relative` is the vault-relative path. It is the fallback when `note_path` is an
    absolute path from the other machine (the manifest was built on the Mac and
    rendered on the PC, or the other way round).
    """
    vault = vault_path()
    note = Path(note_path).expanduser()
    if not note.is_absolute():
        note = vault / note
    if not note.is_file() and relative and (vault / relative).is_file():
        note = vault / relative
    if not note.is_file():
        die(f"Source note not found on this machine: {note}")
    ensure_inside(note, vault)

    stamp = dt.datetime.now().astimezone()
    outputs = result.get("outputs", [])
    text = note.read_text(encoding="utf-8")
    text = update_frontmatter(text, {
        "video_status": "rendered",
        "video_last_render": stamp.isoformat(timespec="seconds"),
        "video_manifest": Path(result.get("manifest", "")).name,
        "video_outputs": [o["path"] for o in outputs],
    })
    for o in outputs:
        entry = (f"- {stamp:%Y-%m-%d %H:%M} — **{o['format']}** {o['width']}×{o['height']}, {o['duration']}s, "
                 f"{o['sizeMB']} MB, style `{result.get('style', '?')}`, encoder `{o['encoder']}` on "
                 f"{result.get('machine', 'unknown')} ({o['renderSeconds']}s) → `{o['path']}`")
        text = append_log(text, entry)

    tmp = note.with_name(note.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(note)
    return note


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def cmd_scan(args: argparse.Namespace) -> None:
    vault = vault_path()
    rows = []
    for note in iter_notes(scan_root(vault)):
        try:
            meta, _, body = split_note(note.read_text(encoding="utf-8"))
        except (SystemExit, UnicodeDecodeError):
            log(f"Skipping unreadable note: {note}")
            continue
        if not is_video_note(meta):
            continue
        rows.append({
            "note": note.relative_to(vault).as_posix(),
            "title": str(meta.get("title") or note.stem),
            "style": str(meta.get("style") or env("DEFAULT_STYLE", "documentary-dark")),
            "format": str(meta.get("format") or env("DEFAULT_FORMAT", "both")),
            "targetDuration": parse_duration(meta.get("target_duration", meta.get("duration"))),
            "status": str(meta.get("video_status") or "new"),
            "lastRender": str(meta.get("video_last_render") or ""),
            "words": word_count(" ".join(b.get("text", "") for b in parse_blocks(body))),
        })
    if args.pending:
        rows = [r for r in rows if r["status"] != "rendered"]
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return
    if not rows:
        print(f"No video notes found under {scan_root(vault)}. Add `video: true` to a note's frontmatter.")
        return
    for r in rows:
        duration = f"{r['targetDuration']:.0f}s" if r["targetDuration"] else "auto"
        print(f"[{r['status']:<8}] {r['note']}  —  {r['style']}, {r['format']}, {duration}, {r['words']} words")


def cmd_build(args: argparse.Namespace) -> None:
    vault = vault_path()
    if args.all:
        notes = []
        for note in iter_notes(scan_root(vault)):
            meta, _, _ = split_note(note.read_text(encoding="utf-8"))
            if is_video_note(meta) and str(meta.get("video_status") or "new") != "rendered":
                notes.append(note)
        if not notes:
            die("No un-rendered video notes found.")
    elif args.note:
        notes = [resolve_note(args.note, vault)]
    else:
        die("Pass a note name/path or --all.")

    results = []
    for note in notes:
        manifest, path = build_manifest(note, vault, args.style, args.format, args.duration)
        theme = load_style(manifest["style"])
        results.append({
            "manifest": str(path), "id": manifest["id"], "title": manifest["title"], "style": manifest["style"],
            "format": manifest["format"], "scenes": len(manifest["scenes"]),
            "durationSeconds": round(manifest_duration(manifest, theme), 2),
            "sceneTypes": [s["type"] for s in manifest["scenes"]],
            "note": manifest["source"]["note"],
        })
        log(f"Built {path.name}: {results[-1]['scenes']} scenes, {results[-1]['durationSeconds']}s")
    print(json.dumps(results if args.all else results[0], indent=2, ensure_ascii=False))


def cmd_log(args: argparse.Namespace) -> None:
    vault = vault_path()
    note = resolve_note(args.note, vault)
    result = read_json(Path(args.render).expanduser())
    print(json.dumps({"loggedTo": str(log_render(note, result))}))


def cmd_new(args: argparse.Namespace) -> None:
    vault = vault_path()
    root = scan_root(vault)
    style = args.style or env("DEFAULT_STYLE", "documentary-dark")
    if style not in list_styles():
        die(f"Unknown style '{style}'. Available: {', '.join(list_styles())}")
    safe_name = re.sub(r'[\\/:*?"<>|]', "", args.title).strip() or "Untitled video"
    note = root / f"{safe_name}.md"
    ensure_inside(note, vault)
    if note.exists():
        die(f"Note already exists: {note}")
    note.write_text(
        f"---\ntitle: {_yaml_scalar(args.title)}\nvideo: true\nstyle: {style}\nformat: both\n"
        f"target_duration: 60\nvideo_status: draft\n---\n\n## Script\n\n"
        "Open with the hook — the one line that earns the next ten seconds.\n\n"
        "## The idea\n\nExplain the core idea in two or three short sentences. Use **bold** for the words to emphasise.\n\n"
        "- First supporting point\n- Second supporting point\n- Third supporting point\n\n"
        "> [!stat] 73%\n> of viewers decide in the first three seconds\n\n"
        "> [!cta] Follow for more\n> That's the whole idea.\n",
        encoding="utf-8", newline="\n")
    print(json.dumps({"created": str(note)}))


def main() -> None:
    parser = argparse.ArgumentParser(description="Turn Obsidian notes into Remotion manifests and log renders back.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("scan", help="List video notes in the vault")
    p.add_argument("--json", action="store_true")
    p.add_argument("--pending", action="store_true", help="Only notes not yet rendered")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("build", help="Build a manifest from a note")
    p.add_argument("note", nargs="?", help="Note name, vault-relative path or absolute path")
    p.add_argument("--all", action="store_true", help="Build every un-rendered video note")
    p.add_argument("--style", choices=list_styles())
    p.add_argument("--format", choices=list(FORMATS))
    p.add_argument("--duration", type=float, help="Target length in seconds (overrides frontmatter)")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("log", help="Write render metadata back to a note")
    p.add_argument("note")
    p.add_argument("--render", required=True, help="Path to output/videos/<id>/render.json")
    p.set_defaults(func=cmd_log)

    p = sub.add_parser("new", help="Create a starter video note in the vault")
    p.add_argument("title")
    p.add_argument("--style")
    p.set_defaults(func=cmd_new)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
