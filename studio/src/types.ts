// Manifest + theme contracts. These mirror styles/_schema.json and
// engine/manifest.py — change all three together.

export type FontSpec = {
  family: string;
  weight: number;
};

export type BackgroundType = "solid" | "gradient" | "grid" | "particles";
export type EnterAnimation = "fade" | "slide-up" | "blur" | "typewriter" | "kinetic";
export type TransitionType = "cut" | "fade" | "slide" | "wipe";

export type Theme = {
  name: string;
  label: string;
  description: string;
  colors: {
    background: string;
    backgroundAlt: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    accentAlt: string;
  };
  background: {
    type: BackgroundType;
    angle: number;
    vignette: number;
    grain: number;
  };
  fonts: {
    heading: FontSpec;
    body: FontSpec;
    mono: FontSpec;
  };
  typography: {
    headingSize: number;
    bodySize: number;
    lineHeight: number;
    letterSpacing: number;
    uppercaseHeadings: boolean;
    align: "left" | "center";
  };
  motion: {
    enter: EnterAnimation;
    staggerFrames: number;
    spring: { damping: number; mass: number; stiffness: number };
    transition: TransitionType;
    transitionFrames: number;
  };
  layout: {
    padding: number;
    maxWidth: number;
    cornerRadius: number;
    progressBar: boolean;
    accentBar: boolean;
  };
  captions: {
    fontFamily: string;
    fontSize: number;
    color: string;
    highlight: string;
    outline: string;
    position: "bottom" | "middle" | "top";
    wordsPerGroup: number;
    uppercase: boolean;
  };
  pacing: {
    wordsPerSecond: number;
    minSceneSeconds: number;
    maxSceneSeconds: number;
  };
};

type SceneBase = {
  id: string;
  durationInSeconds: number;
  /** Plain-text narration for this scene (voiceover script / TTS input). */
  narration?: string;
  /** Per-scene audio file, relative to studio/public or an absolute URL. */
  audio?: string;
};

export type TitleSceneData = SceneBase & {
  type: "title";
  title: string;
  subtitle?: string;
  kicker?: string;
};
export type TextSceneData = SceneBase & {
  type: "text";
  text: string;
  heading?: string;
};
export type BulletsSceneData = SceneBase & {
  type: "bullets";
  items: string[];
  heading?: string;
};
export type QuoteSceneData = SceneBase & {
  type: "quote";
  text: string;
  attribution?: string;
};
export type StatSceneData = SceneBase & {
  type: "stat";
  value: string;
  label: string;
};
export type CodeSceneData = SceneBase & {
  type: "code";
  code: string;
  language?: string;
  heading?: string;
};
export type ImageSceneData = SceneBase & {
  type: "image";
  src: string;
  caption?: string;
  fit?: "cover" | "contain";
};
export type RedditSceneData = SceneBase & {
  type: "reddit";
  subreddit: string;
  author: string;
  title: string;
  body?: string;
  upvotes?: string;
  comments?: string;
};
export type OutroSceneData = SceneBase & {
  type: "outro";
  title: string;
  cta?: string;
};

export type Scene =
  | TitleSceneData
  | TextSceneData
  | BulletsSceneData
  | QuoteSceneData
  | StatSceneData
  | CodeSceneData
  | ImageSceneData
  | RedditSceneData
  | OutroSceneData;

export type CaptionWord = { text: string; start: number; end: number };

export type Manifest = {
  version: number;
  id: string;
  title: string;
  format: "landscape" | "vertical" | "both";
  fps: number;
  style: string;
  /** Resolved theme. engine/render.py inlines styles/<style>.json here. */
  theme?: Theme;
  targetDuration?: number;
  branding?: { handle?: string };
  audio?: { voiceover?: string; music?: string; musicVolume?: number };
  /** Word-level timings (seconds from video start) for a caption overlay. */
  captions?: CaptionWord[];
  scenes: Scene[];
  source?: { vault?: string; note?: string; notePath?: string };
};
