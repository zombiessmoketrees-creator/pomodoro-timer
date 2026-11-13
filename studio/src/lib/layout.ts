import { useVideoConfig } from "remotion";
import type { Theme } from "../types";

/**
 * Theme sizes are authored for a 1080px short edge. `u` rescales them so the
 * same preset works at any resolution; vertical video gets tighter side
 * padding and a text-size bump because phones are viewed at arm's length.
 */
export const useLayout = (theme: Theme) => {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const u = Math.min(width, height) / 1080;
  const padding = theme.layout.padding * u * (vertical ? 0.75 : 1);
  return {
    vertical,
    u,
    padding,
    maxWidth: Math.min(theme.layout.maxWidth * u, width - padding * 2),
    headingSize: theme.typography.headingSize * u * (vertical ? 0.92 : 1),
    bodySize: theme.typography.bodySize * u * (vertical ? 1.12 : 1),
    // Keep content clear of platform UI (caption bar, like/share rail) on Shorts.
    safeBottom: vertical ? height * 0.16 : padding,
    safeTop: vertical ? height * 0.1 : padding,
  };
};
