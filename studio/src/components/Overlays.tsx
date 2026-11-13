import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import type { CaptionWord, Theme } from "../types";

export const ProgressBar: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const l = useLayout(theme);
  const progress = Math.min(1, (frame + 1) / durationInFrames);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end" }}>
      <div style={{ height: 8 * l.u, width: "100%", background: `${theme.colors.muted}33` }}>
        <div style={{ height: "100%", width: `${progress * 100}%`, background: theme.colors.accent }} />
      </div>
    </AbsoluteFill>
  );
};

export const Handle: React.FC<{ theme: Theme; handle: string }> = ({ theme, handle }) => {
  const l = useLayout(theme);
  return (
    <div
      style={{
        position: "absolute",
        top: l.vertical ? l.safeTop * 0.55 : l.padding * 0.5,
        right: l.padding,
        fontFamily: fontStack(theme.fonts.body.family),
        fontWeight: 600,
        fontSize: 26 * l.u,
        color: theme.colors.muted,
        letterSpacing: "0.04em",
      }}
    >
      {handle}
    </div>
  );
};

/** Word-synced captions: shows a few words at a time and highlights the spoken one. */
export const Captions: React.FC<{ theme: Theme; words: CaptionWord[] }> = ({ theme, words }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const l = useLayout(theme);
  const t = frame / fps;
  const c = theme.captions;

  const groups: CaptionWord[][] = [];
  for (const word of words) {
    const last = groups[groups.length - 1];
    const gap = last ? word.start - last[last.length - 1].end : 0;
    if (!last || last.length >= c.wordsPerGroup || gap > 0.6) {
      groups.push([word]);
    } else {
      last.push(word);
    }
  }
  const group = groups.find((g) => t >= g[0].start && t <= g[g.length - 1].end + 0.2);
  if (!group) {
    return null;
  }

  const sinceStart = (t - group[0].start) * fps;
  const pop = interpolate(sinceStart, [0, 4], [0.85, 1], { extrapolateRight: "clamp" });
  const top = c.position === "top" ? height * 0.14 : c.position === "middle" ? height * 0.46 : height * 0.72;
  const stroke = Math.max(2, c.fontSize * l.u * 0.09);

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: l.padding,
        right: l.padding,
        textAlign: "center",
        fontFamily: fontStack(c.fontFamily),
        fontWeight: 800,
        fontSize: c.fontSize * l.u,
        lineHeight: 1.1,
        textTransform: c.uppercase ? "uppercase" : "none",
        transform: `scale(${pop})`,
        WebkitTextStroke: `${stroke}px ${c.outline}`,
        paintOrder: "stroke fill",
      }}
    >
      {group.map((w, i) => {
        const active = t >= w.start && t < (group[i + 1]?.start ?? w.end + 0.2);
        return (
          <span
            key={`${w.start}-${i}`}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              color: active ? c.highlight : c.color,
              transform: `scale(${active ? 1.1 : 1})`,
            }}
          >
            {w.text}
            {i < group.length - 1 ? " " : ""}
          </span>
        );
      })}
    </div>
  );
};
