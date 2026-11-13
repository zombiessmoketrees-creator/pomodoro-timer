import React from "react";
import { type CalculateMetadataFunction, Composition } from "remotion";
import { totalFrames } from "./lib/timing";
import { ManifestVideo } from "./ManifestVideo";
import type { Manifest } from "./types";
import sample from "../manifests/sample.json";

// Duration and fps come from the manifest passed via --props, so one pair of
// compositions renders every video. engine/render.py picks the composition id.
const calculateMetadata: CalculateMetadataFunction<Manifest> = ({ props }) => {
  if (!Array.isArray(props.scenes) || props.scenes.length === 0) {
    throw new Error("Manifest has no scenes. Pass a manifest with --props=<file.json>.");
  }
  return { durationInFrames: totalFrames(props), fps: props.fps || 30 };
};

const defaultProps = sample as Manifest;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Landscape"
      component={ManifestVideo}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={300}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="Vertical"
      component={ManifestVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  </>
);
