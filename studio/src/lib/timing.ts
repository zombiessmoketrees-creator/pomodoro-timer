import type { Manifest, Scene, Theme } from "../types";
import { resolveTheme } from "./themes";

export const sceneFrames = (scene: Scene, fps: number): number =>
  Math.max(1, Math.round(scene.durationInSeconds * fps));

/** Transition length, clamped so it never exceeds half of the shortest scene. */
export const transitionFrames = (manifest: Manifest, theme: Theme): number => {
  if (theme.motion.transition === "cut" || manifest.scenes.length < 2) {
    return 0;
  }
  const shortest = Math.min(...manifest.scenes.map((s) => sceneFrames(s, manifest.fps)));
  return Math.max(0, Math.min(theme.motion.transitionFrames, Math.floor(shortest / 2) - 1));
};

/** Total length. Transitions overlap adjacent scenes, so they shorten the sum. */
export const totalFrames = (manifest: Manifest): number => {
  const theme = resolveTheme(manifest.style, manifest.theme);
  const sum = manifest.scenes.reduce((acc, s) => acc + sceneFrames(s, manifest.fps), 0);
  const overlap = transitionFrames(manifest, theme) * (manifest.scenes.length - 1);
  return Math.max(1, sum - overlap);
};
