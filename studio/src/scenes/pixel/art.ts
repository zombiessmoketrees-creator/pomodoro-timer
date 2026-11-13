import { random } from "remotion";

/**
 * Code-drawn 16-bit pixel art. Every picture is a list of rectangles on a small
 * logical canvas (192x108 landscape, 108x192 vertical) that PixelScene scales up
 * with crisp edges. Art is a pure function of (canvas, tick) so renders are
 * deterministic; `tick` advances 12 times a second for a stepped, retro feel.
 *
 * To add a picture: write a `(ctx) => Px[]` function, register it in ART, and add
 * the id to PIXEL_ART in engine/manifest.py so manifests using it validate.
 */
export type Px = { x: number; y: number; w: number; h: number; c: string; o?: number };
export type ArtContext = {
  W: number;
  H: number;
  /** y of the ground / horizon line. Everything important sits above the dialog box. */
  g: number;
  tick: number;
};
type Art = (ctx: ArtContext) => Px[];

// ---------------------------------------------------------------- primitives
const rect = (out: Px[], x: number, y: number, w: number, h: number, c: string, o?: number) => {
  if (w > 0 && h > 0) {
    out.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), c, o });
  }
};

const disc = (out: Px[], cx: number, cy: number, r: number, c: string, o?: number) => {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    rect(out, cx - half, cy + dy, half * 2 + 1, 1, c, o);
  }
};

/** Draws an ASCII sprite: each character maps to a palette colour, "." is transparent. */
const sprite = (out: Px[], rows: string[], palette: Record<string, string>, x: number, y: number, scale = 1, flip = false) => {
  rows.forEach((row, ry) => {
    let run = 0;
    for (let i = 0; i <= row.length; i++) {
      const ch = row[i];
      const prev = row[i - 1];
      if (i > 0 && ch !== prev) {
        if (prev !== "." && palette[prev]) {
          const start = i - run;
          const px = flip ? row.length - i : start;
          rect(out, x + px * scale, y + ry * scale, run * scale, scale, palette[prev]);
        }
        run = 0;
      }
      run++;
    }
  });
};

/** Horizontal colour bands with a checkerboard dither row between them (the classic 16-bit gradient). */
const sky = (out: Px[], { W, g }: ArtContext, bands: string[]) => {
  const bandH = Math.ceil(g / bands.length);
  bands.forEach((c, i) => {
    rect(out, 0, i * bandH, W, bandH, c);
    if (i > 0) {
      for (let x = 0; x < W; x += 2) {
        rect(out, x, i * bandH, 1, 1, bands[i - 1]);
        rect(out, x + 1, i * bandH - 1, 1, 1, c);
      }
    }
  });
};

const stars = (out: Px[], { W, g, tick }: ArtContext, seed: string, count: number) => {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(random(`${seed}x${i}`) * W);
    const y = Math.floor(random(`${seed}y${i}`) * g * 0.8);
    const twinkle = (tick + Math.floor(random(`${seed}t${i}`) * 24)) % 24;
    rect(out, x, y, 1, 1, twinkle < 3 ? "#8a8fd0" : "#ffffff", twinkle < 3 ? 0.5 : 0.95);
  }
};

const moon = (out: Px[], cx: number, cy: number, r: number) => {
  disc(out, cx, cy, r + 3, "#f4e9b0", 0.08);
  disc(out, cx, cy, r + 1, "#f4e9b0", 0.18);
  disc(out, cx, cy, r, "#f4e9b0");
  disc(out, cx - Math.round(r * 0.3), cy - Math.round(r * 0.25), Math.max(1, Math.round(r * 0.22)), "#d9cc8e");
  disc(out, cx + Math.round(r * 0.35), cy + Math.round(r * 0.3), Math.max(1, Math.round(r * 0.15)), "#d9cc8e");
};

/** Jagged pine silhouettes along a baseline. */
const treeline = (out: Px[], { W }: ArtContext, seed: string, baseY: number, maxH: number, c: string) => {
  let x = -2;
  let i = 0;
  while (x < W + 2) {
    const h = 4 + Math.floor(random(`${seed}h${i}`) * maxH);
    const half = 2 + Math.floor(random(`${seed}w${i}`) * 2);
    for (let row = 0; row < h; row++) {
      const width = Math.max(1, Math.round(((row + 1) / h) * half * 2 + ((row % 3 === 2) ? 1 : 0)));
      rect(out, x + half - Math.floor(width / 2), baseY - h + row, width, 1, c);
    }
    x += half + 1 + Math.floor(random(`${seed}g${i}`) * 2);
    i++;
  }
  rect(out, 0, baseY, W, 2, c);
};

const redEyes = (out: Px[], x: number, y: number, tick: number, gap = 3) => {
  if (tick % 40 > 36) {
    return; // blink
  }
  for (const ex of [x, x + gap]) {
    rect(out, ex - 1, y - 1, 3, 3, "#ff2b2b", 0.25);
    rect(out, ex, y, 1, 1, "#ff3b30");
  }
};

/** Procedural Mothman: a neckless body with scalloped wings. `flap` 0 = wings down, 1 = wings up. */
const mothman = (out: Px[], cx: number, feetY: number, size: number, flap: number, tick: number, body = "#120e1c", edge = "#2a2040", eye = "#ff3b30") => {
  const span = Math.round(20 * size);
  const height = Math.round(30 * size);
  const top = feetY - height;
  const shoulder = top + Math.round(7 * size);
  for (let d = 1; d <= span; d++) {
    const k = d / span;
    const wingTop = shoulder - Math.round((flap ? 11 : 3) * size * Math.sin(k * Math.PI * 0.5)) + Math.round((flap ? 0 : 6) * size * k * k);
    const scallop = d % Math.max(3, Math.round(5 * size)) < Math.max(1, Math.round(2 * size)) ? Math.round(2 * size) : 0;
    const wingH = Math.max(1, Math.round(17 * size * (1 - k * 0.92)) + scallop);
    for (const side of [-1, 1]) {
      const x = cx + side * (Math.round(2 * size) + d);
      rect(out, x, wingTop, 1, wingH, body);
      rect(out, x, wingTop, 1, 1, edge);
    }
  }
  const half = Math.max(2, Math.round(3 * size));
  rect(out, cx - half, top + Math.round(2 * size), half * 2 + 1, height - Math.round(5 * size), body);
  rect(out, cx - half + 1, top, half * 2 - 1, Math.round(3 * size), body);
  rect(out, cx - half + 1, feetY - Math.round(3 * size), 1, Math.round(3 * size), body);
  rect(out, cx + half - 1, feetY - Math.round(3 * size), 1, Math.round(3 * size), body);
  // Eyes sit in the upper chest and pulse.
  const eyeY = top + Math.round(4 * size);
  const eyeSize = Math.max(1, Math.round(size * 0.8));
  const spread = Math.max(1, Math.round(1.5 * size));
  const glow = tick % 12 < 6 ? 0.28 : 0.16;
  for (const side of [-1, 1]) {
    const ex = cx + side * spread - (side < 0 ? eyeSize - 1 : 0);
    const mid = ex + Math.floor(eyeSize / 2);
    disc(out, mid, eyeY + Math.floor(eyeSize / 2), eyeSize + Math.max(1, Math.round(size * 0.5)), eye, glow);
    rect(out, ex, eyeY, eyeSize, eyeSize, eye);
    if (eyeSize >= 2) {
      rect(out, ex, eyeY, 1, 1, "#ffd0c8");
    }
  }
};

const CAR = [
  "......oooooooooo........",
  ".....owwwwowwwwwo.......",
  "....owwwwwowwwwwwo......",
  ".oooooooooooooooooooooo.",
  "occcccccccccccccccccccch",
  "occcccccccccccccccccccch",
  "oookkkoooooooooookkkoooo",
  "..kkkkk.........kkkkk...",
  "...kkk...........kkk....",
];
const CAR_COLORS = { o: "#1c3a4a", c: "#2f6f86", w: "#9fd3e6", k: "#0a0a0f", h: "#ffe98a" };

const car = (out: Px[], x: number, roadY: number, tick: number, beam = true) => {
  const y = roadY - 9 + (tick % 6 < 3 ? 0 : 1);
  if (beam) {
    for (let d = 0; d < 34; d++) {
      const spread = 1 + Math.floor(d / 6);
      if ((d + tick) % 2 === 0 || d < 10) {
        rect(out, x + 24 + d, y + 4 - Math.floor(spread / 2), 1, spread + 1, "#ffe98a", Math.max(0.06, 0.4 - d * 0.011));
      }
    }
  }
  sprite(out, CAR, CAR_COLORS, x, y);
};

const road = (out: Px[], { W, H, g, tick }: ArtContext, speed: number) => {
  rect(out, 0, g, W, H - g, "#0d1418");
  rect(out, 0, g + 3, W, 11, "#23232e");
  rect(out, 0, g + 3, W, 1, "#3a3a48");
  for (let x = -12; x < W + 12; x += 12) {
    rect(out, x - ((tick * speed) % 12), g + 8, 6, 1, "#c9c27a");
  }
};

const NIGHT = ["#070718", "#0d0d2b", "#171445", "#261a5a", "#3a2068"];
const DUSK = ["#1b1440", "#3a1d5c", "#6b2a6b", "#a8425f", "#e0704a", "#f2a65a"];
const DAY = ["#3d7fd6", "#559be6", "#78b6f0", "#a5d2f7"];

// ---------------------------------------------------------------- pictures
const nightRoad: Art = (ctx) => {
  const out: Px[] = [];
  const { W, g, tick } = ctx;
  sky(out, ctx, NIGHT);
  stars(out, ctx, "nr", 40);
  moon(out, Math.round(W * 0.78), Math.round(g * 0.22), 7);
  treeline(out, ctx, "nr-far", g, 14, "#0b0b1e");
  redEyes(out, Math.round(W * 0.8), g - 9, tick);
  road(out, ctx, 2);
  car(out, Math.round(W * 0.16), g + 12, tick);
  return out;
};

const chase: Art = (ctx) => {
  const out: Px[] = [];
  const { W, g, tick } = ctx;
  sky(out, ctx, NIGHT);
  stars(out, ctx, "ch", 30);
  treeline(out, ctx, "ch-far", g, 12, "#0b0b1e");
  road(out, ctx, 6);
  const carX = Math.round(W * 0.42);
  for (let i = 0; i < 6; i++) {
    const y = g - 16 + Math.floor(random(`sl${i}`) * 28);
    rect(out, ((i * 37 - tick * 9) % (W + 30) + W + 30) % (W + 30) - 30, y, 10 + (i % 3) * 5, 1, "#ffffff", 0.25);
  }
  car(out, carX, g + 12, tick * 2);
  const bob = tick % 8 < 4 ? 0 : 2;
  mothman(out, carX + 4, g - 8 + bob, 0.8, tick % 6 < 3 ? 1 : 0, tick);
  return out;
};

const tntArea: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  sky(out, ctx, NIGHT);
  stars(out, ctx, "tnt", 36);
  moon(out, Math.round(W * 0.2), Math.round(g * 0.2), 6);
  treeline(out, ctx, "tnt-far", g - 2, 10, "#0a0a1c");
  // Old power plant with stacks.
  const px = Math.round(W * 0.62);
  rect(out, px, g - 26, 30, 26, "#15152a");
  rect(out, px + 4, g - 40, 5, 14, "#15152a");
  rect(out, px + 14, g - 46, 5, 20, "#15152a");
  rect(out, px + 23, g - 36, 4, 10, "#15152a");
  for (let wy = 0; wy < 3; wy++) {
    for (let wx = 0; wx < 5; wx++) {
      rect(out, px + 3 + wx * 5, g - 22 + wy * 6, 2, 3, random(`tw${wx}${wy}`) > 0.8 ? "#3c3c5c" : "#0a0a18");
    }
  }
  rect(out, 0, g, W, H - g, "#101a14");
  // Grass-covered concrete "igloo" bunkers.
  [0.14, 0.36].forEach((fx, i) => {
    const cx = Math.round(W * fx);
    const r = 13 - i * 2;
    for (let dy = -r; dy <= 0; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy));
      rect(out, cx - half, g + dy, half * 2 + 1, 1, dy < -r + 3 ? "#2c4a34" : "#22382a");
    }
    rect(out, cx - 3, g - 8, 7, 8, "#6a6a72");
    rect(out, cx - 2, g - 7, 5, 7, "#07070c");
  });
  for (let x = 2; x < W; x += 9) {
    rect(out, x, g - 5, 1, 6, "#3a3a44");
  }
  rect(out, 0, g - 4, W, 1, "#3a3a44", 0.6);
  redEyes(out, Math.round(W * 0.36) - 1, g - 15, tick);
  return out;
};

const mothmanPortrait: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  sky(out, ctx, NIGHT);
  stars(out, ctx, "mm", 50);
  const cx = Math.round(W / 2);
  moon(out, cx, Math.round(g * 0.42), Math.round(Math.min(W, g) * 0.3));
  treeline(out, ctx, "mm-far", g, 16, "#07071a");
  rect(out, 0, g, W, H - g, "#07070f");
  const size = Math.min(W / 46, g / 40);
  mothman(out, cx, g - 2, size, tick % 16 < 8 ? 1 : 0, tick);
  for (let i = 0; i < 5; i++) {
    rect(out, ((i * 53 + tick) % (W + 40)) - 40, g - 6 + (i % 3) * 3, 36, 2, "#8a8fd0", 0.1);
  }
  return out;
};

const town: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  sky(out, ctx, NIGHT);
  stars(out, ctx, "tn", 44);
  moon(out, Math.round(W * 0.15), Math.round(g * 0.18), 5);
  let x = 0;
  let i = 0;
  while (x < W) {
    const w = 12 + Math.floor(random(`bw${i}`) * 12);
    const h = 18 + Math.floor(random(`bh${i}`) * 26);
    const shade = i % 2 ? "#1b1b33" : "#141428";
    rect(out, x, g - h, w, h, shade);
    rect(out, x, g - h, w, 1, "#2b2b4a");
    for (let wy = g - h + 4; wy < g - 6; wy += 6) {
      for (let wx = x + 2; wx < x + w - 2; wx += 4) {
        const seed = random(`win${i}-${wx}-${wy}`);
        const lit = seed > 0.45 && Math.floor(tick / 20 + seed * 10) % 7 !== 0;
        rect(out, wx, wy, 2, 3, lit ? "#ffd166" : "#0a0a16");
      }
    }
    x += w;
    i++;
  }
  rect(out, 0, g, W, H - g, "#1a1a24");
  rect(out, 0, g + 3, W, 1, "#33334a");
  for (let lx = 10; lx < W; lx += 34) {
    rect(out, lx, g - 12, 1, 12, "#3a3a4a");
    rect(out, lx - 1, g - 13, 3, 2, "#ffe98a");
    rect(out, lx - 3, g - 12, 7, 6, "#ffe98a", 0.12);
  }
  const drift = Math.round(Math.sin(tick / 18) * W * 0.12);
  redEyes(out, Math.round(W * 0.62) + drift, Math.round(g * 0.3) + (tick % 10 < 5 ? 0 : 1), tick, 4);
  return out;
};

const river = (out: Px[], { W, H, g, tick }: ArtContext, base: string, light: string) => {
  rect(out, 0, g, W, H - g, base);
  for (let i = 0; i < 46; i++) {
    const y = g + 2 + Math.floor(random(`ry${i}`) * (H - g - 3));
    const x = (Math.floor(random(`rx${i}`) * W) + Math.floor(tick / 3) * (i % 2 ? 1 : -1) + W * 4) % W;
    rect(out, x, y, 3 + (i % 4), 1, light, 0.35);
  }
};

const bridgeFrame = (out: Px[], { W, g }: ArtContext, deckY: number, c: string, chain: string) => {
  const t1 = Math.round(W * 0.26);
  const t2 = Math.round(W * 0.74);
  const towerTop = deckY - Math.round(g * 0.42);
  for (let x = 0; x < W; x++) {
    let y: number;
    if (x < t1) {
      y = deckY - 2 - Math.round((deckY - 2 - towerTop) * Math.pow(x / t1, 1.6));
    } else if (x > t2) {
      y = deckY - 2 - Math.round((deckY - 2 - towerTop) * Math.pow((W - x) / (W - t2), 1.6));
    } else {
      const k = (x - t1) / (t2 - t1);
      y = towerTop + Math.round((deckY - 5 - towerTop) * 4 * k * (1 - k));
    }
    rect(out, x, y, 1, 1, chain);
    if (x % 4 === 0) {
      rect(out, x, y + 1, 1, deckY - y - 1, chain, 0.55);
    }
  }
  for (const tx of [t1, t2]) {
    rect(out, tx - 2, towerTop - 2, 1, g - towerTop + 6, c);
    rect(out, tx + 2, towerTop - 2, 1, g - towerTop + 6, c);
    for (let y = towerTop; y < g; y += 5) {
      rect(out, tx - 2, y, 5, 1, c);
    }
    rect(out, tx - 3, g, 7, 5, "#4a4a52");
  }
  rect(out, 0, deckY, W, 2, c);
  rect(out, 0, deckY + 2, W, 1, "#000000", 0.4);
  return { t1, t2, towerTop };
};

const bridge: Art = (ctx) => {
  const out: Px[] = [];
  const { W, g, tick } = ctx;
  sky(out, ctx, DUSK);
  disc(out, Math.round(W * 0.5), g - 2, 9, "#ffd28a");
  rect(out, 0, g - 5, Math.round(W * 0.2), 5, "#1a1430");
  rect(out, Math.round(W * 0.82), g - 6, Math.round(W * 0.18) + 1, 6, "#1a1430");
  river(out, ctx, "#2a2458", "#f2a65a");
  const deckY = g - 12;
  bridgeFrame(out, ctx, deckY, "#c8ccd6", "#e6e9f0");
  for (let i = 0; i < 9; i++) {
    const dir = i % 2 ? 1 : -1;
    const x = (((i * 27 + tick * dir) % (W + 10)) + W + 10) % (W + 10) - 5;
    rect(out, x, deckY - 2, 4, 2, ["#b03a48", "#2f6f86", "#d9d2b0", "#3a3a4a"][i % 4]);
    rect(out, dir > 0 ? x + 4 : x - 1, deckY - 1, 1, 1, "#ffe98a");
  }
  return out;
};

const collapse: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  sky(out, ctx, NIGHT);
  stars(out, ctx, "co", 20);
  rect(out, 0, g - 5, Math.round(W * 0.2), 5, "#0c0c1c");
  rect(out, Math.round(W * 0.82), g - 6, Math.round(W * 0.18) + 1, 6, "#0c0c1c");
  river(out, ctx, "#0f1436", "#8a8fd0");
  const deckY = g - 12;
  const t1 = Math.round(W * 0.26);
  const t2 = Math.round(W * 0.74);
  const c = "#8d919c";
  // What still stands: the approach spans and one leaning tower.
  rect(out, 0, deckY, t1 - 6, 2, c);
  rect(out, t2 + 8, deckY, W - t2 - 8, 2, c);
  for (let y = 0; y < Math.round(g * 0.34); y++) {
    rect(out, t1 - 2 + Math.round(y * 0.25), g - y, 1, 1, c);
    rect(out, t1 + 2 + Math.round(y * 0.25), g - y, 1, 1, c);
    if (y % 5 === 0) {
      rect(out, t1 - 2 + Math.round(y * 0.25), g - y, 5, 1, c);
    }
  }
  rect(out, t1 - 3, g, 7, 5, "#4a4a52");
  rect(out, t2 - 3, g, 7, 5, "#4a4a52");
  rect(out, t2 - 2, g - 9, 5, 9, c);
  // Fallen deck sections, half under water.
  const fallen: Array<[number, number, number]> = [[0.34, 2, 0.5], [0.47, 5, -0.2], [0.6, 3, 0.35]];
  fallen.forEach(([fx, depth, slope]) => {
    const x0 = Math.round(W * fx);
    for (let d = 0; d < 16; d++) {
      rect(out, x0 + d, g + depth + Math.round(d * slope), 1, 2, c, 0.9);
    }
  });
  for (let i = 0; i < 4; i++) {
    const cx = Math.round(W * (0.36 + i * 0.09));
    const r = 2 + ((tick + i * 5) % 14);
    rect(out, cx - r, g + 3 + (i % 2) * 4, r * 2, 1, "#c9d2ff", Math.max(0, 0.5 - r * 0.035));
  }
  // December: light snow.
  for (let i = 0; i < 60; i++) {
    const x = (Math.floor(random(`sx${i}`) * W) + Math.floor(tick / 4)) % W;
    const y = (Math.floor(random(`sy${i}`) * H) + Math.floor(tick * (0.5 + random(`sv${i}`) * 0.5))) % H;
    rect(out, x, y, 1, 1, "#ffffff", 0.7);
  }
  return out;
};

const CRANE = [
  ".......rrr.....",
  "......rgggbbbb.",
  "......gkg......",
  "......ggg......",
  "......gg.......",
  ".....gg........",
  ".....gg........",
  ".....gg........",
  "....ggg........",
  "...gggggggg....",
  ".gggggggggggg..",
  "ggggdddggggggg.",
  "gggddddddgggggg",
  ".gggdddddgggggg",
  "..gggggggggg.gg",
  "....ggggggg....",
  ".....l...l.....",
  ".....l...l.....",
  ".....l...l.....",
  ".....l...l.....",
  ".....l...l.....",
  ".....l...l.....",
  "....ll..ll.....",
];

const crane: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  sky(out, ctx, ["#12304a", "#1d4f6b", "#2f7a86", "#58a79a", "#9fd0a8"]);
  treeline(out, ctx, "cr-far", g, 8, "#0f2a2a");
  rect(out, 0, g, W, H - g, "#143a2e");
  for (let x = 1; x < W; x += 3) {
    const h = 3 + Math.floor(random(`reed${x}`) * 7);
    rect(out, x + (tick % 16 < 8 ? 0 : 1) * (x % 2), g - h + 2, 1, h, "#2f6b3a");
  }
  const scale = Math.max(2, Math.floor(Math.min(W, g) / 34));
  const cx = Math.round(W * 0.38);
  sprite(out, CRANE, { g: "#b9bcc4", d: "#8b8e98", r: "#d62f2f", b: "#3a3a3a", k: "#101010", l: "#4a4a4a" },
    cx - 7 * scale, g - CRANE.length * scale + 1, scale);
  // Blinking question mark.
  if (tick % 16 < 11) {
    const q = ["yyyy.", "y...y", "....y", "..yy.", "..y..", ".....", "..y.."];
    sprite(out, q, { y: "#ffe98a" }, cx + 12 * scale, g - CRANE.length * scale - 2, scale);
  }
  return out;
};

const statue: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  sky(out, ctx, DAY);
  for (let i = 0; i < 4; i++) {
    const cx = ((i * 61 + Math.floor(tick / 6)) % (W + 40)) - 20;
    const cy = 8 + (i % 3) * 9;
    rect(out, cx, cy, 16, 3, "#ffffff", 0.9);
    rect(out, cx + 3, cy - 2, 9, 2, "#ffffff", 0.9);
  }
  let x = 0;
  let i = 0;
  while (x < W) {
    const w = 14 + Math.floor(random(`sb${i}`) * 10);
    const h = 16 + Math.floor(random(`sh${i}`) * 14);
    rect(out, x, g - h, w, h, ["#b5553c", "#c9a66b", "#8d6e63", "#a04a3a"][i % 4]);
    rect(out, x, g - h, w, 2, "#5a3a30");
    for (let wx = x + 2; wx < x + w - 3; wx += 5) {
      rect(out, wx, g - h + 5, 3, 4, "#dff3ff");
    }
    x += w;
    i++;
  }
  rect(out, 0, g, W, H - g, "#8a8f98");
  rect(out, 0, g, W, 1, "#b8bcc4");
  const cx = Math.round(W / 2);
  rect(out, cx - 9, g - 9, 19, 9, "#6d7078");
  rect(out, cx - 11, g - 2, 23, 3, "#585b62");
  const size = Math.min(W / 60, g / 52);
  mothman(out, cx, g - 9, size, 1, tick, "#c9d0da", "#f4f8ff", "#e0262b");
  // Festival bunting.
  const colors = ["#e0262b", "#ffd166", "#2f9e6b", "#2f6fd6"];
  for (let bx = 0; bx < W; bx += 6) {
    const sag = Math.round(Math.sin((bx / W) * Math.PI) * 5);
    const y = 3 + sag + (((tick >> 2) + bx) % 2);
    rect(out, bx, y, 5, 1, colors[(bx / 6) % 4]);
    rect(out, bx + 1, y + 1, 3, 1, colors[(bx / 6) % 4]);
    rect(out, bx + 2, y + 2, 1, 1, colors[(bx / 6) % 4]);
  }
  return out;
};

const paperBox = ({ W, g, tick }: ArtContext) => {
  // A short canvas (landscape) gets a wide front page with the photo beside the headline.
  const wide = g < 80;
  const w = Math.min(W - 12, wide ? 150 : 96);
  const h = Math.min(g - 6, 84);
  // Slides up into place over the first second, in whole pixels.
  const rise = Math.max(0, 14 - tick * 2);
  return { x: Math.round((W - w) / 2), y: Math.round((g - h) / 2) + 2 + rise, w, h, wide };
};

const newspaper: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H } = ctx;
  rect(out, 0, 0, W, H, "#2a1c14");
  for (let y = 0; y < H; y += 7) {
    rect(out, 0, y, W, 1, "#35241a");
  }
  const p = paperBox(ctx);
  rect(out, p.x + 2, p.y + 2, p.w, p.h, "#000000", 0.35);
  rect(out, p.x, p.y, p.w, p.h, "#e9dfc4");
  rect(out, p.x + 3, p.y + 10, p.w - 6, 1, "#2a2a2a");
  rect(out, p.x + 3, p.y + 12, p.w - 6, 1, "#2a2a2a");
  // Photo box with two eyes, and columns of "text".
  const photoX = p.wide ? p.x + p.w - 40 : p.x + 4;
  const photoY = p.wide ? p.y + 16 : p.y + 44;
  rect(out, photoX, photoY, 30, 22, "#3a3a3a");
  rect(out, photoX + 1, photoY + 1, 28, 20, "#151515");
  rect(out, photoX + 11, photoY + 8, 2, 2, "#ff3b30");
  rect(out, photoX + 17, photoY + 8, 2, 2, "#ff3b30");
  if (p.wide) {
    for (let y = photoY + 25; y < p.y + p.h - 3; y += 3) {
      rect(out, photoX, y, 30 - ((y * 5) % 7), 1, "#8a8170");
    }
    for (let y = p.y + 45; y < p.y + p.h - 3; y += 3) {
      rect(out, p.x + 6, y, p.w - 56 - ((y * 7) % 9), 1, "#8a8170");
    }
  } else {
    for (let y = photoY; y < p.y + p.h - 4; y += 3) {
      rect(out, p.x + 38, y, p.w - 42 - ((y * 7) % 9), 1, "#8a8170");
    }
    for (let y = photoY + 25; y < p.y + p.h - 4; y += 3) {
      rect(out, p.x + 4, y, 30 - ((y * 5) % 7), 1, "#8a8170");
    }
  }
  return out;
};

export type Label = { x: number; y: number; size: number; text: string; c: string };

/** Pixel-font text drawn on top of a picture (SVG text in logical pixels). */
export const LABELS: Record<string, (ctx: ArtContext) => Label[]> = {
  newspaper: (ctx) => {
    const p = paperBox(ctx);
    const cx = p.x + p.w / 2;
    const headX = p.wide ? p.x + (p.w - 44) / 2 + 2 : cx;
    return [
      { x: cx, y: p.y + 8, size: 3.6, text: "POINT PLEASANT REGISTER", c: "#1a1a1a" },
      { x: headX, y: p.y + 20, size: 5, text: "COUPLES SEE", c: "#111111" },
      { x: headX, y: p.y + 27, size: 5, text: "MAN-SIZED BIRD...", c: "#111111" },
      { x: headX, y: p.y + 34, size: 5, text: "CREATURE...", c: "#111111" },
      { x: headX, y: p.y + 41, size: 5, text: "SOMETHING", c: "#111111" },
    ];
  },
};

export const ART: Record<string, Art> = {
  newspaper,
  "night-road": nightRoad,
  chase,
  "tnt-area": tntArea,
  mothman: mothmanPortrait,
  town,
  bridge,
  collapse,
  crane,
  statue,
};
