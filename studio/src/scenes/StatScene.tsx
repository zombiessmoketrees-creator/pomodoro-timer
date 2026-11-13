import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { SceneFrame } from "../components/SceneFrame";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import type { StatSceneData, Theme } from "../types";

/** Splits "$4.2B" into prefix "$", number 4.2 and suffix "B" so the number can count up. */
const parseValue = (value: string) => {
  const match = value.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!match) {
    return null;
  }
  const raw = match[2].replace(/,/g, "");
  return {
    prefix: match[1],
    number: Number(raw),
    decimals: raw.includes(".") ? raw.split(".")[1].length : 0,
    grouped: match[2].includes(","),
    suffix: match[3],
  };
};

export const StatScene: React.FC<{ scene: StatSceneData; theme: Theme }> = ({ scene, theme }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const l = useLayout(theme);
  const parsed = parseValue(scene.value);
  const countFrames = Math.min(fps * 1.4, durationInFrames * 0.5);
  const progress = interpolate(frame, [4, 4 + countFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  let display = scene.value;
  if (parsed && Number.isFinite(parsed.number)) {
    const current = (parsed.number * progress).toFixed(parsed.decimals);
    const formatted = parsed.grouped
      ? Number(current).toLocaleString("en-US", { minimumFractionDigits: parsed.decimals })
      : current;
    display = `${parsed.prefix}${formatted}${parsed.suffix}`;
  }
  const labelIn = interpolate(frame, [countFrames * 0.6, countFrames * 0.6 + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <SceneFrame theme={theme} center>
      <div
        style={{
          fontFamily: fontStack(theme.fonts.heading.family),
          fontWeight: theme.fonts.heading.weight,
          fontSize: l.headingSize * (scene.value.length > 7 ? 1.5 : 2.2),
          lineHeight: 1,
          color: theme.colors.accent,
          fontVariantNumeric: "tabular-nums",
          opacity: interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        {display}
      </div>
      <div
        style={{
          fontFamily: fontStack(theme.fonts.body.family),
          fontWeight: theme.fonts.body.weight,
          fontSize: l.bodySize,
          lineHeight: 1.3,
          color: theme.colors.text,
          textAlign: "center",
          opacity: labelIn,
          transform: `translateY(${interpolate(labelIn, [0, 1], [16 * l.u, 0])}px)`,
        }}
      >
        {scene.label}
      </div>
    </SceneFrame>
  );
};
