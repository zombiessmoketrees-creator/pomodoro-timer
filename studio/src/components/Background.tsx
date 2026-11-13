import React from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../types";

const GRAIN_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  );

const Particles: React.FC<{ color: string; seed: string }> = ({ color, seed }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill>
      {Array.from({ length: 42 }, (_, i) => {
        const size = 3 + random(`${seed}-s-${i}`) * 9;
        const speed = 0.012 + random(`${seed}-v-${i}`) * 0.03;
        const x = random(`${seed}-x-${i}`) * width + Math.sin(t * 0.4 + i) * 24;
        // Drift upward and wrap around.
        const y = ((random(`${seed}-y-${i}`) - t * speed + 10) % 1) * (height + 40) - 20;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: "50%",
              background: color,
              opacity: 0.12 + random(`${seed}-o-${i}`) * 0.3,
              filter: `blur(${size > 8 ? 2 : 0}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Grid: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const cell = Math.min(width, height) / 12;
  const offset = (frame * 0.35) % cell;
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
        backgroundSize: `${cell}px ${cell}px`,
        backgroundPosition: `${offset}px ${offset}px`,
        opacity: 0.11,
        maskImage: "radial-gradient(ellipse at center, black 30%, transparent 85%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 85%)",
      }}
    />
  );
};

/** CRT scanlines. Exported so pixel scenes can lay the same texture over their art. */
export const Scanlines: React.FC<{ opacity?: number }> = ({ opacity = 0.22 }) => {
  const { height } = useVideoConfig();
  const line = Math.max(2, Math.round(height / 270));
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `linear-gradient(rgba(0,0,0,${opacity}) 50%, transparent 50%)`,
        backgroundSize: `100% ${line * 2}px`,
        pointerEvents: "none",
      }}
    />
  );
};

const PixelStars: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const px = Math.round(Math.min(width, height) / 108);
  const tick = Math.floor(frame / (fps / 12));
  return (
    <AbsoluteFill>
      {Array.from({ length: 70 }, (_, i) => {
        const dim = (tick + Math.floor(random(`ps-t-${i}`) * 24)) % 24 < 3;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: Math.floor((random(`ps-x-${i}`) * width) / px) * px,
              top: Math.floor((random(`ps-y-${i}`) * height) / px) * px,
              width: px,
              height: px,
              background: i % 9 === 0 ? color : "#ffffff",
              opacity: dim ? 0.25 : 0.85,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export const Background: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { colors, background } = theme;
  const angle = background.angle + Math.sin(frame / 180) * 12;

  const base =
    background.type === "solid"
      ? colors.background
      : `linear-gradient(${angle}deg, ${colors.background} 0%, ${colors.backgroundAlt} 100%)`;

  return (
    <AbsoluteFill style={{ background: base }}>
      {background.type === "gradient" ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at ${50 + Math.sin(frame / 140) * 22}% ${38 + Math.cos(frame / 170) * 14}%, ${colors.accent}26 0%, transparent 55%)`,
          }}
        />
      ) : null}
      {background.type === "grid" ? <Grid color={colors.accent} /> : null}
      {background.type === "scanlines" ? <PixelStars color={colors.accent} /> : null}
      {background.type === "scanlines" ? <Scanlines /> : null}
      {background.type === "particles" ? <Particles color={colors.accent} seed={theme.name} /> : null}
      {background.vignette > 0 ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${background.vignette}) 100%)`,
          }}
        />
      ) : null}
      {background.grain > 0 ? (
        <AbsoluteFill
          style={{
            backgroundImage: `url("${GRAIN_SVG}")`,
            // Shift the tile every other frame so the grain shimmers like film.
            backgroundPosition: `${(Math.floor(frame / 2) * 37) % 300}px ${(Math.floor(frame / 2) * 91) % 300}px`,
            opacity: background.grain,
            mixBlendMode: "overlay",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
