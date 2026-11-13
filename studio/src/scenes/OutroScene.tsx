import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { SceneFrame } from "../components/SceneFrame";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import type { OutroSceneData, Theme } from "../types";

export const OutroScene: React.FC<{ scene: OutroSceneData; theme: Theme }> = ({ scene, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const l = useLayout(theme);
  const cta = spring({ frame: frame - 16, fps, config: theme.motion.spring });
  // Gentle pulse draws the eye to the call to action.
  const pulse = 1 + Math.sin(frame / 7) * 0.02;

  return (
    <SceneFrame theme={theme} center>
      <AnimatedText
        text={scene.title}
        theme={theme}
        mode={theme.motion.enter === "kinetic" ? "slide-up" : theme.motion.enter}
        fontSize={l.headingSize * 0.8}
        fontFamily={fontStack(theme.fonts.heading.family)}
        fontWeight={theme.fonts.heading.weight}
        uppercase={theme.typography.uppercaseHeadings}
        align="center"
        lineHeight={1.1}
      />
      {scene.cta ? (
        <div
          style={{
            padding: `${22 * l.u}px ${48 * l.u}px`,
            borderRadius: theme.layout.cornerRadius * l.u,
            background: theme.colors.accent,
            color: theme.colors.background,
            fontFamily: fontStack(theme.fonts.body.family),
            fontWeight: 700,
            fontSize: l.bodySize * 0.72,
            opacity: interpolate(cta, [0, 1], [0, 1]),
            transform: `scale(${interpolate(cta, [0, 1], [0.8, 1]) * pulse})`,
          }}
        >
          {scene.cta}
        </div>
      ) : null}
    </SceneFrame>
  );
};
