import React from "react";
import { AnimatedText } from "../components/AnimatedText";
import { SceneFrame } from "../components/SceneFrame";
import { fontStack } from "../lib/fonts";
import { useLayout } from "../lib/layout";
import { tokenize } from "../lib/text";
import type { TextSceneData, Theme } from "../types";

export const TextScene: React.FC<{ scene: TextSceneData; theme: Theme }> = ({ scene, theme }) => {
  const l = useLayout(theme);
  const kinetic = theme.motion.enter === "kinetic";
  // Shrink long paragraphs so they never overflow the safe area.
  const words = tokenize(scene.text).length;
  const fit = words > 45 ? 0.74 : words > 30 ? 0.86 : 1;

  return (
    <SceneFrame theme={theme} heading={scene.heading} center={kinetic ? true : undefined}>
      <AnimatedText
        text={scene.text}
        theme={theme}
        fontSize={l.bodySize * fit}
        fontFamily={fontStack(kinetic ? theme.fonts.heading.family : theme.fonts.body.family)}
        fontWeight={kinetic ? theme.fonts.heading.weight : theme.fonts.body.weight}
        uppercase={kinetic && theme.typography.uppercaseHeadings}
        delay={scene.heading ? 8 : 0}
      />
    </SceneFrame>
  );
};
