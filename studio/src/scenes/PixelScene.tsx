import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Scanlines } from "../components/Background";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import type { PixelSceneData, Theme } from "../types";
import { ART, LABELS, type ArtContext, type Px } from "./pixel/art";

/** Seconds kept free at the end of a scene so the finished line can be read (and the voice can land). */
const TAIL_SECONDS = 1.6;

/** Merges thousands of rectangles into one SVG path per colour so each frame stays cheap to paint. */
const toPaths = (pixels: Px[]) => {
  // Only consecutive rectangles of the same colour are merged, which preserves paint order.
  const groups: Array<{ c: string; o: number; d: string[] }> = [];
  for (const p of pixels) {
    const o = p.o ?? 1;
    const last = groups[groups.length - 1];
    const d = `M${p.x} ${p.y}h${p.w}v${p.h}h${-p.w}z`;
    if (last && last.c === p.c && last.o === o) {
      last.d.push(d);
    } else {
      groups.push({ c: p.c, o, d: [d] });
    }
  }
  return groups;
};

/**
 * 16-bit story scene: full-bleed code-drawn pixel art with an RPG-style dialog
 * box. The text types out over the scene's length, which engine/narrate.py sets
 * to the length of the spoken line — so the typing roughly tracks the voice.
 */
export const PixelScene: React.FC<{ scene: PixelSceneData; theme: Theme }> = ({ scene, theme }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const l = useLayout(theme);

  // Logical canvas: 6 real pixels per art pixel at 1080p.
  const W = l.vertical ? 180 : 320;
  const H = l.vertical ? 320 : 180;
  const tick = Math.floor(frame / (fps / 12));
  const ctx: ArtContext = { W, H, g: Math.round(H * (l.vertical ? 0.5 : 0.55)), tick };

  const draw = ART[scene.art];
  if (!draw) {
    throw new Error(`Unknown pixel art "${scene.art}". Available: ${Object.keys(ART).join(", ")}`);
  }
  // Art only changes on a tick, so skip recomputing it on the frames in between.
  const paths = useMemo(() => toPaths(draw(ctx)), [draw, W, H, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const labels = LABELS[scene.art]?.(ctx) ?? [];

  const typeFrames = Math.max(1, durationInFrames - Math.round(TAIL_SECONDS * fps) - 6);
  const shown = Math.min(scene.text.length, Math.floor((Math.max(0, frame - 6) / typeFrames) * scene.text.length));
  const done = shown >= scene.text.length;

  const px = width / W; // one art pixel in real pixels
  const b = Math.round(px); // border step
  const boxTop = l.vertical ? height * 0.615 : height * 0.69;
  const boxSide = l.vertical ? px * 8 : px * 22;
  const fontSize = (l.vertical ? 74 : 60) * l.u;
  const corner: React.CSSProperties = { position: "absolute", width: b * 3, height: b * 3, background: theme.colors.accent };

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={width}
        height={height}
        shapeRendering="crispEdges"
        style={{ position: "absolute", inset: 0 }}
      >
        {paths.map((p, i) => (
          <path key={i} d={p.d.join("")} fill={p.c} opacity={p.o} />
        ))}
        {labels.map((label, i) => (
          <text
            key={`t${i}`}
            x={label.x}
            y={label.y}
            fontSize={label.size}
            fill={label.c}
            textAnchor="middle"
            fontFamily={fontStack("Press Start 2P")}
          >
            {label.text}
          </text>
        ))}
      </svg>
      <Scanlines opacity={0.1} />
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,${theme.background.vignette}) 100%)` }}
      />

      <div
        style={{
          position: "absolute",
          left: boxSide,
          right: boxSide,
          top: boxTop,
          minHeight: l.vertical ? height * 0.215 : height * 0.25,
          boxSizing: "border-box",
          padding: `${px * 4}px ${px * 5}px`,
          background: `linear-gradient(180deg, ${theme.colors.surface} 0%, ${theme.colors.backgroundAlt} 100%)`,
          // Stacked hard-edged shadows build a chunky three-colour console border.
          boxShadow: `0 0 0 ${b}px ${theme.colors.text}, 0 0 0 ${b * 2}px #ff3fa4, 0 0 0 ${b * 3}px ${theme.colors.background}, 0 0 0 ${b * 4}px #59e0ff, ${b * 5}px ${b * 6}px 0 ${b}px rgba(0,0,0,0.55)`,
          fontFamily: fontStack(theme.fonts.body.family),
          fontSize,
          lineHeight: 1.08,
          color: theme.colors.text,
          textShadow: `${Math.max(2, b / 2)}px ${Math.max(2, b / 2)}px 0 #1a0b3f`,
          textAlign: "left",
        }}
      >
        <div style={{ ...corner, left: -b * 5, top: -b * 5 }} />
        <div style={{ ...corner, right: -b * 5, top: -b * 5 }} />
        <div style={{ ...corner, left: -b * 5, bottom: -b * 5 }} />
        <div style={{ ...corner, right: -b * 5, bottom: -b * 5 }} />
        <span>{scene.text.slice(0, shown)}</span>
        {/* The untyped remainder stays in the layout (invisible) so lines never re-wrap mid-word. */}
        <span style={{ opacity: 0 }}>{scene.text.slice(shown)}</span>
        {done ? (
          <span
            style={{
              position: "absolute",
              right: px * 4,
              bottom: px * 2,
              fontSize: fontSize * 0.6,
              color: theme.colors.accent,
              opacity: Math.floor(frame / (fps / 3)) % 2 === 0 ? 1 : 0,
            }}
          >
            ▼
          </span>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
