import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { SceneFrame } from "../components/SceneFrame";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import type { Theme, TitleSceneData } from "../types";

export const TitleScene: React.FC<{ scene: TitleSceneData; theme: Theme }> = ({ scene, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const l = useLayout(theme);
  const bar = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const subtitleIn = interpolate(frame, [18, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const centered = theme.typography.align === "center";
  // Kinetic is for body copy; a title should land as one composed block.
  const mode = theme.motion.enter === "kinetic" ? "slide-up" : theme.motion.enter;

  return (
    <SceneFrame theme={theme}>
      {scene.kicker ? (
        <div
          style={{
            fontFamily: fontStack(theme.fonts.body.family),
            fontWeight: 600,
            fontSize: l.bodySize * 0.6,
            color: theme.colors.accent,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            opacity: interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          {scene.kicker}
        </div>
      ) : null}
      <AnimatedText
        text={scene.title}
        theme={theme}
        mode={mode}
        fontSize={l.headingSize}
        fontFamily={fontStack(theme.fonts.heading.family)}
        fontWeight={theme.fonts.heading.weight}
        uppercase={theme.typography.uppercaseHeadings}
        lineHeight={1.06}
      />
      {theme.layout.accentBar ? (
        <div
          style={{
            height: 8 * l.u,
            width: 180 * l.u * bar,
            background: theme.colors.accent,
            borderRadius: 4 * l.u,
            alignSelf: centered ? "center" : "flex-start",
          }}
        />
      ) : null}
      {scene.subtitle ? (
        <div
          style={{
            fontFamily: fontStack(theme.fonts.body.family),
            fontWeight: theme.fonts.body.weight,
            fontSize: l.bodySize * 0.82,
            lineHeight: theme.typography.lineHeight,
            color: theme.colors.muted,
            textAlign: theme.typography.align,
            opacity: subtitleIn,
            transform: `translateY(${interpolate(subtitleIn, [0, 1], [14 * l.u, 0])}px)`,
          }}
        >
          {scene.subtitle}
        </div>
      ) : null}
    </SceneFrame>
  );
};
