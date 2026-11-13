import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { SceneFrame } from "../components/SceneFrame";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import type { QuoteSceneData, Theme } from "../types";

export const QuoteScene: React.FC<{ scene: QuoteSceneData; theme: Theme }> = ({ scene, theme }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const l = useLayout(theme);
  const mark = spring({ frame, fps, config: { damping: 14 } });
  const attributionAt = Math.min(durationInFrames * 0.5, fps * 2);
  const attribution = interpolate(frame, [attributionAt, attributionAt + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <SceneFrame theme={theme}>
      <div
        style={{
          fontFamily: fontStack("Playfair Display"),
          fontWeight: 900,
          fontSize: l.headingSize * 1.8,
          lineHeight: 0.6,
          height: l.headingSize * 0.7,
          color: theme.colors.accent,
          transform: `scale(${mark})`,
          transformOrigin: theme.typography.align === "center" ? "center" : "left center",
        }}
      >
        “
      </div>
      <AnimatedText
        text={scene.text}
        theme={theme}
        mode={theme.motion.enter === "kinetic" ? "fade" : theme.motion.enter}
        fontSize={l.bodySize * 1.15}
        fontFamily={fontStack(theme.fonts.heading.family)}
        fontWeight={Math.min(theme.fonts.heading.weight, 700)}
        lineHeight={1.3}
        delay={6}
      />
      {scene.attribution ? (
        <div
          style={{
            fontFamily: fontStack(theme.fonts.body.family),
            fontWeight: 500,
            fontSize: l.bodySize * 0.68,
            color: theme.colors.muted,
            opacity: attribution,
          }}
        >
          — {scene.attribution}
        </div>
      ) : null}
    </SceneFrame>
  );
};
