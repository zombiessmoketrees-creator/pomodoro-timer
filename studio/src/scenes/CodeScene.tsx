import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { SceneFrame } from "../components/SceneFrame";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import type { CodeSceneData, Theme } from "../types";

const KEYWORDS =
  /^(const|let|var|function|return|if|else|for|while|import|from|export|default|class|new|async|await|def|in|not|and|or|try|except|catch|finally|with|as|type|interface|extends|public|private|static|void|fn|pub|use|struct|impl|match|package|func|go|defer|True|False|None|true|false|null|undefined|this|self)$/;

type Part = { text: string; kind: "plain" | "comment" | "string" | "keyword" | "number" };

/** Small regex highlighter — enough to make short snippets readable without a parser. */
const highlight = (line: string): Part[] => {
  const parts: Part[] = [];
  const re = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.]*\b)|([A-Za-z_]\w*)|(\s+|.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[1]) {
      parts.push({ text: m[1], kind: "comment" });
    } else if (m[2]) {
      parts.push({ text: m[2], kind: "string" });
    } else if (m[3]) {
      parts.push({ text: m[3], kind: "number" });
    } else if (m[4]) {
      parts.push({ text: m[4], kind: KEYWORDS.test(m[4]) ? "keyword" : "plain" });
    } else {
      parts.push({ text: m[5], kind: "plain" });
    }
  }
  return parts;
};

export const CodeScene: React.FC<{ scene: CodeSceneData; theme: Theme }> = ({ scene, theme }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const l = useLayout(theme);
  const lines = scene.code.replace(/\t/g, "  ").split("\n");
  const longest = Math.max(...lines.map((line) => line.length), 1);
  const total = lines.reduce((n, line) => n + line.length + 1, 0);
  const visible = interpolate(frame, [8, 8 + durationInFrames * 0.55], [0, total], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Fit the longest line into the card: monospace glyphs are ~0.6em wide.
  const fontSize = Math.min(l.bodySize * 0.7, (l.maxWidth - 96 * l.u) / (longest * 0.61));
  const colorFor: Record<Part["kind"], string> = {
    plain: theme.colors.text,
    comment: theme.colors.muted,
    string: theme.colors.accentAlt,
    keyword: theme.colors.accent,
    number: theme.colors.accentAlt,
  };

  let consumed = 0;
  return (
    <SceneFrame theme={theme} heading={scene.heading} center>
      <div
        style={{
          width: "100%",
          background: theme.colors.surface,
          borderRadius: theme.layout.cornerRadius * l.u,
          border: `${Math.max(1, 2 * l.u)}px solid ${theme.colors.muted}33`,
          boxShadow: `0 ${30 * l.u}px ${80 * l.u}px rgba(0,0,0,0.45)`,
          overflow: "hidden",
          opacity: interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" }),
          transform: `translateY(${interpolate(frame, [0, 12], [24 * l.u, 0], { extrapolateRight: "clamp" })}px)`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12 * l.u,
            padding: `${20 * l.u}px ${28 * l.u}px`,
            borderBottom: `${Math.max(1, 2 * l.u)}px solid ${theme.colors.muted}22`,
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 18 * l.u, height: 18 * l.u, borderRadius: "50%", background: c }} />
          ))}
          <div
            style={{
              marginLeft: "auto",
              fontFamily: fontStack(theme.fonts.mono.family),
              fontSize: 22 * l.u,
              color: theme.colors.muted,
            }}
          >
            {scene.language ?? ""}
          </div>
        </div>
        <pre
          style={{
            margin: 0,
            padding: `${32 * l.u}px ${40 * l.u}px`,
            fontFamily: fontStack(theme.fonts.mono.family),
            fontWeight: theme.fonts.mono.weight,
            fontSize,
            lineHeight: 1.55,
            textAlign: "left",
          }}
        >
          {lines.map((line, i) => {
            const start = consumed;
            consumed += line.length + 1;
            let remaining = Math.max(0, Math.floor(visible) - start);
            return (
              <div key={i} style={{ minHeight: fontSize * 1.55 }}>
                {highlight(line).map((part, j) => {
                  const shown = part.text.slice(0, remaining);
                  remaining = Math.max(0, remaining - part.text.length);
                  return (
                    <span key={j} style={{ color: colorFor[part.kind] }}>
                      {shown}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </pre>
      </div>
    </SceneFrame>
  );
};
