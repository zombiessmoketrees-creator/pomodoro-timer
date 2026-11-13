import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import type { ImageSceneData, Theme } from "../types";

export const resolveAsset = (src: string): string => (/^(https?:|data:|\/)/.test(src) ? src : staticFile(src));

export const ImageScene: React.FC<{ scene: ImageSceneData; theme: Theme }> = ({ scene, theme }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const l = useLayout(theme);
  // Slow push-in (Ken Burns) keeps a still image alive.
  const scale = interpolate(frame, [0, durationInFrames], [1.02, 1.12]);
  const captionIn = interpolate(frame, [10, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <Img
          src={resolveAsset(scene.src)}
          style={{ width: "100%", height: "100%", objectFit: scene.fit ?? "cover" }}
        />
      </AbsoluteFill>
      {scene.caption ? (
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, transparent 45%)",
            paddingLeft: l.padding,
            paddingRight: l.padding,
            paddingBottom: l.safeBottom,
          }}
        >
          <div
            style={{
              fontFamily: fontStack(theme.fonts.body.family),
              fontWeight: 600,
              fontSize: l.bodySize * 0.8,
              lineHeight: 1.3,
              color: "#ffffff",
              opacity: captionIn,
              transform: `translateY(${interpolate(captionIn, [0, 1], [18 * l.u, 0])}px)`,
            }}
          >
            {scene.caption}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
