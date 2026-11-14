import { random } from "remotion";

/**
 * Drawing toolkit for the code-drawn pixel art in art.ts.
 *
 * A picture is a list of rectangles (`Px`) on a small logical canvas. Figures
 * (creatures, cars, birds) are first painted into a `Grid` so they can be given
 * a dark outline and shading, then stamped onto the picture — the thick-outline,
 * richly shaded look of console-era sprite work.
 */
export type Px = { x: number; y: number; w: number; h: number; c: string; o?: number };
export type ArtContext = {
  W: number;
  H: number;
  /** y of the ground / horizon line. Everything important sits above the dialog box. */
  g: number;
  /** Advances 12 times a second: animation is stepped, never tweened. */
  tick: number;
};

// ------------------------------------------------------------------ rectangles
export const rect = (out: Px[], x: number, y: number, w: number, h: number, c: string, o?: number) => {
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (rw > 0 && rh > 0) {
    out.push({ x: Math.round(x), y: Math.round(y), w: rw, h: rh, c, o });
  }
};

export const disc = (out: Px[], cx: number, cy: number, r: number, c: string, o?: number) => {
  const rr = Math.round(r);
  for (let dy = -rr; dy <= rr; dy++) {
    const half = Math.floor(Math.sqrt(rr * rr - dy * dy));
    rect(out, Math.round(cx) - half, Math.round(cy) + dy, half * 2 + 1, 1, c, o);
  }
};

// ------------------------------------------------------------------ grids (figures)
export type Grid = { w: number; h: number; d: (string | undefined)[] };

export const grid = (w: number, h: number): Grid => ({ w: Math.ceil(w), h: Math.ceil(h), d: new Array(Math.ceil(w) * Math.ceil(h)) });

export const gset = (G: Grid, x: number, y: number, c: string) => {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px >= 0 && py >= 0 && px < G.w && py < G.h) {
    G.d[py * G.w + px] = c;
  }
};

export const gget = (G: Grid, x: number, y: number): string | undefined =>
  x >= 0 && y >= 0 && x < G.w && y < G.h ? G.d[y * G.w + x] : undefined;

export const grect = (G: Grid, x: number, y: number, w: number, h: number, c: string) => {
  for (let j = 0; j < Math.round(h); j++) {
    for (let i = 0; i < Math.round(w); i++) {
      gset(G, Math.round(x) + i, Math.round(y) + j, c);
    }
  }
};

export const gellipse = (G: Grid, cx: number, cy: number, rx: number, ry: number, c: string) => {
  const ryr = Math.max(1, Math.round(ry));
  for (let dy = -ryr; dy <= ryr; dy++) {
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ryr * ryr))));
    grect(G, Math.round(cx) - half, Math.round(cy) + dy, half * 2 + 1, 1, c);
  }
};

export const gline = (G: Grid, x0: number, y0: number, x1: number, y1: number, c: string, thick = 1) => {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    grect(G, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thick, thick, c);
  }
};

/** Paints every empty cell that touches a filled one — the sprite's dark outline. */
export const goutline = (G: Grid, c: string) => {
  const src = G.d.slice();
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < G.w && y < G.h && src[y * G.w + x] !== undefined;
  for (let y = 0; y < G.h; y++) {
    for (let x = 0; x < G.w; x++) {
      if (src[y * G.w + x] === undefined && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) {
        G.d[y * G.w + x] = c;
      }
    }
  }
};

/** Stamps a grid onto the picture, run-length encoding each row. `flip` mirrors it horizontally. */
export const stamp = (out: Px[], G: Grid, x: number, y: number, flip = false, o?: number) => {
  for (let row = 0; row < G.h; row++) {
    let run = 0;
    let color: string | undefined;
    for (let i = 0; i <= G.w; i++) {
      const c = i < G.w ? G.d[row * G.w + (flip ? G.w - 1 - i : i)] : undefined;
      if (c !== color) {
        if (color !== undefined) {
          rect(out, x + i - run, y + row, run, 1, color, o);
        }
        color = c;
        run = 0;
      }
      run++;
    }
  }
};

// ------------------------------------------------------------------ scenery
/** Colour bands with a three-row ordered dither between each pair — a smooth 16-bit gradient. */
export const sky = (out: Px[], { W, g }: ArtContext, bands: string[], height = g) => {
  const bandH = height / bands.length;
  bands.forEach((c, i) => {
    const y0 = Math.round(i * bandH);
    rect(out, 0, y0, W, Math.round((i + 1) * bandH) - y0, c);
    if (i > 0) {
      const prev = bands[i - 1];
      for (let x = 0; x < W; x += 4) {
        rect(out, x + 2, y0 - 2, 1, 1, c);
        rect(out, x, y0 - 1, 1, 1, c);
        rect(out, x + 2, y0 - 1, 1, 1, c);
        rect(out, x + 1, y0, 1, 1, prev);
        rect(out, x + 3, y0, 1, 1, prev);
        rect(out, x + 1, y0 + 1, 1, 1, prev);
      }
    }
  });
};

export const stars = (out: Px[], { W, g, tick }: ArtContext, seed: string, count: number, maxY = g * 0.85) => {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(random(`${seed}x${i}`) * W);
    const y = Math.floor(random(`${seed}y${i}`) * maxY);
    const phase = (tick + Math.floor(random(`${seed}t${i}`) * 30)) % 30;
    const tint = ["#ffffff", "#c9d2ff", "#ffd6f5", "#bff4ff"][i % 4];
    rect(out, x, y, 1, 1, tint, phase < 4 ? 0.35 : 0.95);
  }
};

/** A four-point sparkle that breathes in and out. */
export const sparkle = (out: Px[], x: number, y: number, tick: number, c = "#ffffff", max = 3) => {
  const phase = ((tick % 16) + 16) % 16;
  const arm = phase < 8 ? Math.round((phase / 8) * max) : Math.round(((16 - phase) / 8) * max);
  rect(out, x, y, 1, 1, c);
  if (arm > 0) {
    rect(out, x - arm, y, arm * 2 + 1, 1, c, 0.8);
    rect(out, x, y - arm, 1, arm * 2 + 1, c, 0.8);
  }
  if (arm > 1) {
    rect(out, x - 1, y - 1, 3, 3, c, 0.35);
  }
};

export const sparkles = (out: Px[], { W, g, tick }: ArtContext, seed: string, count: number, c = "#ffffff") => {
  for (let i = 0; i < count; i++) {
    sparkle(out, Math.floor(random(`${seed}sx${i}`) * W), Math.floor(random(`${seed}sy${i}`) * g * 0.7),
      tick + Math.floor(random(`${seed}sp${i}`) * 16), c);
  }
};

export const moon = (out: Px[], cx: number, cy: number, r: number, tick: number, tint = "#fff3b8") => {
  // Halo rings pulse outward.
  for (let ring = 3; ring >= 1; ring--) {
    disc(out, cx, cy, r + ring * Math.max(2, r * 0.16) + ((tick >> 2) % 2), tint, 0.05 + (3 - ring) * 0.035);
  }
  disc(out, cx, cy, r, tint);
  disc(out, cx + r * 0.16, cy + r * 0.12, r * 0.86, "#ffe98f", 0.5);
  const craters: Array<[number, number, number]> = [[-0.35, -0.3, 0.2], [0.3, 0.25, 0.16], [-0.1, 0.45, 0.11], [0.42, -0.35, 0.09], [-0.5, 0.15, 0.08]];
  craters.forEach(([dx, dy, cr]) => {
    disc(out, cx + dx * r, cy + dy * r, Math.max(1, cr * r), "#d9c27a");
    disc(out, cx + dx * r - 1, cy + dy * r - 1, Math.max(1, cr * r - 1), "#e9d896");
  });
};

/** A lumpy cloud with a shaded underside. */
export const cloud = (out: Px[], x: number, y: number, size: number, c: string, shade: string, o = 1) => {
  const lumps: Array<[number, number, number]> = [[0, 0, 1], [1.3, -0.5, 1.3], [2.8, 0, 1.1], [4.1, 0.2, 0.8], [-1.1, 0.3, 0.7]];
  lumps.forEach(([dx, dy, r]) => disc(out, x + dx * size, y + dy * size + 1, r * size, shade, o));
  lumps.forEach(([dx, dy, r]) => disc(out, x + dx * size, y + dy * size - 1, r * size * 0.92, c, o));
  rect(out, x - size * 1.8, y + size * 0.5, size * 6.6, Math.max(1, size * 0.5), shade, o);
};

export const hills = (out: Px[], { W }: ArtContext, baseY: number, amp: number, c: string, seed: number) => {
  for (let x = 0; x < W; x++) {
    const h = amp * (0.55 + 0.3 * Math.sin(x / 23 + seed) + 0.15 * Math.sin(x / 7.3 + seed * 2.1));
    rect(out, x, baseY - h, 1, h + 1, c);
  }
};

/** Pine silhouettes. `scroll` slides the whole line sideways (parallax). */
export const treeline = (out: Px[], { W }: ArtContext, seed: string, baseY: number, maxH: number, c: string, scroll = 0, tip?: string) => {
  const trees: Array<{ x: number; h: number; half: number }> = [];
  let x = 0;
  let i = 0;
  while (x < W * 2) {
    const h = Math.round(maxH * (0.45 + random(`${seed}h${i}`) * 0.55));
    const half = 3 + Math.floor(random(`${seed}w${i}`) * 4);
    trees.push({ x, h, half });
    x += half + 2 + Math.floor(random(`${seed}g${i}`) * 4);
    i++;
  }
  const total = x;
  const shift = ((Math.round(scroll) % total) + total) % total;
  for (const t of trees) {
    for (const base of [t.x - shift, t.x - shift + total]) {
      if (base > W + 8 || base < -16) {
        continue;
      }
      for (let row = 0; row < t.h; row++) {
        // Stepped tiers give each pine its layered look.
        const tier = (row % 5) / 5;
        const width = Math.max(1, Math.round(((row + 1) / t.h) * t.half * 2 * (0.7 + tier * 0.5)));
        rect(out, base + t.half - Math.floor(width / 2), baseY - t.h + row, width, 1, c);
      }
      if (tip) {
        rect(out, base + t.half, baseY - t.h, 1, 2, tip);
      }
    }
  }
  rect(out, 0, baseY, W, 2, c);
};

/** Rotating rays of light from a point — a sunburst behind a hero figure. */
export const sunburst = (out: Px[], { W }: ArtContext, cx: number, cy: number, rays: number, rot: number, c: string, o: number, yMax: number, inner = 0) => {
  const slice = (Math.PI * 2) / rays;
  for (let y = 0; y < yMax; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const on = x < W && dx * dx + dy * dy >= inner * inner &&
        Math.floor((Math.atan2(dy, dx) + Math.PI * 2 + rot) / slice) % 2 === 0;
      if (on && start < 0) {
        start = x;
      } else if (!on && start >= 0) {
        rect(out, start, y, x - start, 1, c, o);
        start = -1;
      }
    }
  }
};

export const mist = (out: Px[], { W, tick }: ArtContext, y: number, c: string, layers = 5) => {
  for (let i = 0; i < layers; i++) {
    const w = 50 + (i % 3) * 24;
    const x = ((i * 71 + Math.floor(tick * (0.4 + (i % 3) * 0.25))) % (W + w)) - w;
    rect(out, x, y + (i % 3) * 3 - 3, w, 2, c, 0.1);
    rect(out, x + 8, y + (i % 3) * 3 - 2, w - 16, 2, c, 0.08);
  }
};

/** Small moths or fireflies orbiting a point. */
export const swarm = (out: Px[], cx: number, cy: number, count: number, rx: number, ry: number, tick: number, c: string, seed: string) => {
  for (let i = 0; i < count; i++) {
    const speed = 0.04 + random(`${seed}v${i}`) * 0.07;
    const angle = tick * speed * (i % 2 ? 1 : -1) + random(`${seed}a${i}`) * Math.PI * 2;
    const wobble = 0.6 + 0.4 * Math.sin(tick * 0.11 + i);
    const x = Math.round(cx + Math.cos(angle) * rx * (0.4 + random(`${seed}r${i}`) * 0.6));
    const y = Math.round(cy + Math.sin(angle * 1.3) * ry * wobble);
    rect(out, x, y, 1, 1, c);
    if ((tick + i) % 2 === 0) {
      rect(out, x - 1, y - 1, 1, 1, c, 0.7);
      rect(out, x + 1, y - 1, 1, 1, c, 0.7);
    } else {
      rect(out, x - 1, y, 1, 1, c, 0.7);
      rect(out, x + 1, y, 1, 1, c, 0.7);
    }
  }
};

export const fireflies = (out: Px[], { W, tick }: ArtContext, seed: string, count: number, y0: number, y1: number, c = "#d9ff7a") => {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(random(`${seed}fx${i}`) * W + Math.sin(tick * 0.07 + i) * 5);
    const y = Math.floor(y0 + random(`${seed}fy${i}`) * (y1 - y0) + Math.cos(tick * 0.09 + i * 2) * 3);
    const lit = (tick + Math.floor(random(`${seed}fp${i}`) * 20)) % 20 < 12;
    if (lit) {
      rect(out, x - 1, y - 1, 3, 3, c, 0.18);
      rect(out, x, y, 1, 1, c);
    }
  }
};

/** A pair of glowing eyes in the dark. */
export const glowEyes = (out: Px[], x: number, y: number, tick: number, gap = 5, size = 2) => {
  if (tick % 46 > 42) {
    return; // blink
  }
  for (const ex of [x, x + gap]) {
    disc(out, ex + size / 2, y + size / 2, size + 3, "#ff2244", 0.12);
    disc(out, ex + size / 2, y + size / 2, size + 1, "#ff3b30", 0.3);
    rect(out, ex, y, size, size, "#ff3b30");
    rect(out, ex, y, 1, 1, "#ffd0a8");
  }
};

export const snow = (out: Px[], { W, H, tick }: ArtContext, seed: string, count: number) => {
  for (let i = 0; i < count; i++) {
    const speed = 0.5 + random(`${seed}v${i}`) * 0.9;
    const x = (Math.floor(random(`${seed}x${i}`) * W + Math.sin(tick * 0.05 + i) * 4 + tick * 0.2) % W + W) % W;
    const y = Math.floor(random(`${seed}y${i}`) * H + tick * speed) % H;
    rect(out, x, y, i % 5 === 0 ? 2 : 1, i % 5 === 0 ? 2 : 1, "#ffffff", 0.55 + (i % 3) * 0.15);
  }
};
