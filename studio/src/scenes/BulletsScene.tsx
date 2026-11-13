import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SceneFrame } from "../components/SceneFrame";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import { tokenize } from "../lib/text";
import type { BulletsSceneData, Theme } from "../types";

export const BulletsScene: React.FC<{ scene: BulletsSceneData; theme: Theme }> = ({ scene, theme }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const l = useLayout(theme);
  // Spread the reveals over the first 60% of the scene, one beat per item.
  const step = Math.min(fps * 1.2, (durationInFrames * 0.6) / scene.items.length);
  const size = l.bodySize * (scene.items.length > 4 ? 0.82 : 0.95);

  return (
    <SceneFrame theme={theme} heading={scene.heading} center={false}>
      <div style={{ display: "flex", flexDirection: "column", gap: size * 0.62, width: "100%" }}>
        {scene.items.map((item, i) => {
          const local = frame - 8 - i * step;
          const s = spring({ frame: local, fps, config: theme.motion.spring });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: size * 0.5,
                opacity: interpolate(local, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                transform: `translateX(${interpolate(s, [0, 1], [-40 * l.u, 0])}px)`,
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: size * 1.05,
                  height: size * 1.05,
                  marginTop: size * 0.12,
                  borderRadius: theme.layout.cornerRadius * l.u * 0.5,
                  background: theme.colors.accent,
                  color: theme.colors.background,
                  fontFamily: fontStack(theme.fonts.heading.family),
                  fontWeight: theme.fonts.heading.weight,
                  fontSize: size * 0.6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i + 1}
              </div>
              <div
                style={{
                  fontFamily: fontStack(theme.fonts.body.family),
                  fontWeight: theme.fonts.body.weight,
                  fontSize: size,
                  lineHeight: 1.25,
                  color: theme.colors.text,
                }}
              >
                {tokenize(item).map((token, j, all) => (
                  <span key={j} style={{ color: token.emphasis ? theme.colors.accent : undefined }}>
                    {token.text}
                    {j < all.length - 1 ? " " : ""}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </SceneFrame>
  );
};
