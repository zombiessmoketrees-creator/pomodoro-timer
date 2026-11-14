import { random } from "remotion";
import { carFigure, craneFigure, type Figure, MOTH_DARK, MOTH_STEEL, mothFigure, owlFigure, personFigure } from "./figures";
import {
  type ArtContext, cloud, disc, fireflies, glowEyes, hills, mist, moon, type Px, rect, sky, snow, sparkle,
  sparkles, stamp, stars, sunburst, swarm, treeline,
} from "./toolkit";

export type { ArtContext, Px } from "./toolkit";

/**
 * Code-drawn 16-bit pixel art: dense, saturated, outlined and always moving.
 * Every picture is a pure function of (canvas, tick) on a 320x180 (landscape) or
 * 180x320 (vertical) logical canvas that PixelScene scales up with crisp edges.
 *
 * To add a picture: write a `(ctx) => Px[]` function from the toolkit and
 * figures, register it in ART, and add the id to PIXEL_ART in engine/manifest.py.
 */
type Art = (ctx: ArtContext) => Px[];
export type Label = { x: number; y: number; size: number; text: string; c: string };

const NIGHT = ["#04021a", "#090630", "#140a4c", "#26106e", "#47168c", "#781f9a", "#b32a92"];
const DUSK = ["#170a3d", "#3a1069", "#771a88", "#c22a7e", "#f0506a", "#ff8a4c", "#ffc857"];
const COLD = ["#03040f", "#070a22", "#0d1338", "#151e52", "#1e2a68", "#2a3a80"];
const DAY = ["#1a63dc", "#2f86ee", "#55a9f6", "#8fcdfb", "#c9ecff"];
const MARSH = ["#0d2648", "#1b4a78", "#2c80a0", "#63bfae", "#f0b49c", "#ffd9a6"];

const flapCycle = (tick: number, speed: number) => [0, 1, 2, 1][Math.floor(tick / speed) % 4];

/** Stamps a figure by its anchor (centre x, feet y) and adds the glow around its eyes. */
const place = (out: Px[], fig: Figure, x: number, feetY: number, tick: number, glow = "#ff2244") => {
  const ox = Math.round(x - fig.ax);
  const oy = Math.round(feetY - fig.ay);
  stamp(out, fig.G, ox, oy);
  const pulse = tick % 12 < 6 ? 1 : 0;
  for (const [ex, ey] of fig.eyes) {
    disc(out, ox + ex, oy + ey, fig.eyeR * 3 + pulse, glow, 0.1);
    disc(out, ox + ex, oy + ey, fig.eyeR * 1.9, glow, 0.2);
  }
  return { ox, oy };
};

const nightBackdrop = (out: Px[], ctx: ArtContext, seed: string, clouds = true) => {
  const { W, g, tick } = ctx;
  sky(out, ctx, NIGHT);
  stars(out, ctx, seed, Math.round(W * 0.45));
  sparkles(out, ctx, seed, 7, "#ffe9ff");
  if (clouds) {
    for (let i = 0; i < 3; i++) {
      const x = ((i * 131 + Math.floor(tick / (5 + i * 2))) % (W + 90)) - 60;
      cloud(out, x, g * (0.2 + i * 0.16), 5 + i, "#3a1a7a", "#22104f", 0.75);
    }
  }
};

const road = (out: Px[], ctx: ArtContext, speed: number) => {
  const { W, H, g, tick } = ctx;
  rect(out, 0, g, W, H - g, "#0a1410");
  for (let x = 0; x < W; x += 3) {
    rect(out, x, g + 1 + ((x * 7) % 3), 1, 2, x % 2 ? "#17301f" : "#10231a");
  }
  rect(out, 0, g + 5, W, 21, "#1c1a32");
  rect(out, 0, g + 5, W, 1, "#6f66b0");
  rect(out, 0, g + 25, W, 1, "#6f66b0");
  for (let i = 0; i < 70; i++) {
    const x = ((Math.floor(random(`rd${i}`) * W) - tick * speed) % W + W) % W;
    rect(out, x, g + 7 + Math.floor(random(`rdy${i}`) * 17), 1, 1, "#2c2950");
  }
  for (let x = -24; x < W + 24; x += 24) {
    rect(out, x - ((tick * speed) % 24), g + 15, 12, 2, "#ffd24a");
  }
  // Roadside reflector posts whip past.
  for (let x = -40; x < W + 40; x += 40) {
    const px = x - ((tick * speed) % 40);
    rect(out, px, g - 2, 2, 8, "#d8dcea");
    rect(out, px, g - 1, 2, 2, "#ff3b30");
  }
};

const headlights = (out: Px[], x: number, y: number, tick: number, reach: number) => {
  for (let d = 0; d < reach; d++) {
    const spread = 1 + Math.floor(d / 5);
    if (d < 14 || (d + tick) % 2 === 0) {
      rect(out, x + d, y - Math.floor(spread / 2), 1, spread, "#fff2a8", Math.max(0.05, 0.42 - d * (0.37 / reach)));
    }
  }
};

// ------------------------------------------------------------------ pictures
const nightRoad: Art = (ctx) => {
  const out: Px[] = [];
  const { W, g, tick } = ctx;
  const U = Math.min(W, g);
  nightBackdrop(out, ctx, "nr");
  moon(out, W * 0.74, g * 0.24, U * 0.12, tick);
  hills(out, ctx, g - 4, U * 0.2, "#1d0f55", 1.3);
  treeline(out, ctx, "nr-far", g - 2, U * 0.2, "#150a3f", tick * 0.5);
  treeline(out, ctx, "nr-near", g + 2, U * 0.34, "#07041a", tick * 1.5, "#2a1466");
  glowEyes(out, W * 0.72, g - U * 0.16, tick, 6, 2);
  fireflies(out, ctx, "nr", 10, g - U * 0.2, g);
  road(out, ctx, 3);
  const carX = W * 0.1;
  headlights(out, carX + 49, g + 12, tick, Math.round(W * 0.42));
  for (let i = 0; i < 3; i++) {
    const age = (tick + i * 5) % 15;
    disc(out, carX - 3 - age * 2, g + 17 - age * 0.4, 1 + age * 0.2, "#8a80c8", Math.max(0, 0.3 - age * 0.02));
  }
  place(out, carFigure(tick), carX + 25, g + 22, tick);
  mist(out, ctx, g - 2, "#b9a8ff");
  return out;
};

const chase: Art = (ctx) => {
  const out: Px[] = [];
  const { W, g, tick } = ctx;
  const U = Math.min(W, g);
  nightBackdrop(out, ctx, "ch", false);
  moon(out, W * 0.16, g * 0.2, U * 0.08, tick);
  hills(out, ctx, g - 4, U * 0.18, "#1d0f55", 4.2 + tick * 0.01);
  treeline(out, ctx, "ch-far", g - 2, U * 0.2, "#150a3f", tick * 3);
  treeline(out, ctx, "ch-near", g + 2, U * 0.3, "#07041a", tick * 9, "#2a1466");
  road(out, ctx, 11);
  for (let i = 0; i < 12; i++) {
    const y = g - U * 0.5 + Math.floor(random(`sl${i}`) * U * 0.72);
    const len = 14 + (i % 4) * 9;
    rect(out, ((i * 53 - tick * 15) % (W + 60) + W + 60) % (W + 60) - 50, y, len, 1, i % 3 ? "#ffffff" : "#ff7ad9", 0.3);
  }
  const carX = W * 0.46;
  headlights(out, carX + 49, g + 12, tick, Math.round(W * 0.3));
  for (let i = 0; i < 5; i++) {
    const age = (tick * 2 + i * 3) % 15;
    disc(out, carX - 2 - age * 3, g + 20 - age * 0.5, 1 + age * 0.3, "#c9c0ff", Math.max(0, 0.35 - age * 0.022));
  }
  place(out, carFigure(tick * 2), carX + 25, g + 22, tick);
  // The pursuer, close behind and just above the roof, eyes streaking.
  const k = Math.min(0.5, U / 260);
  const fig = mothFigure(k, flapCycle(tick, 2));
  const mx = carX - W * 0.08 + Math.sin(tick * 0.2) * 3;
  const my = g - 6 + Math.cos(tick * 0.3) * 3;
  const { ox, oy } = place(out, fig, mx, my, tick);
  for (const [ex, ey] of fig.eyes) {
    for (let t = 1; t < 9; t++) {
      rect(out, ox + ex - t * 4, oy + ey, 4, 1, "#ff3b30", Math.max(0, 0.5 - t * 0.06));
    }
  }
  return out;
};

const tntArea: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  const U = Math.min(W, g);
  nightBackdrop(out, ctx, "tnt");
  moon(out, W * 0.2, g * 0.22, U * 0.1, tick);
  hills(out, ctx, g - 3, U * 0.16, "#1d0f55", 2.6);
  treeline(out, ctx, "tnt-far", g - 1, U * 0.24, "#11083a");
  // The derelict power plant.
  const px = Math.round(W * 0.6);
  const ph = Math.round(U * 0.42);
  const pw = Math.round(W * 0.36);
  rect(out, px, g - ph, pw, ph, "#1a1140");
  rect(out, px, g - ph, pw, 2, "#3b2a78");
  rect(out, px, g - ph, 2, ph, "#2b1d60");
  [0.12, 0.42, 0.72].forEach((f, i) => {
    const sx = px + Math.round(pw * f);
    const sh = Math.round(ph * (0.5 + i * 0.16));
    rect(out, sx, g - ph - sh, 7, sh, "#1a1140");
    rect(out, sx, g - ph - sh, 2, sh, "#2b1d60");
    rect(out, sx - 1, g - ph - sh, 9, 2, "#3b2a78");
    rect(out, sx, g - ph - sh + 6, 7, 2, "#b0243a");
    if (i === 1 && tick % 12 < 6) {
      disc(out, sx + 3, g - ph - sh - 2, 4, "#ff2244", 0.25);
      rect(out, sx + 2, g - ph - sh - 3, 3, 3, "#ff3b30");
    }
  });
  for (let wy = 0; wy < 4; wy++) {
    for (let wx = 0; wx < Math.floor(pw / 9); wx++) {
      const seed = random(`tw${wx}-${wy}`);
      const x = px + 5 + wx * 9;
      const y = g - ph + 7 + wy * Math.round(ph / 5);
      rect(out, x, y, 5, 6, seed > 0.85 ? "#4a3a8c" : "#07041a");
      if (seed < 0.3) {
        rect(out, x + 1, y + 1, 2, 2, "#1a1140"); // broken pane
      }
    }
  }
  rect(out, 0, g, W, H - g, "#0d1a14");
  for (let x = 0; x < W; x += 2) {
    rect(out, x, g - 1 - ((x * 5) % 3), 1, 3, x % 4 ? "#1d3a26" : "#2b5234");
  }
  // Grassed-over concrete igloos.
  [[0.16, 0.2], [0.4, 0.15]].forEach(([fx, fr], i) => {
    const cx = Math.round(W * fx);
    const r = Math.round(U * fr);
    for (let dy = -r; dy <= 0; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy));
      rect(out, cx - half, g + dy, half * 2 + 1, 1, dy < -r * 0.7 ? "#3f7a4a" : dy < -r * 0.35 ? "#2c5c38" : "#1f4429");
      if (dy % 2 === 0) {
        rect(out, cx - half + ((dy * 3 + 99) % 5), g + dy, 2, 1, "#56a05e");
      }
    }
    rect(out, cx - 6, g - 13, 13, 13, "#8a8fa0");
    rect(out, cx - 6, g - 13, 13, 2, "#b8bccb");
    rect(out, cx - 4, g - 11, 9, 11, "#05030f");
    rect(out, cx - 4, g - 11, 1, 11, "#3a3d4c");
    if (i === 0) {
      rect(out, cx + 10, g - 12, 12, 8, "#ffd24a");
      rect(out, cx + 15, g - 4, 2, 4, "#6b7080");
    }
  });
  // Chain-link fence with barbed top.
  for (let x = 0; x < W; x += 16) {
    rect(out, x, g - 11, 1, 12, "#5a5f78");
  }
  for (let x = 0; x < W; x++) {
    for (let y = g - 9; y < g; y++) {
      if ((x + y) % 4 === 0 || (x - y + 400) % 4 === 0) {
        rect(out, x, y, 1, 1, "#5a5f78", 0.45);
      }
    }
  }
  rect(out, 0, g - 11, W, 1, "#7d83a0");
  // Something is perched on the nearer igloo.
  const fig = mothFigure(Math.min(0.34, U / 420), 2);
  place(out, fig, W * 0.4, g - U * 0.15 + 2, tick);
  fireflies(out, ctx, "tnt", 8, g - U * 0.25, g);
  mist(out, ctx, g - 3, "#b9a8ff", 7);
  return out;
};

const mothmanPortrait: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  const U = Math.min(W, g);
  const cx = Math.round(W / 2);
  const my = Math.round(g * 0.42);
  nightBackdrop(out, ctx, "mm", false);
  sunburst(out, ctx, cx, my, 16, tick * 0.012, "#ff3fa4", 0.16, g, U * 0.3);
  sunburst(out, ctx, cx, my, 16, -tick * 0.008 + 0.2, "#59e0ff", 0.07, g, U * 0.3);
  moon(out, cx, my, U * 0.33, tick);
  hills(out, ctx, g - 2, U * 0.14, "#1d0f55", 0.4);
  treeline(out, ctx, "mm-far", g, U * 0.2, "#11083a");
  treeline(out, ctx, "mm-near", g + 3, U * 0.26, "#05030f", 0, "#2a1466");
  rect(out, 0, g + 3, W, H - g, "#05030f");
  const k = Math.min(W / 190, g / 124);
  const fig = mothFigure(k, flapCycle(tick, 5));
  const { ox, oy } = place(out, fig, cx, g + 4 + Math.sin(tick * 0.15) * 2, tick);
  // Twin beams fall from the eyes.
  for (const [ex, ey] of fig.eyes) {
    for (let d = 2; d < 26 * k; d++) {
      if ((d + tick) % 3 !== 0) {
        rect(out, ox + ex - Math.floor(d / 7), oy + ey + d, 1 + Math.floor(d / 4), 1, "#ff5a6a", Math.max(0, 0.22 - d * 0.006));
      }
    }
  }
  swarm(out, cx, my, 16, W * 0.44, g * 0.34, tick, "#ffe9a8", "mm");
  for (let i = 0; i < 6; i++) {
    sparkle(out, cx + Math.round(Math.cos(i * 1.05 + tick * 0.02) * U * 0.46), my + Math.round(Math.sin(i * 1.05 + tick * 0.02) * U * 0.4),
      tick + i * 3, i % 2 ? "#59e0ff" : "#ff7ad9", 3);
  }
  mist(out, ctx, g + 1, "#b9a8ff", 7);
  return out;
};

const paperBox = ({ W, g, tick }: ArtContext) => {
  const wide = g < 120; // landscape: wide front page, photo beside the headline
  const w = Math.min(W - 16, wide ? 250 : 152);
  const h = Math.min(g - 8, wide ? 88 : 142);
  const rise = Math.max(0, 24 - tick * 4); // slides up into place in whole pixels
  return { x: Math.round((W - w) / 2), y: Math.round((g - h) / 2) + 3 + rise, w, h, wide };
};

const newspaper: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, tick } = ctx;
  // A wooden desk under a warm lamp.
  rect(out, 0, 0, W, H, "#3a2416");
  for (let y = 0; y < H; y += 13) {
    rect(out, 0, y, W, 1, "#24150c");
    for (let x = (y * 7) % 31; x < W; x += 31) {
      rect(out, x, y + 3 + ((x * 3) % 7), 9 + (x % 6), 1, "#4a2f1c");
    }
  }
  disc(out, W * 0.5, H * 0.2, Math.min(W, H) * 0.55, "#ffb23d", 0.07);
  const p = paperBox(ctx);
  rect(out, p.x + 3, p.y + 3, p.w, p.h, "#000000", 0.4);
  rect(out, p.x, p.y, p.w, p.h, "#efe4c8");
  rect(out, p.x, p.y, p.w, 1, "#fff8e6");
  rect(out, p.x + p.w - 2, p.y, 2, p.h, "#d4c7a6");
  rect(out, p.x + 4, p.y + 16, p.w - 8, 1, "#1a1a1a");
  rect(out, p.x + 4, p.y + 18, p.w - 8, 2, "#1a1a1a");
  const photoX = p.wide ? p.x + p.w - 74 : p.x + 8;
  const photoY = p.wide ? p.y + 26 : p.y + 76;
  const photoW = p.wide ? 66 : 58;
  const photoH = p.wide ? 44 : 44;
  rect(out, photoX, photoY, photoW, photoH, "#2a2a2a");
  rect(out, photoX + 1, photoY + 1, photoW - 2, photoH - 2, "#0d0d12");
  for (let i = 0; i < 9; i++) {
    rect(out, photoX + 3 + i * 6, photoY + photoH - 9 - ((i * 5) % 6), 5, 8 + ((i * 5) % 6), "#1c1c26");
  }
  const sil = mothFigure(0.2, 0, { ...MOTH_DARK, body: "#000000", wing: "#050508", wingHi: "#101018", wingLo: "#000000", rib: "#101018", fur: "#101018", bodyHi: "#050508" });
  place(out, sil, photoX + photoW / 2, photoY + photoH - 6, tick, "#ff3b30");
  const columns = p.wide
    ? [[p.x + 8, p.y + 66, p.w - 96], [photoX, photoY + photoH + 4, photoW]]
    : [[p.x + 72, photoY, p.w - 82], [p.x + 8, photoY + photoH + 5, p.w - 18]];
  columns.forEach(([cx, cy, cw]) => {
    for (let y = cy; y < p.y + p.h - 5; y += 3) {
      rect(out, cx, y, cw - ((y * 7) % 11), 1, "#8e846e");
    }
  });
  // Flashbulbs pop around the page.
  for (let i = 0; i < 4; i++) {
    if ((tick + i * 7) % 28 < 3) {
      sparkle(out, i % 2 ? p.x - 4 : p.x + p.w + 3, p.y + 10 + i * Math.round(p.h / 4), 4, "#ffffff", 5);
    }
  }
  return out;
};

const town: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  const U = Math.min(W, g);
  nightBackdrop(out, ctx, "tn");
  moon(out, W * 0.24, g * 0.2, U * 0.1, tick);
  // A winged shape drifts across the sky.
  const flyer = mothFigure(Math.min(0.26, U / 520), flapCycle(tick, 3));
  place(out, flyer, W * 0.2 + ((tick * 0.9) % (W * 0.9)), g * 0.26 + Math.sin(tick * 0.1) * 4, tick);
  for (let x = 0; x < W; x += 9) {
    const h = U * (0.3 + random(`far${x}`) * 0.25);
    rect(out, x, g - h, 9, h, "#150a45");
  }
  let x = 0;
  let i = 0;
  const neon = tick % 20 < 14;
  while (x < W) {
    const w = 26 + Math.floor(random(`bw${i}`) * 22);
    const h = Math.round(U * (0.34 + random(`bh${i}`) * 0.34));
    const wall = ["#2a1a5c", "#221550", "#33206a", "#1c1148"][i % 4];
    rect(out, x, g - h, w, h, wall);
    rect(out, x, g - h, w, 3, "#5a3fa8");
    rect(out, x, g - h + 3, w, 1, "#120a33");
    rect(out, x, g - h, 2, h, "#3d2880");
    for (let wy = g - h + 8; wy < g - 20; wy += 11) {
      for (let wx = x + 4; wx < x + w - 6; wx += 8) {
        const seed = random(`win${i}-${wx}-${wy}`);
        const lit = seed > 0.4 && Math.floor(tick / 24 + seed * 9) % 8 !== 0;
        rect(out, wx, wy, 5, 7, lit ? (seed > 0.8 ? "#ff9ad5" : "#ffd24a") : "#090524");
        if (lit) {
          rect(out, wx, wy, 5, 1, "#fff2a8");
          if (seed > 0.7) {
            rect(out, wx + 1, wy + 3, 2, 4, "#2a1a5c"); // someone at the window
          }
        }
        rect(out, wx - 1, wy + 7, 7, 1, "#120a33");
      }
    }
    // Shopfront, awning and (on some) a neon sign.
    rect(out, x + 2, g - 16, w - 4, 16, "#0d0730");
    rect(out, x + 4, g - 13, w - 8, 9, i % 3 === 0 ? "#ffb23d" : "#3fd0c9", 0.75);
    for (let ax = x + 1; ax < x + w - 1; ax += 4) {
      rect(out, ax, g - 19, 2, 3, i % 2 ? "#ff3fa4" : "#59e0ff");
      rect(out, ax + 2, g - 19, 2, 3, "#f4f1e4");
    }
    if (i % 3 === 1) {
      rect(out, x + w - 8, g - h + 6, 6, Math.min(h - 30, 34), "#0d0730");
      rect(out, x + w - 7, g - h + 7, 4, Math.min(h - 32, 32), neon ? "#ff3fa4" : "#5a1840");
      if (neon) {
        rect(out, x + w - 10, g - h + 4, 10, Math.min(h - 26, 38), "#ff3fa4", 0.14);
      }
    }
    x += w;
    i++;
  }
  // Wet street with reflections, lamps, wires and people looking up.
  rect(out, 0, g, W, H - g, "#120a33");
  rect(out, 0, g, W, 2, "#3d2880");
  for (let r = 0; r < 60; r++) {
    const rx = Math.floor(random(`rf${r}`) * W);
    rect(out, rx, g + 3 + Math.floor(random(`rfy${r}`) * 22), 2 + (r % 4), 1, ["#ffd24a", "#ff3fa4", "#59e0ff"][r % 3], 0.3);
  }
  for (let lx = 14; lx < W; lx += 58) {
    rect(out, lx, g - 26, 2, 26, "#6b6f8c");
    rect(out, lx - 2, g - 29, 6, 4, "#fff2a8");
    for (let d = 0; d < 20; d++) {
      rect(out, lx - 1 - d / 3, g - 25 + d, 4 + (d * 2) / 3, 1, "#fff2a8", Math.max(0.02, 0.16 - d * 0.007));
    }
    for (let wx = 0; wx < 58 && lx + wx < W; wx += 2) {
      rect(out, lx + wx, g - 27 + Math.round(Math.sin((wx / 58) * Math.PI) * 4), 2, 1, "#07041a");
    }
  }
  [0.3, 0.38, 0.62, 0.8].forEach((f, n) => {
    place(out, personFigure(n % 2 ? 1 : (Math.floor(tick / 10) + n) % 2 ? 2 : 0, "#05030f"), W * f, g + 6 + (n % 2), tick);
  });
  return out;
};

const river = (out: Px[], { W, H, g, tick }: ArtContext, base: string, deep: string, light: string, glow?: string) => {
  rect(out, 0, g, W, H - g, base);
  rect(out, 0, g + (H - g) * 0.45, W, (H - g) * 0.55, deep);
  for (let x = 0; x < W; x += 2) {
    rect(out, x + 1, g + Math.round((H - g) * 0.45) - 1, 1, 1, deep);
  }
  for (let i = 0; i < 110; i++) {
    const y = g + 2 + Math.floor(random(`ry${i}`) * (H - g - 3));
    const x = (Math.floor(random(`rx${i}`) * W) + Math.floor(tick / 3) * (i % 2 ? 1 : -1) + W * 9) % W;
    rect(out, x, y, 3 + (i % 5), 1, light, 0.3);
  }
  if (glow) {
    // The sun's path on the water.
    for (let y = g + 1; y < H; y += 2) {
      const half = 6 + (y - g) * 0.35 + Math.sin(tick * 0.2 + y) * 3;
      rect(out, W / 2 - half, y, half * 2, 1, glow, 0.5);
    }
  }
};

const bridgeFrame = (out: Px[], { W, g }: ArtContext, deckY: number, steel: string, steelHi: string, chain: string) => {
  const t1 = Math.round(W * 0.26);
  const t2 = Math.round(W * 0.74);
  const towerTop = deckY - Math.round(Math.min(W, g) * 0.46);
  const chainY = (x: number) => {
    if (x < t1) {
      return deckY - 3 - (deckY - 3 - towerTop) * Math.pow(x / t1, 1.7);
    }
    if (x > t2) {
      return deckY - 3 - (deckY - 3 - towerTop) * Math.pow((W - x) / (W - t2), 1.7);
    }
    const k = (x - t1) / (t2 - t1);
    return towerTop + (deckY - 8 - towerTop) * 4 * k * (1 - k);
  };
  for (let x = 0; x < W; x++) {
    const y = Math.round(chainY(x));
    // Eyebar chain: two bars with a pin at every link.
    rect(out, x, y, 1, 1, chain);
    rect(out, x, y + 2, 1, 1, chain, 0.8);
    if (x % 5 === 0) {
      rect(out, x, y, 1, 3, steelHi);
      rect(out, x, y + 3, 1, deckY - y - 3, chain, 0.55);
    }
  }
  for (const tx of [t1, t2]) {
    rect(out, tx - 4, towerTop - 3, 2, g - towerTop + 8, steel);
    rect(out, tx + 3, towerTop - 3, 2, g - towerTop + 8, steel);
    rect(out, tx - 4, towerTop - 3, 1, g - towerTop + 8, steelHi);
    for (let y = towerTop; y < g; y += 9) {
      rect(out, tx - 4, y, 9, 1, steel);
      for (let d = 0; d < 7; d++) {
        rect(out, tx - 3 + d, y + 1 + d, 1, 1, steel, 0.8);
        rect(out, tx + 3 - d, y + 1 + d, 1, 1, steel, 0.8);
      }
    }
    rect(out, tx - 5, towerTop - 6, 11, 3, steelHi);
    rect(out, tx, towerTop - 10, 1, 4, steelHi);
    rect(out, tx - 6, g, 13, 8, "#5c5f72");
    rect(out, tx - 6, g, 13, 2, "#8a8fa8");
  }
  rect(out, 0, deckY, W, 3, steel);
  rect(out, 0, deckY, W, 1, steelHi);
  for (let x = 0; x < W; x += 6) {
    for (let d = 0; d < 4; d++) {
      rect(out, x + d, deckY + 3 + d, 1, 1, steel, 0.75);
      rect(out, x + 5 - d, deckY + 3 + d, 1, 1, steel, 0.75);
    }
  }
  rect(out, 0, deckY + 7, W, 1, steel);
  return { t1, t2, towerTop };
};

const bridge: Art = (ctx) => {
  const out: Px[] = [];
  const { W, g, tick } = ctx;
  const U = Math.min(W, g);
  sky(out, ctx, DUSK);
  // A low sun sliced by bands of cloud.
  const sunR = Math.round(U * 0.24);
  disc(out, W / 2, g - 2, sunR + 8, "#ffc857", 0.18);
  disc(out, W / 2, g - 2, sunR, "#ffe98f");
  disc(out, W / 2, g + sunR * 0.3, sunR * 0.92, "#ff8a4c", 0.5);
  for (let s = 0; s < 5; s++) {
    rect(out, W / 2 - sunR, g - 4 - s * s * 2.2 - s * 3, sunR * 2, 1 + Math.floor(s / 2), DUSK[4 + (s > 2 ? 0 : 1)]);
  }
  for (let i = 0; i < 4; i++) {
    const x = ((i * 97 + Math.floor(tick / 6)) % (W + 80)) - 50;
    cloud(out, x, g * (0.14 + i * 0.13), 5 + (i % 2) * 2, "#ff7ab8", "#b02a8f", 0.85);
  }
  for (let i = 0; i < 7; i++) {
    const bx = ((tick * 1.3 + i * 9) % (W + 40)) - 20;
    const by = g * 0.3 + Math.abs(i - 3) * 4 + Math.sin(tick * 0.2 + i) * 1.5;
    const up = (tick + i) % 4 < 2;
    rect(out, bx, by, 1, 1, "#170a3d");
    rect(out, bx - 1, by + (up ? -1 : 1), 1, 1, "#170a3d");
    rect(out, bx + 1, by + (up ? -1 : 1), 1, 1, "#170a3d");
  }
  hills(out, ctx, g, U * 0.1, "#3a1069", 3.3);
  rect(out, 0, g - 7, W * 0.2, 7, "#1f0d4a");
  rect(out, W * 0.8, g - 9, W * 0.2 + 1, 9, "#1f0d4a");
  river(out, ctx, "#3a1a7a", "#22104f", "#ff8a4c", "#ffc857");
  // A towboat pushes upriver.
  const boatX = ((tick * 0.5) % (W + 60)) - 40;
  rect(out, boatX, g + 16, 30, 4, "#0d0730");
  rect(out, boatX + 18, g + 10, 9, 6, "#f4f1e4");
  rect(out, boatX + 21, g + 5, 2, 5, "#0d0730");
  disc(out, boatX + 19 - (tick % 10), g + 2 - (tick % 10) * 0.5, 2, "#c9c0ff", 0.35);
  const deckY = g - Math.round(U * 0.16);
  bridgeFrame(out, ctx, deckY, "#c4c9d8", "#f4f8ff", "#e9edf6");
  for (let lx = 8; lx < W; lx += 22) {
    rect(out, lx, deckY - 6, 1, 6, "#8a8fa8");
    rect(out, lx - 1, deckY - 7, 3, 2, "#fff2a8");
    rect(out, lx - 3, deckY - 9, 7, 6, "#fff2a8", 0.14);
  }
  // Rush hour in both directions.
  for (let i = 0; i < 14; i++) {
    const dir = i % 2 ? 1 : -1;
    const x = (((i * 31 + tick * dir * (1 + (i % 3) * 0.4)) % (W + 16)) + W + 16) % (W + 16) - 8;
    const body = ["#e0262b", "#1fb5a8", "#f4f1e4", "#ffb23d", "#3a6fe0"][i % 5];
    rect(out, x, deckY - 3, 7, 3, body);
    rect(out, x + 1, deckY - 5, 5, 2, body);
    rect(out, x + 2, deckY - 5, 3, 1, "#170a3d");
    rect(out, dir > 0 ? x + 7 : x - 1, deckY - 2, 1, 1, "#fff2a8");
    rect(out, dir > 0 ? x - 1 : x + 7, deckY - 2, 1, 1, "#ff2a3d");
  }
  return out;
};

const collapse: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  const U = Math.min(W, g);
  sky(out, ctx, COLD);
  stars(out, ctx, "co", Math.round(W * 0.2));
  hills(out, ctx, g, U * 0.1, "#0a0e2c", 3.3);
  rect(out, 0, g - 7, W * 0.2, 7, "#070a1e");
  rect(out, W * 0.8, g - 9, W * 0.2 + 1, 9, "#070a1e");
  river(out, ctx, "#0f1640", "#080c26", "#9fb0ff");
  const deckY = g - Math.round(U * 0.16);
  const t1 = Math.round(W * 0.26);
  const t2 = Math.round(W * 0.74);
  const steel = "#8d93a8";
  // Searchlights sweep from both banks.
  [[W * 0.05, 1], [W * 0.95, -1]].forEach(([sx, dir], n) => {
    const angle = 0.5 + Math.sin(tick * 0.04 + n * 2) * 0.25;
    for (let d = 4; d < W * 0.6; d++) {
      const x = sx + dir * d;
      const y = g - 8 + Math.sin(angle) * d * 0.25 * (n ? 1 : 0.8) + 4;
      if ((d + tick) % 2 === 0) {
        rect(out, x, y - d * 0.05, 1, 1 + d * 0.1, "#e9f0ff", Math.max(0.02, 0.2 - d * 0.0012));
      }
    }
    rect(out, sx - 2, g - 10, 4, 3, "#e9f0ff");
  });
  // What still stands: the approaches, one leaning tower, a stump.
  rect(out, 0, deckY, t1 - 10, 3, steel);
  rect(out, t2 + 12, deckY, W - t2 - 12, 3, steel);
  for (let x = 0; x < t1 - 10; x += 6) {
    for (let d = 0; d < 4; d++) {
      rect(out, x + d, deckY + 3 + d, 1, 1, steel, 0.7);
    }
  }
  const lean = Math.round(U * 0.38);
  for (let y = 0; y < lean; y++) {
    const sx = t1 + Math.round(y * 0.32);
    rect(out, sx - 4, g - y, 2, 1, steel);
    rect(out, sx + 3, g - y, 2, 1, steel);
    if (y % 9 === 0) {
      rect(out, sx - 4, g - y, 9, 1, steel);
    }
  }
  for (let d = 0; d < 26; d++) {
    rect(out, t1 + Math.round(lean * 0.32) + d, g - lean + Math.round(d * d * 0.05), 1, 1, "#b8bed0"); // snapped chain
  }
  rect(out, t1 - 6, g, 13, 8, "#4a4d60");
  rect(out, t2 - 6, g, 13, 8, "#4a4d60");
  rect(out, t2 - 4, g - 14, 9, 14, steel);
  rect(out, t2 - 4, g - 14, 2, 14, "#b8bed0");
  // Deck sections half under water, rocking gently.
  ([[0.34, 3, 0.5, 22], [0.48, 7, -0.25, 26], [0.61, 4, 0.4, 20]] as Array<[number, number, number, number]>).forEach(([fx, depth, slope, len], n) => {
    const bobY = Math.round(Math.sin(tick * 0.08 + n * 2));
    for (let d = 0; d < len; d++) {
      rect(out, W * fx + d, g + depth + bobY + Math.round(d * slope), 1, 3, steel);
      rect(out, W * fx + d, g + depth + bobY + Math.round(d * slope), 1, 1, "#b8bed0");
    }
  });
  for (let i = 0; i < 6; i++) {
    const cx = W * (0.34 + i * 0.065);
    const r = 2 + ((tick + i * 4) % 18);
    rect(out, cx - r, g + 6 + (i % 3) * 5, r * 2, 1, "#c9d2ff", Math.max(0, 0.45 - r * 0.024));
  }
  // A rescue boat with a lantern.
  const bx = W * 0.5 + Math.sin(tick * 0.03) * W * 0.12;
  rect(out, bx - 9, g + 22, 18, 3, "#070a1e");
  rect(out, bx - 2, g + 18, 4, 4, "#070a1e");
  disc(out, bx + 6, g + 19, 5, "#ffd24a", 0.14);
  rect(out, bx + 5, g + 18, 2, 2, "#ffd24a");
  snow(out, ctx, "co", Math.round((W * H) / 420));
  rect(out, 0, 0, W, H, "#0a1030", 0.12);
  return out;
};

const crane: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  const U = Math.min(W, g);
  sky(out, ctx, MARSH);
  const sunX = W * 0.8;
  sunburst(out, ctx, sunX, g - 4, 20, tick * 0.006, "#fff2a8", 0.12, g, 10);
  disc(out, sunX, g - 4, U * 0.13 + 4, "#fff2a8", 0.25);
  disc(out, sunX, g - 4, U * 0.13, "#fff8d6");
  for (let i = 0; i < 3; i++) {
    cloud(out, ((i * 119 + Math.floor(tick / 8)) % (W + 80)) - 50, g * (0.16 + i * 0.14), 5 + i, "#ffe3c9", "#f0a890", 0.8);
  }
  hills(out, ctx, g - 2, U * 0.16, "#1f5c6e", 5.1);
  treeline(out, ctx, "cr-far", g, U * 0.14, "#123f4a");
  rect(out, 0, g, W, H - g, "#0f3a34");
  for (let i = 0; i < 9; i++) {
    const py = g + 5 + i * 4;
    rect(out, (i * 53) % W - 20, py, 60 + (i % 3) * 30, 2, "#63bfae", 0.35);
    rect(out, ((i * 53) % W) - 10 + Math.sin(tick * 0.1 + i) * 3, py, 20, 1, "#fff8d6", 0.4);
  }
  // A dead tree with an owl watching from a branch.
  const tx = Math.round(W * 0.12);
  rect(out, tx, g - U * 0.62, 5, U * 0.62 + 2, "#2a1c12");
  rect(out, tx, g - U * 0.62, 2, U * 0.62 + 2, "#4a321f");
  for (let d = 0; d < U * 0.24; d++) {
    rect(out, tx + 5 + d, g - U * 0.42 - d * 0.3, 1, 2, "#2a1c12");
    rect(out, tx - d * 0.7, g - U * 0.5 - d * 0.5, 1, 2, "#2a1c12");
  }
  place(out, owlFigure(tick), tx + 5 + U * 0.14, g - U * 0.42 - U * 0.14 * 0.3 + 1, tick);
  const bird = craneFigure(tick);
  place(out, bird, W * 0.52, g + 8, tick);
  // Reeds and cattails sway in front.
  for (let x = 0; x < W; x += 3) {
    const h = 6 + Math.floor(random(`reed${x}`) * U * 0.16);
    const sway = Math.round(Math.sin(tick * 0.12 + x * 0.3) * (h / 9));
    rect(out, x + sway, g + 9 - h, 1, h, x % 2 ? "#2f8a4a" : "#1f6b3a");
    if (x % 15 === 0) {
      rect(out, x + sway - 1, g + 6 - h, 3, 5, "#6b4a2f");
    }
  }
  for (let i = 0; i < 4; i++) {
    const dx = W * (0.2 + i * 0.2) + Math.sin(tick * 0.13 + i * 3) * 14;
    const dy = g - U * (0.2 + (i % 2) * 0.18) + Math.cos(tick * 0.17 + i) * 6;
    rect(out, dx - 2, dy, 5, 1, "#59e0ff");
    rect(out, dx, dy - (tick % 2), 1, 1, "#ffffff", 0.8);
  }
  // Floating question marks.
  const q = ["yyyy.", "y...y", "....y", "..yy.", "..y..", ".....", "..y.."];
  [[0.76, 0.42, 3], [0.88, 0.28, 2], [0.68, 0.24, 2]].forEach(([fx, fy, s], n) => {
    if ((tick + n * 6) % 22 < 17) {
      const oy = g * fy + Math.sin(tick * 0.15 + n) * 3;
      q.forEach((row, ry) => {
        for (let i = 0; i < row.length; i++) {
          if (row[i] === "y") {
            rect(out, W * fx + i * s + 1, oy + ry * s + 1, s, s, "#0c1420");
            rect(out, W * fx + i * s, oy + ry * s, s, s, "#ffd24a");
          }
        }
      });
    }
  });
  return out;
};

const statue: Art = (ctx) => {
  const out: Px[] = [];
  const { W, H, g, tick } = ctx;
  const U = Math.min(W, g);
  const cx = Math.round(W / 2);
  sky(out, ctx, DAY);
  sunburst(out, ctx, cx, g * 0.5, 18, tick * 0.01, "#ffffff", 0.2, g);
  sunburst(out, ctx, cx, g * 0.5, 18, tick * 0.01 + 0.09, "#ffd24a", 0.12, g);
  for (let i = 0; i < 4; i++) {
    cloud(out, ((i * 101 + Math.floor(tick / 5)) % (W + 80)) - 50, g * (0.12 + (i % 3) * 0.12), 5 + (i % 2) * 2, "#ffffff", "#bfe3ff", 0.95);
  }
  let x = 0;
  let i = 0;
  while (x < W) {
    const w = 28 + Math.floor(random(`sb${i}`) * 20);
    const h = Math.round(U * (0.28 + random(`sh${i}`) * 0.22));
    const wall = ["#d0452f", "#f0a83a", "#a05a8c", "#3f9e8a", "#c96a3a"][i % 5];
    rect(out, x, g - h, w, h, wall);
    rect(out, x, g - h, w, 3, "#ffffff", 0.35);
    rect(out, x + w - 3, g - h, 3, h, "#000000", 0.18);
    for (let wy = g - h + 7; wy < g - 20; wy += 11) {
      for (let wx = x + 4; wx < x + w - 7; wx += 9) {
        rect(out, wx, wy, 6, 7, "#dff4ff");
        rect(out, wx, wy, 6, 2, "#ffffff");
        rect(out, wx + 3, wy, 1, 7, wall);
      }
    }
    rect(out, x + 3, g - 15, w - 6, 15, "#2a1c3f");
    for (let ax = x + 1; ax < x + w - 1; ax += 4) {
      rect(out, ax, g - 18, 2, 4, i % 2 ? "#e0262b" : "#1a63dc");
      rect(out, ax + 2, g - 18, 2, 4, "#ffffff");
    }
    x += w;
    i++;
  }
  rect(out, 0, g, W, H - g, "#9aa0b0");
  rect(out, 0, g, W, 2, "#c9cedc");
  for (let px = 0; px < W; px += 12) {
    rect(out, px, g + 2, 1, H - g, "#868c9c", 0.5);
  }
  // Pedestal and the stainless-steel statue, glinting.
  rect(out, cx - 16, g - 14, 33, 14, "#7d8394");
  rect(out, cx - 16, g - 14, 33, 2, "#b8bed0");
  rect(out, cx - 19, g - 3, 39, 5, "#5c6274");
  rect(out, cx - 9, g - 10, 19, 5, "#c9a24a");
  const k = Math.min(W / 230, g / 150);
  const fig = mothFigure(k, 0, MOTH_STEEL);
  const { ox, oy } = place(out, fig, cx, g - 13, tick, "#ff5a4a");
  for (let s = 0; s < 5; s++) {
    sparkle(out, ox + Math.floor(random(`gl${s}`) * fig.G.w), oy + Math.floor(random(`gly${s}`) * fig.G.h * 0.6), tick + s * 4, "#ffffff", 4);
  }
  // Bunting, balloons and confetti.
  const colors = ["#e0262b", "#ffd24a", "#2fbf71", "#1a63dc", "#ff3fa4"];
  for (const [row, depth] of [[5, 9], [16, 6]] as Array<[number, number]>) {
    for (let bx = 0; bx < W; bx += 7) {
      const y = row + Math.round(Math.sin((bx / W) * Math.PI) * depth) + (((tick >> 2) + bx) % 2);
      const c = colors[((bx / 7) + row) % colors.length];
      rect(out, bx, y, 6, 1, "#2a1c3f");
      rect(out, bx, y + 1, 6, 2, c);
      rect(out, bx + 1, y + 3, 4, 1, c);
      rect(out, bx + 2, y + 4, 2, 1, c);
    }
  }
  for (let b = 0; b < 6; b++) {
    const bx = W * (0.08 + b * 0.17) + Math.sin(tick * 0.06 + b) * 4;
    const by = g * 0.75 - ((tick * (0.5 + (b % 3) * 0.2) + b * 23) % (g * 0.8));
    disc(out, bx, by, 4, colors[b % colors.length]);
    rect(out, bx - 2, by - 2, 1, 2, "#ffffff", 0.7);
    rect(out, bx, by + 4, 1, 8, "#2a1c3f", 0.6);
  }
  for (let c = 0; c < Math.round(W * 0.35); c++) {
    const fx = (Math.floor(random(`cf${c}`) * W) + Math.round(Math.sin(tick * 0.1 + c) * 3) + W) % W;
    const fy = Math.floor(random(`cfy${c}`) * g + tick * (0.6 + random(`cfv${c}`) * 0.8)) % Math.round(g);
    rect(out, fx, fy, (tick + c) % 4 < 2 ? 2 : 1, 1, colors[c % colors.length]);
  }
  // The festival crowd along the bottom, arms and cameras up.
  for (let p = 0; p < W / 9; p++) {
    const pose = (Math.floor(tick / 6) + p * 3) % 5 === 0 ? 2 : p % 3 === 0 ? 1 : 0;
    place(out, personFigure(pose, p % 2 ? "#2a1c3f" : "#3d2a5c"), p * 9 + 4, g + 14 + (p % 2) + ((tick + p) % 8 < 2 ? -1 : 0), tick);
    if ((tick + p * 5) % 34 === 0) {
      sparkle(out, p * 9 + 6, g + 1, 4, "#ffffff", 4);
    }
  }
  return out;
};

export const ART: Record<string, Art> = {
  "night-road": nightRoad,
  chase,
  "tnt-area": tntArea,
  mothman: mothmanPortrait,
  newspaper,
  town,
  bridge,
  collapse,
  crane,
  statue,
};

/** Pixel-font text drawn on top of a picture (SVG text in logical pixels, centred on x). */
export const LABELS: Record<string, (ctx: ArtContext) => Label[]> = {
  newspaper: (ctx) => {
    const p = paperBox(ctx);
    const cx = p.x + p.w / 2;
    const headX = p.wide ? p.x + (p.w - 82) / 2 + 4 : cx;
    const size = p.wide ? 8 : 7;
    const top = p.y + (p.wide ? 34 : 33);
    return [
      { x: cx, y: p.y + 12, size: 6, text: "POINT PLEASANT REGISTER", c: "#1a1a1a" },
      ...["COUPLES SEE", "MAN-SIZED BIRD...", "CREATURE...", "SOMETHING"].map((text, i) => ({
        x: headX, y: top + i * (size + 3), size, text, c: "#0d0d0d",
      })),
    ];
  },
  "tnt-area": ({ W, g }) => [{ x: Math.round(W * 0.16) + 16, y: g - 6, size: 3.2, text: "TNT", c: "#1a1a1a" }],
  statue: ({ W, g }) => [{ x: Math.round(W / 2), y: g - 6, size: 3, text: "MOTHMAN", c: "#3a2a0a" }],
};
