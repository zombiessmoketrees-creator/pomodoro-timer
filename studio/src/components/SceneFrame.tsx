import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import type { Theme } from "../types";

/** Shared scene shell: safe-area padding, alignment, and an optional section heading. */
export const SceneFrame: React.FC<{
  theme: Theme;
  heading?: string;
  center?: boolean;
  children: React.ReactNode;
}> = ({ theme, heading, center, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const l = useLayout(theme);
  const centered = center ?? theme.typography.align === "center";
  const enter = spring({ frame, fps, config: theme.motion.spring });

  return (
    <AbsoluteFill
      style={{
        paddingLeft: l.padding,
        paddingRight: l.padding,
        paddingTop: l.safeTop,
        paddingBottom: l.safeBottom,
        justifyContent: "center",
        alignItems: centered ? "center" : "flex-start",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: l.maxWidth,
          display: "flex",
          flexDirection: "column",
          alignItems: centered ? "center" : "flex-start",
          gap: 36 * l.u,
        }}
      >
        {heading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18 * l.u,
              opacity: enter,
              transform: `translateX(${interpolate(enter, [0, 1], [-24 * l.u, 0])}px)`,
            }}
          >
            {theme.layout.accentBar ? (
              <div style={{ width: 10 * l.u, height: l.bodySize * 0.95, background: theme.colors.accent, borderRadius: 4 * l.u }} />
            ) : null}
            <div
              style={{
                fontFamily: fontStack(theme.fonts.heading.family),
                fontWeight: theme.fonts.heading.weight,
                fontSize: l.bodySize * 0.72,
                color: theme.colors.accent,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
              }}
            >
              {heading}
            </div>
          </div>
        ) : null}
        {children}
      </div>
    </AbsoluteFill>
  );
};
