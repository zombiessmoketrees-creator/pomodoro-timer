"""Manifest + style validation shared by the bridge and the renderer.

Mirrors studio/src/types.ts and styles/_schema.json. Validation is done by hand
(no jsonschema dependency) and reports every problem at once with its path.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from common import STYLES_DIR, die, read_json

SCENE_FIELDS: dict[str, dict[str, tuple[type, bool]]] = {
    # type -> field -> (python type, required)
    "title": {"title": (str, True), "subtitle": (str, False), "kicker": (str, False)},
    "text": {"text": (str, True), "heading": (str, False)},
    "bullets": {"items": (list, True), "heading": (str, False)},
    "quote": {"text": (str, True), "attribution": (str, False)},
    "stat": {"value": (str, True), "label": (str, True)},
    "code": {"code": (str, True), "language": (str, False), "heading": (str, False)},
    "image": {"src": (str, True), "caption": (str, False), "fit": (str, False)},
    "reddit": {"subreddit": (str, True), "author": (str, True), "title": (str, True),
               "body": (str, False), "upvotes": (str, False), "comments": (str, False)},
    "outro": {"title": (str, True), "cta": (str, False)},
}
FORMATS = ("landscape", "vertical", "both")
COMPOSITIONS = {"landscape": ("Landscape", 1920, 1080), "vertical": ("Vertical", 1080, 1920)}


def list_styles() -> list[str]:
    return sorted(p.stem for p in STYLES_DIR.glob("*.json") if not p.name.startswith("_"))


def _check(node: Any, schema: dict, path: str, errors: list[str]) -> None:
    """Minimal JSON-Schema walker covering the keywords styles/_schema.json uses."""
    if "enum" in schema:
        if node not in schema["enum"]:
            errors.append(f"{path}: {node!r} is not one of {schema['enum']}")
        return
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(node, dict):
            errors.append(f"{path}: expected an object")
            return
        props = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in node:
                errors.append(f"{path}.{key}: missing")
        for key, value in node.items():
            if key in props:
                _check(value, props[key], f"{path}.{key}", errors)
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}.{key}: unknown key")
    elif kind == "string":
        if not isinstance(node, str):
            errors.append(f"{path}: expected a string")
        elif "pattern" in schema and not re.search(schema["pattern"], node):
            errors.append(f"{path}: {node!r} does not match {schema['pattern']}")
        elif len(node) < schema.get("minLength", 0):
            errors.append(f"{path}: too short")
    elif kind == "boolean":
        if not isinstance(node, bool):
            errors.append(f"{path}: expected true/false")
    elif kind in ("number", "integer"):
        if isinstance(node, bool) or not isinstance(node, (int, float)):
            errors.append(f"{path}: expected a number")
        elif kind == "integer" and int(node) != node:
            errors.append(f"{path}: expected a whole number")
        elif "minimum" in schema and node < schema["minimum"]:
            errors.append(f"{path}: {node} is below the minimum {schema['minimum']}")
        elif "maximum" in schema and node > schema["maximum"]:
            errors.append(f"{path}: {node} is above the maximum {schema['maximum']}")
        elif "multipleOf" in schema and node % schema["multipleOf"] != 0:
            errors.append(f"{path}: {node} must be a multiple of {schema['multipleOf']}")


def _luminance(hex_color: str) -> float:
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast_ratio(a: str, b: str) -> float:
    la, lb = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def validate_style(theme: Any, expected_name: str | None = None) -> list[str]:
    errors: list[str] = []
    _check(theme, read_json(STYLES_DIR / "_schema.json"), "style", errors)
    if errors:
        return errors
    if expected_name and theme["name"] != expected_name:
        errors.append(f"style.name: '{theme['name']}' must match the file name '{expected_name}'")
    colors = theme["colors"]
    ratio = contrast_ratio(colors["text"], colors["background"])
    if ratio < 7:
        errors.append(f"style.colors: text on background contrast is {ratio:.1f}:1 (needs >= 7:1 to stay legible after video compression)")
    ratio = contrast_ratio(colors["accent"], colors["background"])
    if ratio < 3:
        errors.append(f"style.colors: accent on background contrast is {ratio:.1f}:1 (needs >= 3:1)")
    if theme["pacing"]["minSceneSeconds"] > theme["pacing"]["maxSceneSeconds"]:
        errors.append("style.pacing: minSceneSeconds is greater than maxSceneSeconds")
    return errors


def load_style(name: str) -> dict:
    path = STYLES_DIR / f"{name}.json"
    if not path.exists():
        die(f"Unknown style '{name}'. Available: {', '.join(list_styles())}")
    theme = read_json(path)
    errors = validate_style(theme, name)
    if errors:
        die(f"Style '{name}' is invalid:\n  - " + "\n  - ".join(errors))
    return theme


def validate_manifest(manifest: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(manifest, dict):
        return ["manifest: expected a JSON object"]
    for key, kind in (("id", str), ("title", str), ("style", str), ("scenes", list)):
        if not isinstance(manifest.get(key), kind):
            errors.append(f"manifest.{key}: missing or not a {kind.__name__}")
    if manifest.get("format", "both") not in FORMATS:
        errors.append(f"manifest.format: must be one of {FORMATS}")
    fps = manifest.get("fps", 30)
    if not isinstance(fps, int) or not 12 <= fps <= 60:
        errors.append("manifest.fps: must be a whole number between 12 and 60")
    scenes = manifest.get("scenes")
    if isinstance(scenes, list):
        if not scenes:
            errors.append("manifest.scenes: needs at least one scene")
        seen: set[str] = set()
        for i, scene in enumerate(scenes):
            where = f"manifest.scenes[{i}]"
            if not isinstance(scene, dict):
                errors.append(f"{where}: expected an object")
                continue
            scene_id = scene.get("id")
            if not isinstance(scene_id, str) or not scene_id:
                errors.append(f"{where}.id: missing")
            elif scene_id in seen:
                errors.append(f"{where}.id: duplicate id '{scene_id}'")
            else:
                seen.add(scene_id)
            duration = scene.get("durationInSeconds")
            if isinstance(duration, bool) or not isinstance(duration, (int, float)) or duration <= 0:
                errors.append(f"{where}.durationInSeconds: must be a positive number")
            fields = SCENE_FIELDS.get(scene.get("type"))  # type: ignore[arg-type]
            if fields is None:
                errors.append(f"{where}.type: '{scene.get('type')}' is not one of {sorted(SCENE_FIELDS)}")
                continue
            for name, (kind, required) in fields.items():
                value = scene.get(name)
                if value is None:
                    if required:
                        errors.append(f"{where}.{name}: required for a '{scene['type']}' scene")
                elif not isinstance(value, kind):
                    errors.append(f"{where}.{name}: expected {kind.__name__}")
                elif kind is list and (not value or not all(isinstance(v, str) for v in value)):
                    errors.append(f"{where}.{name}: expected a non-empty list of strings")
    captions = manifest.get("captions")
    if captions is not None:
        ok = isinstance(captions, list) and all(
            isinstance(w, dict) and isinstance(w.get("text"), str)
            and isinstance(w.get("start"), (int, float)) and isinstance(w.get("end"), (int, float))
            for w in captions
        )
        if not ok:
            errors.append("manifest.captions: expected a list of {text, start, end}")
    return errors


def manifest_duration(manifest: dict, theme: dict) -> float:
    """Final video length in seconds — mirrors studio/src/lib/timing.ts."""
    fps = manifest.get("fps", 30)
    frames = [max(1, round(s["durationInSeconds"] * fps)) for s in manifest["scenes"]]
    overlap = 0
    if theme["motion"]["transition"] != "cut" and len(frames) > 1:
        overlap = max(0, min(int(theme["motion"]["transitionFrames"]), min(frames) // 2 - 1))
    return max(1, sum(frames) - overlap * (len(frames) - 1)) / fps


def resolve_manifest_path(value: str) -> Path:
    """Accept a path, a file name inside studio/manifests, or a bare manifest id."""
    from common import MANIFEST_DIR

    candidates = [Path(value).expanduser(), MANIFEST_DIR / value, MANIFEST_DIR / f"{value}.json"]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    die(f"Manifest not found: {value} (looked in the given path and {MANIFEST_DIR})")
