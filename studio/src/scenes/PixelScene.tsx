import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Scanlines } from "../components/Background";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import type { PixelSceneData, Theme } from "../types";
import { ART, LABELS, type ArtContext } from "./pixel/art";

/** Seconds kept free at the end of a scene so the finished line can be read (and the voice can land). */
const TAIL_SECONDS = 1.6;

/**
 * 16-bit story scene: full-bleed code-drawn pixel art with an RPG-style dialog
 * box. The text types out over the scene's length, which engine/narrate.py sets
 * to the length of the spoken line — so the typing roughly tracks the voice.
 */
export const PixelScene: React.FC<{ scene: PixelSceneData; theme: Theme }> = ({ scene, theme }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const l = useLayout(theme);

  // Logical canvas: 10 real pixels per art pixel at 1080p.
  const W = l.vertical ? 108 : 192;
  const H = l.vertical ? 192 : 108;
  const tick = Math.floor(frame / (fps / 12));
  const ctx: ArtContext = { W, H, g: Math.round(H * (l.vertical ? 0.5 : 0.55)), tick };

  const draw = ART[scene.art];
  if (!draw) {
    throw new Error(`Unknown pixel art "${scene.art}". Available: ${Object.keys(ART).join(", ")}`);
  }
  // Art only changes on a tick, so skip recomputing it on the frames in between.
  const pixels = useMemo(() => draw(ctx), [draw, W, H, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const labels = LABELS[scene.art]?.(ctx) ?? [];

  const typeFrames = Math.max(1, durationInFrames - Math.round(TAIL_SECONDS * fps) - 6);
  const shown = Math.min(scene.text.length, Math.floor((Math.max(0, frame - 6) / typeFrames) * scene.text.length));
  const done = shown >= scene.text.length;

  const px = width / W; // one art pixel in real pixels
  const border = Math.round(px * 0.6);
  const boxTop = l.vertical ? height * 0.615 : height * 0.69;
  const boxSide = l.vertical ? px * 5 : px * 14;
  const fontSize = (l.vertical ? 74 : 60) * l.u;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={width}
        height={height}
        shapeRendering="crispEdges"
        style={{ position: "absolute", inset: 0 }}
      >
        {pixels.map((p, i) => (
          <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.c} opacity={p.o} />
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
      <Scanlines opacity={0.16} />
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,${theme.background.vignette}) 100%)` }}
      />

      <div
        style={{
          position: "absolute",
          left: boxSide,
          right: boxSide,
          top: boxTop,
          minHeight: l.vertical ? height * 0.215 : height * 0.25,
          boxSizing: "border-box",
          padding: `${px * 2.2}px ${px * 3}px`,
          background: theme.colors.surface,
          // Stacked hard-edged shadows make the chunky double border of a 16-bit text box.
          boxShadow: `0 0 0 ${border}px ${theme.colors.text}, 0 0 0 ${border * 2}px ${theme.colors.background}, 0 0 0 ${border * 3}px ${theme.colors.muted}`,
          fontFamily: fontStack(theme.fonts.body.family),
          fontSize,
          lineHeight: 1.08,
          color: theme.colors.text,
          textAlign: "left",
        }}
      >
        <span>{scene.text.slice(0, shown)}</span>
        {/* The untyped remainder stays in the layout (invisible) so lines never re-wrap mid-word. */}
        <span style={{ opacity: 0 }}>{scene.text.slice(shown)}</span>
        {done ? (
          <span
            style={{
              position: "absolute",
              right: px * 2.5,
              bottom: px * 1.2,
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
