import type { Theme } from "../types";

// Auto-discovers every preset in /styles (files starting with "_" are the
// schema and template, not presets). engine/render.py also inlines the
// resolved theme into the props, so this registry mainly serves Studio preview.
const ctx = require.context("../../../styles", false, /^\.\/[^_][^/]*\.json$/);

export const THEMES: Record<string, Theme> = Object.fromEntries(
  ctx.keys().map((key) => {
    const mod = ctx<Theme & { default?: Theme }>(key);
    const theme = mod.default ?? mod;
    return [theme.name, theme];
  }),
);

export const DEFAULT_THEME_NAME = "documentary-dark";

export const resolveTheme = (style: string, inline?: Theme): Theme => {
  const theme = inline ?? THEMES[style] ?? THEMES[DEFAULT_THEME_NAME];
  if (!theme) {
    throw new Error(`No theme found for style "${style}" and no default preset in /styles.`);
  }
  return theme;
};
