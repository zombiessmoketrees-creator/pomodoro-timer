import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { chunkTokens, tokenize, type Token } from "../lib/text";
import type { EnterAnimation, Theme } from "../types";

type Props = {
  text: string;
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  color?: string;
  mode?: EnterAnimation;
  /** Frames to wait before the text starts animating in. */
  delay?: number;
  align?: "left" | "center";
  uppercase?: boolean;
  lineHeight?: number;
};

const wordStyle = (token: Token, theme: Theme, color: string): React.CSSProperties => ({
  display: "inline-block",
  whiteSpace: "pre",
  color: token.emphasis ? theme.colors.accent : color,
});

/** One short phrase at a time, large and centred — the kinetic-typography look. */
const Kinetic: React.FC<Props & { tokens: Token[] }> = (p) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const delay = p.delay ?? 0;
  const chunks = useMemo(() => chunkTokens(p.tokens, 3), [p.tokens]);

  // Give each chunk screen time proportional to its length, leaving a short tail.
  const usable = Math.max(1, durationInFrames - delay - Math.round(fps * 0.25));
  const weights = chunks.map((c) => c.reduce((n, t) => n + t.text.length, 0) + 4);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const starts = weights.map((w) => {
    const start = delay + (acc / total) * usable;
    acc += w;
    return start;
  });

  let index = 0;
  for (let i = 0; i < starts.length; i++) {
    if (frame >= starts[i]) {
      index = i;
    }
  }
  const local = frame - starts[index];
  const pop = spring({ frame: local, fps, config: p.theme.motion.spring, durationInFrames: 12 });
  const scale = interpolate(pop, [0, 1], [0.72, 1]);
  const color = p.color ?? p.theme.colors.text;

  return (
    <div
      style={{
        fontFamily: p.fontFamily,
        fontWeight: p.fontWeight,
        fontSize: p.fontSize * 1.9,
        lineHeight: 1.05,
        textAlign: "center",
        textTransform: p.uppercase ? "uppercase" : "none",
        letterSpacing: `${p.theme.typography.letterSpacing}em`,
        transform: `scale(${scale}) rotate(${index % 2 === 0 ? -1.2 : 1.2}deg)`,
        opacity: frame < delay ? 0 : interpolate(local, [0, 3], [0.2, 1], { extrapolateRight: "clamp" }),
        width: "100%",
      }}
    >
      {chunks[index].map((token, i) => (
        <span key={i} style={wordStyle(token, p.theme, color)}>
          {token.text}
          {i < chunks[index].length - 1 ? " " : ""}
        </span>
      ))}
    </div>
  );
};

export const AnimatedText: React.FC<Props> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { theme, text } = props;
  const mode = props.mode ?? theme.motion.enter;
  const delay = props.delay ?? 0;
  const color = props.color ?? theme.colors.text;
  const tokens = useMemo(() => tokenize(text), [text]);

  if (mode === "kinetic") {
    return <Kinetic {...props} tokens={tokens} />;
  }

  const base: React.CSSProperties = {
    fontFamily: props.fontFamily,
    fontWeight: props.fontWeight,
    fontSize: props.fontSize,
    lineHeight: props.lineHeight ?? theme.typography.lineHeight,
    textAlign: props.align ?? theme.typography.align,
    textTransform: props.uppercase ? "uppercase" : "none",
    letterSpacing: `${theme.typography.letterSpacing}em`,
    color,
    margin: 0,
    textWrap: "balance",
  };

  if (mode === "typewriter") {
    const plain = tokens.map((t) => t.text).join(" ");
    // Finish typing within ~60% of the scene so the full line can be read.
    const perChar = Math.min(1.2, (durationInFrames * 0.6) / Math.max(1, plain.length));
    const visible = Math.floor(Math.max(0, frame - delay) / Math.max(0.2, perChar));
    let count = 0;
    return (
      <div style={base}>
        {tokens.map((token, i) => {
          const start = count;
          count += token.text.length + 1;
          const shown = Math.max(0, Math.min(token.text.length, visible - start));
          return (
            <span key={i} style={wordStyle(token, theme, color)}>
              <span>{token.text.slice(0, shown)}</span>
              <span style={{ opacity: 0 }}>{token.text.slice(shown)}</span>
              {i < tokens.length - 1 ? " " : ""}
            </span>
          );
        })}
        <span
          style={{
            display: "inline-block",
            width: "0.5em",
            height: "1em",
            marginLeft: "0.08em",
            verticalAlign: "text-bottom",
            background: theme.colors.accent,
            opacity: Math.floor(frame / (fps / 2)) % 2 === 0 ? 1 : 0,
          }}
        />
      </div>
    );
  }

  // Word-stagger modes. Cap the stagger so long paragraphs still finish early.
  const maxReveal = durationInFrames * 0.45;
  const stagger = Math.min(theme.motion.staggerFrames, maxReveal / Math.max(1, tokens.length));

  return (
    <div style={base}>
      {tokens.map((token, i) => {
        const local = frame - delay - i * stagger;
        const s = spring({ frame: local, fps, config: theme.motion.spring });
        const opacity = interpolate(local, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const style: React.CSSProperties = { ...wordStyle(token, theme, color), opacity };
        if (mode === "slide-up") {
          style.transform = `translateY(${interpolate(s, [0, 1], [props.fontSize * 0.55, 0])}px)`;
        } else if (mode === "blur") {
          style.filter = `blur(${interpolate(opacity, [0, 1], [14, 0])}px)`;
        } else {
          style.transform = `translateY(${interpolate(opacity, [0, 1], [8, 0])}px)`;
        }
        return (
          <span key={i} style={style}>
            {token.text}
            {i < tokens.length - 1 ? " " : ""}
          </span>
        );
      })}
    </div>
  );
};
