import React from "react";
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Background } from "./components/Background";
import { Captions, Handle, ProgressBar } from "./components/Overlays";
import { useThemeFonts } from "./lib/fonts";
import { resolveTheme } from "./lib/themes";
import { sceneFrames, transitionFrames } from "./lib/timing";
import { resolveAsset } from "./scenes/ImageScene";
import { SceneRenderer } from "./scenes";
import type { Manifest, Theme } from "./types";

const presentationFor = (theme: Theme, vertical: boolean) => {
  switch (theme.motion.transition) {
    case "slide":
      return slide({ direction: vertical ? "from-bottom" : "from-right" });
    case "wipe":
      return wipe({ direction: "from-left" });
    default:
      return fade();
  }
};

export const ManifestVideo: React.FC<Manifest> = (manifest) => {
  const { fps, width, height } = useVideoConfig();
  const theme = resolveTheme(manifest.style, manifest.theme);
  useThemeFonts(theme);

  const overlap = transitionFrames(manifest, theme);
  const vertical = height > width;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <Background theme={theme} />

      <TransitionSeries>
        {manifest.scenes.flatMap((scene, i) => {
          const nodes = [
            <TransitionSeries.Sequence key={scene.id} durationInFrames={sceneFrames(scene, fps)}>
              <SceneRenderer scene={scene} theme={theme} />
              {scene.audio ? <Audio src={resolveAsset(scene.audio)} /> : null}
            </TransitionSeries.Sequence>,
          ];
          if (overlap > 0 && i < manifest.scenes.length - 1) {
            nodes.push(
              <TransitionSeries.Transition
                key={`${scene.id}-transition`}
                // The cast unifies the per-preset prop types of fade/slide/wipe.
                presentation={presentationFor(theme, vertical) as ReturnType<typeof fade>}
                timing={linearTiming({ durationInFrames: overlap })}
              />,
            );
          }
          return nodes;
        })}
      </TransitionSeries>

      {manifest.captions?.length ? (
        <Sequence name="Captions">
          <Captions theme={theme} words={manifest.captions} />
        </Sequence>
      ) : null}
      {manifest.branding?.handle ? <Handle theme={theme} handle={manifest.branding.handle} /> : null}
      {theme.layout.progressBar ? <ProgressBar theme={theme} /> : null}

      {manifest.audio?.voiceover ? <Audio src={resolveAsset(manifest.audio.voiceover)} /> : null}
      {manifest.audio?.music ? (
        <Audio src={resolveAsset(manifest.audio.music)} volume={manifest.audio.musicVolume ?? 0.15} loop />
      ) : null}
    </AbsoluteFill>
  );
};
