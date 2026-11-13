import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import type { Theme } from "../types";

// Fonts are bundled from npm (@fontsource) so renders never hit the network.
// To add a family: `npm i @fontsource/<name>` in /studio, import the weights
// below, and add the family name to FONT_FAMILIES + styles/_schema.json.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/600.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/900.css";
import "@fontsource/anton/400.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";

export const FONT_FAMILIES = [
  "Inter",
  "Space Grotesk",
  "IBM Plex Sans",
  "Playfair Display",
  "Anton",
  "JetBrains Mono",
] as const;

const FALLBACK: Record<string, string> = {
  "Playfair Display": "Georgia, 'Times New Roman', serif",
  "JetBrains Mono": "Menlo, Consolas, monospace",
};

export const fontStack = (family: string): string =>
  `"${family}", ${FALLBACK[family] ?? "system-ui, -apple-system, 'Segoe UI', sans-serif"}`;

/** Blocks rendering until every font the theme uses is decoded. */
export const useThemeFonts = (theme: Theme): void => {
  const [handle] = useState(() => delayRender("Loading theme fonts"));

  useEffect(() => {
    const specs = [
      theme.fonts.heading,
      theme.fonts.body,
      theme.fonts.mono,
      { family: theme.captions.fontFamily, weight: 800 },
    ];
    Promise.all(
      specs.map((s) =>
        // An unknown family resolves to an empty list; the CSS fallback stack covers it.
        document.fonts.load(`${s.weight} 48px "${s.family}"`).catch(() => []),
      ),
    )
      .then(() => document.fonts.ready)
      .then(() => continueRender(handle))
      .catch((err) => cancelRender(err));
  }, [handle, theme]);
};
