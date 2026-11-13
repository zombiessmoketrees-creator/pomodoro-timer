import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SceneFrame } from "../components/SceneFrame";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import { stripEmphasis } from "../lib/text";
import type { RedditSceneData, Theme } from "../types";

/** A generic forum-post card (original design — not a pixel copy of any site's UI). */
export const RedditScene: React.FC<{ scene: RedditSceneData; theme: Theme }> = ({ scene, theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const l = useLayout(theme);
  const pop = spring({ frame, fps, config: theme.motion.spring });
  const body = scene.body ? stripEmphasis(scene.body) : "";
  const font = fontStack(theme.fonts.body.family);
  const meta = l.bodySize * 0.5;

  return (
    <SceneFrame theme={theme} center>
      <div
        style={{
          width: "100%",
          background: theme.colors.surface,
          borderRadius: theme.layout.cornerRadius * l.u,
          padding: 44 * l.u,
          boxShadow: `0 ${24 * l.u}px ${70 * l.u}px rgba(0,0,0,0.4)`,
          transform: `scale(${interpolate(pop, [0, 1], [0.86, 1])})`,
          opacity: interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" }),
          display: "flex",
          flexDirection: "column",
          gap: 26 * l.u,
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 * l.u }}>
          <div
            style={{
              width: meta * 2.1,
              height: meta * 2.1,
              borderRadius: "50%",
              background: theme.colors.accent,
              color: theme.colors.surface,
              fontFamily: font,
              fontWeight: 800,
              fontSize: meta * 1.1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {scene.subreddit.replace(/^r\//, "").charAt(0).toUpperCase()}
          </div>
          <div style={{ fontFamily: font, lineHeight: 1.25 }}>
            <div style={{ fontWeight: 700, fontSize: meta * 1.05, color: theme.colors.text }}>{scene.subreddit}</div>
            <div style={{ fontWeight: 400, fontSize: meta * 0.9, color: theme.colors.muted }}>{scene.author}</div>
          </div>
        </div>
        <div
          style={{
            fontFamily: fontStack(theme.fonts.heading.family),
            fontWeight: theme.fonts.heading.weight,
            fontSize: l.bodySize * 0.98,
            lineHeight: 1.22,
            color: theme.colors.text,
          }}
        >
          {stripEmphasis(scene.title)}
        </div>
        {body ? (
          <div style={{ fontFamily: font, fontWeight: 400, fontSize: l.bodySize * 0.66, lineHeight: 1.4, color: theme.colors.muted }}>
            {body}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 22 * l.u, fontFamily: font, fontWeight: 700, fontSize: meta, color: theme.colors.muted }}>
          <div
            style={{
              padding: `${10 * l.u}px ${22 * l.u}px`,
              borderRadius: 999,
              background: `${theme.colors.muted}22`,
              color: theme.colors.accent,
            }}
          >
            ▲ {scene.upvotes ?? "1.2k"}
          </div>
          <div style={{ padding: `${10 * l.u}px ${22 * l.u}px`, borderRadius: 999, background: `${theme.colors.muted}22` }}>
            💬 {scene.comments ?? "348"}
          </div>
        </div>
      </div>
    </SceneFrame>
  );
};
