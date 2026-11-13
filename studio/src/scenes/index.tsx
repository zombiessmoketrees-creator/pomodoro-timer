import React from "react";
import type { Scene, Theme } from "../types";
import { BulletsScene } from "./BulletsScene";
import { CodeScene } from "./CodeScene";
import { ImageScene } from "./ImageScene";
import { OutroScene } from "./OutroScene";
import { QuoteScene } from "./QuoteScene";
import { RedditScene } from "./RedditScene";
import { StatScene } from "./StatScene";
import { TextScene } from "./TextScene";
import { TitleScene } from "./TitleScene";

/**
 * Scene registry. To add a scene type: define its data type in types.ts, build
 * the component in this folder, add a case here, and add the type to
 * engine/manifest.py so manifests using it validate.
 */
export const SceneRenderer: React.FC<{ scene: Scene; theme: Theme }> = ({ scene, theme }) => {
  switch (scene.type) {
    case "title":
      return <TitleScene scene={scene} theme={theme} />;
    case "text":
      return <TextScene scene={scene} theme={theme} />;
    case "bullets":
      return <BulletsScene scene={scene} theme={theme} />;
    case "quote":
      return <QuoteScene scene={scene} theme={theme} />;
    case "stat":
      return <StatScene scene={scene} theme={theme} />;
    case "code":
      return <CodeScene scene={scene} theme={theme} />;
    case "image":
      return <ImageScene scene={scene} theme={theme} />;
    case "reddit":
      return <RedditScene scene={scene} theme={theme} />;
    case "outro":
      return <OutroScene scene={scene} theme={theme} />;
    default: {
      const unknown = scene as { type?: string };
      throw new Error(`Unknown scene type "${unknown.type}" in manifest.`);
    }
  }
};
