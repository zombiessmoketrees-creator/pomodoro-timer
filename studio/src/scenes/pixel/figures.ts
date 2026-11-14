import { type Grid, gellipse, gget, gline, goutline, grect, grid, gset } from "./toolkit";

/** Outlined, shaded sprites painted procedurally so they can be drawn at any size and pose. */

export type MothPalette = {
  body: string;
  bodyHi: string;
  fur: string;
  wing: string;
  wingHi: string;
  wingLo: string;
  rib: string;
  eyes: [string, string, string];
  outline: string;
};

export const MOTH_DARK: MothPalette = {
  body: "#2b1c44", bodyHi: "#4a3273", fur: "#7b5fb0", wing: "#3a2463", wingHi: "#5b3a94", wingLo: "#24153f",
  rib: "#9b6cff", eyes: ["#ff1f3d", "#ff8a2b", "#fff2a8"], outline: "#07040f",
};
export const MOTH_STEEL: MothPalette = {
  body: "#aeb9c9", bodyHi: "#e6eef8", fur: "#ffffff", wing: "#93a0b4", wingHi: "#d4deec", wingLo: "#6f7c92",
  rib: "#f4f9ff", eyes: ["#d3202a", "#ff5a4a", "#ffd0c8"], outline: "#2c3444",
};

export type Figure = { G: Grid; ax: number; ay: number; eyes: Array<[number, number]>; eyeR: number };

/**
 * The creature: a neckless furred body, feathered antennae and ribbed, scalloped wings.
 * `k` scales it (1 = about 170 x 110 px); `flap` is 0 (wings high), 1 (level) or 2 (wings low).
 */
export const mothFigure = (k: number, flap: number, pal: MothPalette = MOTH_DARK): Figure => {
  const span = Math.round(74 * k);
  const w = span * 2 + Math.round(30 * k);
  const h = Math.round(112 * k);
  const G = grid(w, h);
  const cx = Math.round(w / 2);
  const sh = Math.round(46 * k); // shoulder height
  const rise = [34, 12, -12][flap] * k;
  const arch = [10, 7, 4][flap] * k;
  const bodyHalf = Math.max(2, Math.round(9 * k));
  const scallops = 5;

  const wingEdge = (d: number) => {
    const t = d / span;
    const top = sh - rise * Math.sin(t * Math.PI * 0.5) - arch * Math.sin(t * Math.PI);
    const u = (t * scallops) % 1;
    const membrane = 46 * k * (1 - Math.pow(t, 1.6) * 0.88);
    const bottom = top + membrane - 9 * k * Math.sin(u * Math.PI) * (1 - t * 0.5);
    return { top, bottom };
  };

  for (const side of [-1, 1]) {
    for (let d = 1; d <= span; d++) {
      const { top, bottom } = wingEdge(d);
      const x = cx + side * (bodyHalf - 1 + d);
      const height = Math.max(1, bottom - top);
      for (let y = Math.round(top); y <= Math.round(bottom); y++) {
        const v = (y - top) / height;
        let c = v < 0.22 ? pal.wingHi : v > 0.8 ? pal.wingLo : pal.wing;
        // Dithered shading between the tones, plus a faint membrane texture.
        if ((v > 0.18 && v < 0.3 && (x + y) % 2 === 0) || (v > 0.72 && v < 0.84 && (x + y) % 2 === 0)) {
          c = v < 0.5 ? pal.wing : pal.wingLo;
        }
        if (k >= 0.5 && (x * 3 + y * 5) % 17 === 0 && v > 0.3 && v < 0.75) {
          c = pal.wingLo;
        }
        gset(G, x, y, c);
      }
    }
    // Ribs fan from the shoulder to each scallop point.
    for (let s = 1; s <= scallops; s++) {
      const d = Math.min(span, Math.round((s / scallops) * span));
      const { top, bottom } = wingEdge(d);
      gline(G, cx + side * bodyHalf, sh + 2 * k, cx + side * (bodyHalf - 1 + d), s === scallops ? top : bottom, pal.rib);
    }
  }

  // Body, head and chest ruff.
  gellipse(G, cx, sh + 26 * k, 10 * k, 30 * k, pal.body);
  gellipse(G, cx, sh - 2 * k, 9 * k, 9 * k, pal.body);
  gellipse(G, cx - 2 * k, sh + 22 * k, 5 * k, 20 * k, pal.bodyHi);
  for (let x = -bodyHalf; x <= bodyHalf; x++) {
    const zig = Math.abs((x + 100) % 4 - 2);
    gset(G, cx + x, sh + 9 * k + zig, pal.fur);
    if (k >= 0.5) {
      gset(G, cx + x, sh + 13 * k + zig, pal.fur);
      gset(G, cx + x, sh + 17 * k + (2 - zig), pal.bodyHi);
    }
  }
  // Fur flecks down the belly.
  if (k >= 0.5) {
    for (let y = 22; y < 50; y += 4) {
      for (let x = -6; x <= 6; x += 3) {
        if ((x + y) % 2 === 0 && gget(G, Math.round(cx + x * k), Math.round(sh + y * k))) {
          gset(G, cx + x * k, sh + y * k, pal.fur);
        }
      }
    }
  }
  // Feathered antennae.
  for (const side of [-1, 1]) {
    gline(G, cx + side * 3 * k, sh - 9 * k, cx + side * 15 * k, sh - 24 * k, pal.fur);
    for (let t = 0.3; t <= 1; t += 0.23) {
      const x = cx + side * (3 + 12 * t) * k;
      const y = sh - (9 + 15 * t) * k;
      gline(G, x, y, x + side * 3 * k, y + 1 * k, pal.bodyHi);
    }
    // Legs and claws.
    gline(G, cx + side * 4 * k, sh + 52 * k, cx + side * 6 * k, sh + 63 * k, pal.body, Math.max(1, Math.round(2 * k)));
    for (const claw of [-2, 0, 2]) {
      gline(G, cx + side * 6 * k, sh + 63 * k, cx + side * 6 * k + claw * k, sh + 66 * k, pal.fur);
    }
  }
  goutline(G, pal.outline);

  // Eyes are painted after the outline so they stay bright right to the edge.
  const eyeR = Math.max(1, 4 * k);
  const eyes: Array<[number, number]> = [];
  for (const side of [-1, 1]) {
    const ex = cx + side * 5 * k;
    const ey = sh - 1 * k;
    gellipse(G, ex, ey, eyeR, eyeR, pal.eyes[0]);
    if (eyeR >= 2) {
      gellipse(G, ex, ey, eyeR * 0.6, eyeR * 0.6, pal.eyes[1]);
      gset(G, ex - 1, ey - 1, pal.eyes[2]);
    }
    eyes.push([Math.round(ex), Math.round(ey)]);
  }
  return { G, ax: cx, ay: Math.round(sh + 66 * k), eyes, eyeR };
};

/** A late-fifties sedan seen side-on, four passengers inside. */
export const carFigure = (tick: number): Figure => {
  const G = grid(50, 20);
  const body = "#1fb5a8";
  const bodyLo = "#12807c";
  const roof = "#f4f1e4";
  const glass = "#7fd9f2";
  const chrome = "#dfe8f2";
  const bob = tick % 6 < 3 ? 0 : 1;
  const y = 1 + bob;
  grect(G, 3, y + 8, 43, 6, body);
  grect(G, 3, y + 12, 43, 2, bodyLo);
  grect(G, 11, y + 2, 21, 2, roof);
  grect(G, 10, y + 4, 23, 4, roof);
  grect(G, 12, y + 4, 8, 4, glass);
  grect(G, 22, y + 4, 9, 4, glass);
  gline(G, 9, y + 8, 12, y + 3, roof);
  gline(G, 33, y + 8, 31, y + 3, roof);
  // Passengers.
  for (const hx of [14, 17, 24, 27]) {
    grect(G, hx, y + 5, 2, 3, "#2a1c3f");
  }
  grect(G, 1, y + 6, 6, 3, body); // tail fin
  grect(G, 1, y + 9, 1, 2, "#ff2a3d");
  grect(G, 34, y + 7, 12, 2, body);
  grect(G, 3, y + 11, 43, 1, chrome);
  grect(G, 0, y + 13, 4, 2, chrome);
  grect(G, 45, y + 13, 4, 2, chrome);
  grect(G, 46, y + 9, 2, 2, "#fff2a8");
  for (const wx of [12, 37]) {
    gellipse(G, wx, 15, 4, 4, "#0a0810");
    gellipse(G, wx, 15, 2, 2, chrome);
    // A spoke that flips each tick sells the motion.
    gset(G, wx + (tick % 2 ? 1 : -1), 15 + (tick % 2 ? -1 : 1), "#6b7686");
  }
  goutline(G, "#07040f");
  return { G, ax: 25, ay: 19, eyes: [], eyeR: 0 };
};

/** A sandhill crane: grey plumage, bustle of tail feathers, red crown. */
export const craneFigure = (tick: number): Figure => {
  const G = grid(58, 86);
  const grey = "#b8bcc8";
  const greyHi = "#e2e5ee";
  const greyLo = "#868a9a";
  const rust = "#c9a27a";
  const dip = tick % 40 < 6 ? 2 : 0; // an occasional head bob
  // Legs first so the body overlaps them.
  gline(G, 24, 52, 23, 68, "#3d3a42", 2);
  gline(G, 23, 68, 25, 83, "#3d3a42", 2);
  gline(G, 31, 52, 33, 69, "#3d3a42", 2);
  gline(G, 33, 69, 32, 83, "#3d3a42", 2);
  for (const fx of [25, 32]) {
    gline(G, fx, 83, fx + 5, 84, "#3d3a42");
    gline(G, fx, 83, fx - 3, 84, "#3d3a42");
  }
  // Tail bustle.
  gellipse(G, 9, 46, 9, 6, greyLo);
  gellipse(G, 7, 50, 6, 5, grey);
  gline(G, 2, 48, 8, 55, greyLo);
  // Body and folded wing.
  gellipse(G, 26, 42, 17, 11, grey);
  gellipse(G, 24, 38, 13, 6, greyHi);
  gellipse(G, 22, 45, 13, 7, greyLo);
  gellipse(G, 20, 44, 11, 5, rust);
  for (let i = 0; i < 6; i++) {
    gline(G, 12 + i * 4, 42, 9 + i * 4, 50, greyLo);
  }
  // Neck: an S-curve up to the head.
  gline(G, 38, 38, 42, 26, grey, 4);
  gline(G, 42, 26, 40, 14 + dip, grey, 3);
  gline(G, 40, 26, 39, 16 + dip, greyHi, 1);
  gellipse(G, 42, 11 + dip, 5, 4, greyHi);
  grect(G, 39, 6 + dip, 7, 3, "#e0262b");
  grect(G, 40, 5 + dip, 5, 1, "#ff5a4a");
  gline(G, 46, 11 + dip, 56, 13 + dip, "#3d3a42", 2);
  gset(G, 44, 10 + dip, "#ffd24a");
  gset(G, 44, 11 + dip, "#0a0810");
  goutline(G, "#0c1420");
  return { G, ax: 28, ay: 85, eyes: [], eyeR: 0 };
};

/** A small owl whose eyes catch the light — the other everyday explanation. */
export const owlFigure = (tick: number): Figure => {
  const G = grid(15, 18);
  gellipse(G, 7, 10, 6, 7, "#6b4a2f");
  gellipse(G, 7, 12, 4, 4, "#a67c52");
  for (let y = 9; y < 16; y += 2) {
    for (let x = 4; x < 11; x += 2) {
      gset(G, x + (y % 4 ? 0 : 1), y, "#4a321f");
    }
  }
  gset(G, 2, 3, "#6b4a2f");
  gset(G, 12, 3, "#6b4a2f");
  if (tick % 50 < 46) {
    gellipse(G, 4, 6, 2, 2, "#fff2a8");
    gellipse(G, 10, 6, 2, 2, "#fff2a8");
    gset(G, 4, 6, "#0a0810");
    gset(G, 10, 6, "#0a0810");
  } else {
    grect(G, 3, 6, 3, 1, "#2a1c12");
    grect(G, 9, 6, 3, 1, "#2a1c12");
  }
  gset(G, 7, 8, "#ffb23d");
  goutline(G, "#0c1420");
  return { G, ax: 7, ay: 17, eyes: [], eyeR: 0 };
};

/** A bystander silhouette; `pose` 1 raises an arm to point at the sky. */
export const personFigure = (pose: number, c: string): Figure => {
  const G = grid(9, 15);
  gellipse(G, 4, 2, 2, 2, c);
  grect(G, 2, 5, 5, 6, c);
  grect(G, 2, 11, 2, 4, c);
  grect(G, 5, 11, 2, 4, c);
  if (pose === 1) {
    gline(G, 6, 6, 8, 1, c);
  } else if (pose === 2) {
    gline(G, 2, 6, 0, 2, c);
    gline(G, 6, 6, 8, 2, c);
  } else {
    grect(G, 1, 5, 1, 5, c);
    grect(G, 7, 5, 1, 5, c);
  }
  return { G, ax: 4, ay: 14, eyes: [], eyeR: 0 };
};
