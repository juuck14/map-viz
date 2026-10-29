// Generates the prepared maps: node tools/generate-maps.mjs  ->  src/maps-data.js
//
// Each map starts as a Voronoi diagram of Poisson-disc points. Noise decides
// which cells are land; regions grow from seeds over the land with uneven
// speeds and noisy costs, so they come out irregular and of varied size.
// Every border between two faces (a region or the sea) becomes one shared
// "arc": it is roughened, smoothed and simplified once, and both regions use
// the same arc, so neighbors share their border exactly.
//
// The generator also records which regions are neighbors from the Voronoi
// topology. The page never uses that list to color anything; the independent
// checker (src/checker.js) uses it to re-check every coloring.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Delaunay } from 'd3-delaunay';

const require = createRequire(import.meta.url);
const Core = require('../src/core.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Random numbers and noise
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function makeNoise(seed) {
  const rand = mulberry32(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grads = Array.from({ length: 256 }, () => {
    const a = rand() * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  });
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const g = (ix, iy) => grads[perm[perm[ix & 255] + (iy & 255)]];
    const dot = (gr, dx, dy) => gr[0] * dx + gr[1] * dy;
    const n00 = dot(g(xi, yi), xf, yf);
    const n10 = dot(g(xi + 1, yi), xf - 1, yf);
    const n01 = dot(g(xi, yi + 1), xf, yf - 1);
    const n11 = dot(g(xi + 1, yi + 1), xf - 1, yf - 1);
    const u = fade(xf);
    const v = fade(yf);
    return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
  }
  function fbm(x, y, octaves = 5) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
  return { noise, fbm };
}

// ---------------------------------------------------------------------------
// Points and Voronoi cells
// ---------------------------------------------------------------------------

function poissonDisc(W, H, r, rand) {
  const cell = r / Math.SQRT2;
  const gw = Math.ceil(W / cell);
  const gh = Math.ceil(H / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [];
  const active = [];
  const add = (x, y) => {
    grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] = pts.length;
    active.push(pts.length);
    pts.push([x, y]);
  };
  const fits = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let j = Math.max(0, gy - 2); j <= Math.min(gh - 1, gy + 2); j++) {
      for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
        const k = grid[j * gw + i];
        if (k >= 0 && Math.hypot(pts[k][0] - x, pts[k][1] - y) < r) return false;
      }
    }
    return true;
  };
  add(W / 2, H / 2);
  while (active.length) {
    const ai = Math.floor(rand() * active.length);
    const [px, py] = pts[active[ai]];
    let placed = false;
    for (let k = 0; k < 30; k++) {
      const a = rand() * Math.PI * 2;
      const d = r * (1 + rand());
      const x = px + Math.cos(a) * d;
      const y = py + Math.sin(a) * d;
      if (fits(x, y)) {
        add(x, y);
        placed = true;
        break;
      }
    }
    if (!placed) active.splice(ai, 1);
  }
  return pts;
}

function voronoiTopology(pts) {
  const del = new Delaunay(Float64Array.from(pts.flat()));
  const { triangles, halfedges } = del;
  const cc = del.voronoi([-1e5, -1e5, 1e5, 1e5]).circumcenters;
  const n = pts.length;
  const next = (e) => (e % 3 === 2 ? e - 2 : e + 1);
  const nbrs = Array.from({ length: n }, () => []);
  const edges = []; // Voronoi edges between two cells: cells p, q and corner triangles t1, t2
  const onHull = new Uint8Array(n);
  for (let e = 0; e < triangles.length; e++) {
    const o = halfedges[e];
    if (o < 0) {
      onHull[triangles[e]] = 1;
      continue;
    }
    if (o < e) continue;
    const p = triangles[e];
    const q = triangles[next(e)];
    const t1 = Math.floor(e / 3);
    const t2 = Math.floor(o / 3);
    if (Math.hypot(cc[2 * t1] - cc[2 * t2], cc[2 * t1 + 1] - cc[2 * t2 + 1]) < 1e-6) continue;
    nbrs[p].push(q);
    nbrs[q].push(p);
    edges.push({ p, q, t1, t2 });
  }
  // The three cells around each corner (triangle).
  const cornerCells = (t) => [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
  return { n, nbrs, edges, onHull, cc, cornerCells };
}

// ---------------------------------------------------------------------------
// Land and regions
// ---------------------------------------------------------------------------

function components(n, nbrs, inSet) {
  const comp = new Int32Array(n).fill(-1);
  const list = [];
  for (let s = 0; s < n; s++) {
    if (!inSet(s) || comp[s] >= 0) continue;
    const id = list.length;
    const members = [s];
    comp[s] = id;
    for (let k = 0; k < members.length; k++) {
      for (const t of nbrs[members[k]]) {
        if (inSet(t) && comp[t] < 0) {
          comp[t] = id;
          members.push(t);
        }
      }
    }
    list.push(members);
  }
  return { comp, list };
}

function makeLand(cfg, pts, topo, noise, rand) {
  const { W, H } = cfg;
  const { n, nbrs, onHull } = topo;
  const margin = cfg.r * 2.2;
  const forcedSea = (i) =>
    onHull[i] || pts[i][0] < margin || pts[i][1] < margin || pts[i][0] > W - margin || pts[i][1] > H - margin;
  const shape = cfg.land.shape(pts, W, H, rand);
  const height = pts.map(([x, y], i) => {
    if (forcedSea(i)) return -Infinity;
    return shape(x, y) + cfg.land.noise * noise.fbm((x / W) * cfg.land.freq * (W / H), (y / H) * cfg.land.freq, 5);
  });
  const finite = height.filter((h) => h > -Infinity).sort((a, b) => a - b);
  const threshold = finite[Math.floor(finite.length * (1 - cfg.land.fraction))];
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = height[i] >= threshold ? 1 : 0;

  // Fill lakes: sea not connected to the open ocean becomes land.
  const sea = components(n, nbrs, (i) => !land[i]);
  for (const members of sea.list) {
    if (!members.some((i) => forcedSea(i))) for (const i of members) land[i] = 1;
  }
  // Drop specks of land; optionally keep only the largest landmass.
  const lands = components(n, nbrs, (i) => land[i]);
  const largest = Math.max(...lands.list.map((m) => m.length));
  for (const members of lands.list) {
    const keep = cfg.land.islands ? members.length >= cfg.land.minIsland : members.length === largest;
    if (!keep) for (const i of members) land[i] = 0;
  }
  return land;
}

class MinHeap {
  constructor() {
    this.a = [];
  }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

function pickSeeds(cfg, pts, topo, land, rand) {
  if (cfg.seeds) return cfg.seeds(pts, topo, land, rand);
  const lands = components(topo.n, topo.nbrs, (i) => land[i]);
  const total = lands.list.reduce((s, m) => s + m.length, 0);
  const seeds = [];
  for (const members of lands.list) {
    const k = Math.max(1, Math.round((cfg.regions * members.length) / total));
    // Farthest-point sampling with a random tilt, inside this landmass.
    const local = [members[Math.floor(rand() * members.length)]];
    while (local.length < k) {
      let best = -1;
      let bestScore = -1;
      for (const c of members) {
        let d = Infinity;
        for (const s of local) d = Math.min(d, Math.hypot(pts[c][0] - pts[s][0], pts[c][1] - pts[s][1]));
        const score = d * (0.75 + 0.5 * rand());
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      local.push(best);
    }
    seeds.push(...local);
  }
  return seeds;
}

function growRegions(cfg, pts, topo, land, seeds, noise, rand) {
  const region = new Int32Array(topo.n).fill(-1);
  const speed = seeds.map(() => 1 + cfg.sizeVariety * (rand() * 2 - 1));
  const heap = new MinHeap();
  seeds.forEach((s, k) => heap.push([0, s, k]));
  while (heap.size) {
    const [d, c, k] = heap.pop();
    if (region[c] >= 0) continue;
    region[c] = k;
    for (const t of topo.nbrs[c]) {
      if (!land[t] || region[t] >= 0) continue;
      const mx = (pts[c][0] + pts[t][0]) / 2;
      const my = (pts[c][1] + pts[t][1]) / 2;
      const rough = 1 + cfg.roughness * noise.fbm(mx / 90 + 31.7, my / 90 - 12.3, 3);
      const len = Math.hypot(pts[c][0] - pts[t][0], pts[c][1] - pts[t][1]);
      heap.push([d + (len * Math.max(0.15, rough)) / speed[k], t, k]);
    }
  }
  return region;
}

// ---------------------------------------------------------------------------
// Borders: trace each region's outline over Voronoi corners
// ---------------------------------------------------------------------------

function buildBoundaries(pts, topo, region, alias) {
  const find = (v) => {
    while (alias.has(v)) v = alias.get(v);
    return v;
  };
  const out = new Map(); // region -> Map(fromCorner -> [toCorner])
  const faceSets = new Map(); // corner -> Set of faces (-1 = sea)
  const regionPairs = new Set();
  const addFace = (v, f) => {
    if (!faceSets.has(v)) faceSets.set(v, new Set());
    faceSets.get(v).add(f);
  };
  for (const { p, q, t1, t2 } of topo.edges) {
    const rp = region[p];
    const rq = region[q];
    if (rp === rq) continue;
    const a = find(t1);
    const b = find(t2);
    addFace(a, rp);
    addFace(a, rq);
    addFace(b, rp);
    addFace(b, rq);
    if (a === b) continue;
    if (rp >= 0 && rq >= 0) regionPairs.add(rp < rq ? `${rp}|${rq}` : `${rq}|${rp}`);
    // Orient so that the region lies on the right (clockwise on screen).
    const [ax, ay] = cornerPos(topo, a);
    const [bx, by] = cornerPos(topo, b);
    const side = (bx - ax) * (pts[p][1] - ay) - (by - ay) * (pts[p][0] - ax);
    const [pFrom, pTo] = side > 0 ? [a, b] : [b, a];
    for (const [r, from, to, other] of [[rp, pFrom, pTo, rq], [rq, pTo, pFrom, rp]]) {
      if (r < 0) continue;
      if (!out.has(r)) out.set(r, new Map());
      const m = out.get(r);
      if (!m.has(from)) m.set(from, []);
      m.get(from).push({ to, other });
    }
  }
  // cycles: region -> list of outlines; each outline lists its corners and,
  // for the edge leaving each corner, the face on the other side.
  const cycles = new Map();
  let pinched = false;
  for (const [r, m] of out) {
    const used = new Set();
    const list = [];
    for (const [start, tos] of m) {
      if (tos.length > 1) pinched = true;
      if (used.has(start)) continue;
      const corners = [];
      const others = [];
      let v = start;
      while (!used.has(v) && m.has(v)) {
        used.add(v);
        corners.push(v);
        others.push(m.get(v)[0].other);
        v = m.get(v)[0].to;
      }
      list.push({ corners, others });
    }
    cycles.set(r, list);
  }
  return { cycles, faceSets, regionPairs, pinched, find };
}

// Split an outline into chains that run from one junction to the next.
// Returns [] for an outline without junctions (an island alone in the sea).
function splitChains({ corners, others }, isJunction) {
  const js = [];
  corners.forEach((v, i) => isJunction(v) && js.push(i));
  return js.map((a, k) => {
    const b = js[(k + 1) % js.length];
    const chain = [corners[a]];
    for (let i = (a + 1) % corners.length; ; i = (i + 1) % corners.length) {
      chain.push(corners[i]);
      if (i === b) break;
    }
    return { corners: chain, other: others[a] };
  });
}

function cornerPos(topo, v) {
  if (topo.moved && topo.moved.has(v)) return topo.moved.get(v);
  return [topo.cc[2 * v], topo.cc[2 * v + 1]];
}

function ringArea(topo, { corners }) {
  let s = 0;
  for (let i = 0; i < corners.length; i++) {
    const [x1, y1] = cornerPos(topo, corners[i]);
    const [x2, y2] = cornerPos(topo, corners[(i + 1) % corners.length]);
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

// Merge tiny regions and enclaves until every region is one simple piece.
function cleanUp(cfg, pts, topo, region) {
  for (let round = 0; round < 50; round++) {
    let changed = false;
    const size = new Map();
    for (let i = 0; i < topo.n; i++) if (region[i] >= 0) size.set(region[i], (size.get(region[i]) || 0) + 1);
    for (const [r, s] of size) {
      if (s >= cfg.minCells) continue;
      // Merge into the neighbor that shares the most cell borders.
      const shared = new Map();
      for (let i = 0; i < topo.n; i++) {
        if (region[i] !== r) continue;
        for (const t of topo.nbrs[i]) if (region[t] >= 0 && region[t] !== r) shared.set(region[t], (shared.get(region[t]) || 0) + 1);
      }
      let target = -1;
      let best = 0;
      for (const [o, c] of shared) if (c > best) [target, best] = [o, c];
      for (let i = 0; i < topo.n; i++) if (region[i] === r) region[i] = target; // -1: an islet becomes sea
      changed = true;
      break;
    }
    if (changed) continue;
    const { cycles } = buildBoundaries(pts, topo, region, new Map());
    for (const [r, list] of cycles) {
      if (list.length < 2) continue;
      // Inner rings enclose other regions: absorb them.
      const areas = list.map((c) => Math.abs(ringArea(topo, c)));
      const outer = areas.indexOf(Math.max(...areas));
      const swallow = new Set();
      list.forEach((c, k) => k !== outer && c.others.forEach((o) => o >= 0 && swallow.add(o)));
      if (!swallow.size) return false; // a lake inside a region: give up on this seed
      for (let i = 0; i < topo.n; i++) if (swallow.has(region[i])) region[i] = r;
      changed = true;
      break;
    }
    if (!changed) return true;
  }
  return false;
}

// Squeeze a short border between two regions down to a single point, so the
// two regions touch only at that point (like the US "Four Corners").
function makePointContacts(cfg, pts, topo, region, count, rand) {
  const alias = new Map();
  topo.moved = new Map();
  if (!count) return alias;
  const { cycles, faceSets } = buildBoundaries(pts, topo, region, alias);
  const isJunction = (v) => faceSets.get(v).size >= 3;
  const chains = new Map(); // "r1|r2" -> the border chains between r1 and r2
  for (const [r, list] of cycles) {
    for (const { corners, other } of splitChains(list[0], isJunction)) {
      if (other <= r) continue; // count each border once, from its lower region
      const key = `${r}|${other}`;
      if (!chains.has(key)) chains.set(key, []);
      chains.get(key).push(corners);
    }
  }
  const W = cfg.W;
  const H = cfg.H;
  const candidates = [];
  for (const [key, list] of chains) {
    if (list.length !== 1) continue;
    const chain = list[0];
    const [r1, r2] = key.split('|').map(Number);
    const f1 = [...faceSets.get(chain[0])].filter((f) => f !== r1 && f !== r2);
    const f2 = [...faceSets.get(chain[chain.length - 1])].filter((f) => f !== r1 && f !== r2);
    if (f1.length !== 1 || f2.length !== 1 || f1[0] < 0 || f2[0] < 0 || f1[0] === f2[0]) continue;
    let len = 0;
    for (let i = 1; i < chain.length; i++) {
      const [x1, y1] = cornerPos(topo, chain[i - 1]);
      const [x2, y2] = cornerPos(topo, chain[i]);
      len += Math.hypot(x2 - x1, y2 - y1);
    }
    if (len > cfg.r * 2.2) continue;
    const [mx, my] = cornerPos(topo, chain[Math.floor(chain.length / 2)]);
    const central = Math.hypot((mx - W / 2) / W, (my - H / 2) / H);
    candidates.push({ chain, len, mx, my, score: central + 0.2 * rand() });
  }
  candidates.sort((a, b) => a.score - b.score);
  const chosen = [];
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (chosen.some((d) => Math.hypot(d.mx - c.mx, d.my - c.my) < W / 4)) continue;
    chosen.push(c);
  }
  for (const { chain } of chosen) {
    let x = 0;
    let y = 0;
    for (const v of chain) {
      const [cx, cy] = cornerPos(topo, v);
      x += cx;
      y += cy;
    }
    const rep = chain[0];
    topo.moved.set(rep, [x / chain.length, y / chain.length]);
    for (const v of chain.slice(1)) alias.set(v, rep);
  }
  return alias;
}

// ---------------------------------------------------------------------------
// Arc geometry
// ---------------------------------------------------------------------------

function roughen(points, amp, rand, depth) {
  let pts = points;
  for (let d = 0; d < depth; d++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      const off = (rand() * 2 - 1) * amp * len;
      out.push([(ax + bx) / 2 - ((by - ay) / (len || 1)) * off, (ay + by) / 2 + ((bx - ax) / (len || 1)) * off]);
      out.push(pts[i]);
    }
    pts = out;
    amp *= 0.85;
  }
  return pts;
}

function chaikin(points, iterations, closed) {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out = closed ? [] : [pts[0]];
    const m = closed ? pts.length : pts.length - 1;
    for (let k = 0; k < m; k++) {
      const [ax, ay] = pts[k];
      const [bx, by] = pts[(k + 1) % pts.length];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
      out.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    if (!closed) out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Pull each point toward the middle of its neighbors. This irons out the
// zigzag of Voronoi corners, which would otherwise show as regular scallops.
// The ends stay fixed (they are junctions shared with other arcs).
function relax(points, passes, closed) {
  let pts = points;
  for (let p = 0; p < passes; p++) {
    const m = pts.length;
    pts = pts.map((q, i) => {
      if (!closed && (i === 0 || i === m - 1)) return q;
      if (closed && i === m - 1) return null; // the repeated first point, rebuilt below
      const a = pts[closed ? (i - 1 + m - 1) % (m - 1) : i - 1];
      const b = pts[i + 1];
      return [0.25 * a[0] + 0.5 * q[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * q[1] + 0.25 * b[1]];
    });
    if (closed) pts[m - 1] = pts[0];
  }
  return pts;
}

const r1 = (v) => Math.round(v * 10) / 10;

function arcGeometry(cfg, topo, corners, closed, coast, key) {
  const rand = mulberry32(hashString(`${cfg.id}:${key}`));
  let pts = corners.map((v) => cornerPos(topo, v));
  if (closed) pts = pts.concat([pts[0]]);
  pts = relax(pts, coast ? cfg.coastRelax ?? 3 : cfg.borderRelax ?? 1, closed);
  pts = roughen(pts, coast ? cfg.coastRoughness : cfg.borderRoughness, rand, 3);
  if (closed) {
    pts = chaikin(pts.slice(0, -1), 2, true);
    pts = simplify(pts.concat([pts[0]]), 0.3);
  } else {
    pts = simplify(chaikin(pts, 2, false), 0.3);
  }
  return pts.map(([x, y]) => [r1(x), r1(y)]);
}

// ---------------------------------------------------------------------------
// Assembly and checks
// ---------------------------------------------------------------------------

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// True when no two arc segments cross: the drawing is a proper planar map.
function arcsArePlanar(arcs) {
  const cell = 24;
  const buckets = new Map();
  const segs = [];
  arcs.forEach((arc, ai) => {
    for (let i = 1; i < arc.length; i++) {
      const s = { a: arc[i - 1], b: arc[i], ai, i };
      const id = segs.push(s) - 1;
      const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / cell);
      const x1 = Math.floor(Math.max(s.a[0], s.b[0]) / cell);
      const y0 = Math.floor(Math.min(s.a[1], s.b[1]) / cell);
      const y1 = Math.floor(Math.max(s.a[1], s.b[1]) / cell);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(id);
        }
    }
  });
  for (const ids of buckets.values()) {
    for (let x = 0; x < ids.length; x++)
      for (let y = x + 1; y < ids.length; y++) {
        const s = segs[ids[x]];
        const t = segs[ids[y]];
        if (segmentsCross(s.a, s.b, t.a, t.b)) return false;
      }
  }
  return true;
}

function letterName(k) {
  let s = '';
  k += 1;
  while (k > 0) {
    const m = (k - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
}

function generate(cfg, seed) {
  const rand = mulberry32(seed);
  const noise = makeNoise(seed * 7 + 1);
  const pts = poissonDisc(cfg.W, cfg.H, cfg.r, rand);
  const topo = voronoiTopology(pts);
  const land = makeLand(cfg, pts, topo, noise, rand);
  const seeds = pickSeeds(cfg, pts, topo, land, rand);
  const region = growRegions(cfg, pts, topo, land, seeds, noise, rand);
  if (!cleanUp(cfg, pts, topo, region)) return { fail: 'cleanup did not settle' };
  const alias = makePointContacts(cfg, pts, topo, region, cfg.pointContacts || 0, rand);
  const { cycles, faceSets, regionPairs, pinched } = buildBoundaries(pts, topo, region, alias);
  if (pinched) return { fail: 'a region touches itself' };
  for (const list of cycles.values()) if (list.length !== 1) return { fail: 'a region has a hole' };

  // Regions in reading order get letters A, B, C, ...
  const old = [...cycles.keys()];
  const centroid = (r) => {
    const { corners } = cycles.get(r)[0];
    let x = 0;
    let y = 0;
    for (const v of corners) {
      const [cx, cy] = cornerPos(topo, v);
      x += cx;
      y += cy;
    }
    return [x / corners.length, y / corners.length];
  };
  const band = cfg.H / Math.max(2, Math.round(Math.sqrt(old.length * (cfg.H / cfg.W))));
  old.sort((a, b) => {
    const [ax, ay] = centroid(a);
    const [bx, by] = centroid(b);
    return Math.floor(ay / band) - Math.floor(by / band) || ax - bx;
  });
  const index = new Map(old.map((r, i) => [r, i]));

  // Arcs: split each outline at junctions; each border is stored once.
  const isJunction = (v) => faceSets.get(v).size >= 3;
  const arcKeys = new Map();
  const arcs = [];
  const regions = old.map((r) => {
    const outline = cycles.get(r)[0];
    const chains = splitChains(outline, isJunction);
    const refs = [];
    if (chains.length === 0) {
      arcs.push(arcGeometry(cfg, topo, outline.corners, true, true, `loop:${r}`));
      refs.push(arcs.length - 1);
      return { r, refs };
    }
    for (const { corners: chain, other } of chains) {
      const fwd = chain.join(',');
      const rev = chain.slice().reverse().join(',');
      const key = fwd < rev ? fwd : rev;
      if (!arcKeys.has(key)) {
        const ordered = fwd < rev ? chain : chain.slice().reverse();
        arcKeys.set(key, arcs.length);
        arcs.push(arcGeometry(cfg, topo, ordered, false, other < 0, key));
      }
      const id = arcKeys.get(key);
      refs.push(fwd < rev ? id : ~id);
    }
    return { r, refs };
  });
  if (!arcsArePlanar(arcs)) return { fail: 'borders cross' };

  const pairs = [...regionPairs]
    .map((k) => k.split('|').map((r) => index.get(Number(r))))
    .map(([a, b]) => (a < b ? [a, b] : [b, a]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const pairSet = new Set(pairs.map((p) => p.join('|')));
  const touch = new Set();
  for (const faces of faceSets.values()) {
    const rs = [...faces].filter((f) => f >= 0).map((f) => index.get(f));
    for (const a of rs)
      for (const b of rs) if (a < b && !pairSet.has(`${a}|${b}`)) touch.add(`${a}|${b}`);
  }
  const pointContacts = [...touch].map((k) => k.split('|').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  return {
    arcs,
    regions: regions.map(({ refs }, i) => ({ id: letterName(i), arcs: refs })),
    pairs,
    pointContacts,
  };
}

// ---------------------------------------------------------------------------
// Encoding and the map list
// ---------------------------------------------------------------------------

// Arcs as integer tenths of a pixel, delta-encoded after the first point.
function encodeArc(arc) {
  const out = [];
  let px = 0;
  let py = 0;
  arc.forEach(([x, y], i) => {
    const ix = Math.round(x * 10);
    const iy = Math.round(y * 10);
    if (i === 0) out.push(ix, iy);
    else out.push(ix - px, iy - py);
    px = ix;
    py = iy;
  });
  return out;
}

const island = (cx, cy, rx, ry) => () => (x, y) => 1 - Math.hypot((x - cx) / rx, (y - cy) / ry) ** 2;
const blobs = (list) => () => (x, y) => Math.max(...list.map(([cx, cy, rx, ry, w = 1]) => w * (1 - Math.hypot((x - cx) / rx, (y - cy) / ry) ** 2)));

const MAPS = [
  {
    id: 'corners',
    title: 'Four corners',
    W: 900,
    H: 600,
    r: 22,
    regions: 7,
    sizeVariety: 0.2,
    roughness: 0.6,
    minCells: 14,
    coastRoughness: 0.22,
    borderRoughness: 0.12,
    pointContacts: 1,
    land: { shape: island(450, 300, 330, 230), fraction: 0.52, noise: 0.55, freq: 2.2, islands: false },
    accept: (m, g) => m.pointContacts.length === 2 && g.n >= 6 && g.n <= 8,
    note: (m, ids) => {
      const [[a, b], [c, d]] = m.pointContacts.map((p) => p.map((i) => ids[i]));
      return `${m.regions.length} regions. Four of them meet at a single point: ${a} and ${b} touch only ` +
        `there, and so do ${c} and ${d}. Touching at a point does not make them neighbors, so they may ` +
        'share a color. Hover over them to check.';
    },
  },
  {
    id: 'ring',
    title: 'Five around one',
    W: 900,
    H: 600,
    r: 20,
    regions: 6,
    sizeVariety: 0.1,
    roughness: 0.5,
    minCells: 14,
    coastRoughness: 0.22,
    borderRoughness: 0.12,
    land: { shape: island(450, 300, 300, 240), fraction: 0.5, noise: 0.35, freq: 2.0, islands: false },
    seeds: (pts, topo, land, rand) => {
      const near = (x, y) => {
        let best = -1;
        let bd = Infinity;
        pts.forEach(([px, py], i) => {
          if (!land[i]) return;
          const d = Math.hypot(px - x, py - y);
          if (d < bd) [best, bd] = [i, d];
        });
        return best;
      };
      const phase = rand() * Math.PI * 2;
      const seeds = [near(450, 300)];
      for (let k = 0; k < 5; k++) {
        const a = phase + (k * 2 * Math.PI) / 5;
        seeds.push(near(450 + 210 * Math.cos(a), 300 + 160 * Math.sin(a)));
      }
      return seeds;
    },
    accept: (m, g) => {
      if (g.n !== 6) return false;
      const center = g.neighbors.findIndex((l) => l.length === 5);
      if (center < 0) return false;
      return g.neighbors.every((l, i) => i === center || l.length === 3);
    },
    note: (m, ids, g) => {
      const c = ids[g.neighbors.findIndex((l) => l.length === 5)];
      return `Five regions form a ring around ${c}. A ring of five cannot be colored with two colors, ` +
        `and ${c} touches all five, so this map needs all four colors.`;
    },
  },
  {
    id: 'trap',
    title: 'Greedy trap',
    W: 1000,
    H: 640,
    r: 17,
    regions: 12,
    sizeVariety: 0.3,
    roughness: 0.8,
    minCells: 12,
    coastRoughness: 0.22,
    borderRoughness: 0.13,
    land: { shape: island(500, 320, 400, 260), fraction: 0.55, noise: 0.6, freq: 2.4, islands: false },
    accept: (m, g, map) => {
      const order = Core.ORDERS.alphabetical.make(map, g);
      const greedy = Core.greedyTrace(g, order);
      if (greedy.success) return false;
      const stuckAt = greedy.steps[greedy.steps.length - 1].pos;
      const bt = Core.backtrackTrace(g, order);
      const backs = bt.steps[bt.steps.length - 1].backtracks;
      return stuckAt >= 6 && backs >= 2 && backs <= 6 && Core.greedyTrace(g, Core.ORDERS.mostNeighbors.make(map, g)).success;
    },
    note: (m, ids) =>
      `${m.regions.length} regions, and four colors are enough. Run greedy in alphabetical order and see ` +
      'where it gets stuck, then run backtracking with the same order.',
  },
  {
    id: 'continent',
    title: 'Continent',
    W: 1000,
    H: 680,
    r: 14,
    regions: 32,
    sizeVariety: 0.35,
    roughness: 0.9,
    minCells: 10,
    coastRoughness: 0.24,
    borderRoughness: 0.14,
    pointContacts: 1,
    land: { shape: island(500, 340, 430, 290), fraction: 0.6, noise: 0.75, freq: 2.6, islands: false },
    accept: (m, g, map) => {
      const stuck = (key) => !Core.greedyTrace(g, Core.ORDERS[key].make(map, g, 1)).success;
      if (!stuck('alphabetical')) return false;
      const bt = Core.backtrackTrace(g, Core.ORDERS.random.make(map, g, 1), 20000);
      const backs = bt.steps[bt.steps.length - 1].backtracks;
      return bt.success && backs >= 40;
    },
    note: (m) =>
      `${m.regions.length} regions on one landmass. Compare orders and algorithms: some orders get greedy ` +
      'stuck, and an unlucky order sends backtracking back hundreds of times.',
  },
  {
    id: 'archipelago',
    title: 'Archipelago',
    W: 1000,
    H: 680,
    r: 14,
    regions: 30,
    sizeVariety: 0.4,
    roughness: 0.9,
    minCells: 9,
    coastRoughness: 0.26,
    borderRoughness: 0.14,
    land: {
      shape: blobs([[260, 230, 210, 150], [690, 210, 220, 140], [330, 500, 190, 120], [760, 500, 170, 130, 0.95], [520, 360, 90, 80, 0.8]]),
      fraction: 0.42,
      noise: 0.7,
      freq: 3.2,
      islands: true,
      minIsland: 10,
    },
    accept: (m, g) => {
      const isolated = g.neighbors.filter((l) => l.length === 0).length;
      return isolated >= 1 && isolated <= 4 && g.n >= 24;
    },
    note: (m, ids, g) => {
      const isolated = g.neighbors.filter((l) => l.length === 0).length;
      return `${m.regions.length} regions on several islands. ${isolated === 1 ? 'One region is an island of its own' : `${isolated} regions are islands of their own`}: ` +
        'with no neighbors, any color will do. Each island could be colored on its own, but plain ' +
        'backtracking does not know that: with an unlucky order it backs up through islands that have ' +
        'nothing to do with the problem.';
    },
  },
  {
    id: 'ragged',
    title: 'Ragged coast',
    W: 1000,
    H: 680,
    r: 13,
    regions: 34,
    sizeVariety: 0.45,
    roughness: 1.0,
    minCells: 9,
    coastRoughness: 0.28,
    borderRoughness: 0.15,
    land: { shape: island(500, 340, 470, 330), fraction: 0.5, noise: 1.25, freq: 4.2, islands: false },
    accept: (m, g) => g.n >= 28,
    note: (m) =>
      `${m.regions.length} regions on a ragged coast. Long, thin regions have few neighbors; ` +
      'the crowded middle is where the choices get hard.',
  },
  {
    id: 'isthmus',
    title: 'Isthmus',
    W: 1000,
    H: 680,
    r: 13,
    regions: 40,
    sizeVariety: 0.4,
    roughness: 0.9,
    minCells: 9,
    coastRoughness: 0.24,
    borderRoughness: 0.14,
    pointContacts: 1,
    land: {
      shape: blobs([[270, 300, 230, 250], [740, 390, 230, 240], [505, 345, 170, 42, 0.9]]),
      fraction: 0.5,
      noise: 0.6,
      freq: 2.8,
      islands: false,
    },
    accept: (m, g) => {
      if (g.n < 34) return false;
      // The isthmus: some region whose removal splits the map in two.
      return g.neighbors.some((_, cut) => {
        const start = cut === 0 ? 1 : 0;
        const seen = new Set([cut, start]);
        const stack = [start];
        while (stack.length) {
          for (const u of g.neighbors[stack.pop()]) {
            if (seen.has(u)) continue;
            seen.add(u);
            stack.push(u);
          }
        }
        return seen.size < g.n;
      });
    },
    note: (m) =>
      `${m.regions.length} regions on two lands joined by a narrow neck. The neck is the only link ` +
      'between the halves, so a choice made on one side reaches the other side only through it.',
  },
  {
    id: 'patchwork',
    title: 'Patchwork',
    W: 1000,
    H: 680,
    r: 11,
    regions: 64,
    sizeVariety: 0.45,
    roughness: 1.0,
    minCells: 10,
    coastRoughness: 0.22,
    borderRoughness: 0.14,
    pointContacts: 2,
    land: { shape: island(500, 340, 520, 360), fraction: 0.72, noise: 0.5, freq: 2.2, islands: false },
    accept: (m, g, map) => {
      if (g.n < 55) return false;
      return !Core.greedyTrace(g, Core.ORDERS.alphabetical.make(map, g)).success;
    },
    note: (m) =>
      `${m.regions.length} small regions packed together. Plain backtracking can take a very long time here; ` +
      'compare it with forward checking.',
  },
];

function graphOf(result) {
  const n = result.regions.length;
  const neighbors = Array.from({ length: n }, () => []);
  for (const [a, b] of result.pairs) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  neighbors.forEach((l) => l.sort((x, y) => x - y));
  return { n, ids: result.regions.map((r) => r.id), neighbors };
}

function main() {
  const only = process.argv.slice(2);
  const outFile = path.join(root, 'src', 'maps-data.js');
  const previous = fs.existsSync(outFile) ? require(outFile) : [];
  const out = [];
  for (const cfg of MAPS) {
    if (only.length && !only.includes(cfg.id)) {
      const kept = previous.find((m) => m.id === cfg.id);
      if (kept) out.push(kept);
      continue;
    }
    const t0 = Date.now();
    let made = null;
    let tried = 0;
    for (let seed = cfg.firstSeed || 1; seed < 400 && !made; seed++) {
      tried++;
      const result = generate(cfg, seed);
      if (result.fail) {
        if (process.env.DEBUG) console.log(`  seed ${seed}: ${result.fail}`);
        continue;
      }
      const g = graphOf(result);
      const data = {
        id: cfg.id,
        title: cfg.title,
        width: cfg.W,
        height: cfg.H,
        seed,
        regions: result.regions,
        arcs: result.arcs.map(encodeArc),
        pairs: result.pairs,
        pointContacts: result.pointContacts,
      };
      const map = Core.buildMap(data);
      if (!cfg.accept(result, g, map)) continue;
      data.note = cfg.note(result, g.ids, g);
      data.regions = data.regions.map((r, i) => ({ ...r, label: map.regions[i].label, clearance: map.regions[i].clearance }));
      made = data;
    }
    if (!made) throw new Error(`No acceptable seed for ${cfg.id}`);
    out.push(made);
    console.log(`${cfg.id}: seed ${made.seed} after ${tried} tries, ${made.regions.length} regions, ` +
      `${made.arcs.length} arcs, ${made.arcs.reduce((s, a) => s + a.length / 2, 0)} points, ${Date.now() - t0} ms`);
  }
  const js =
    '/* Generated by tools/generate-maps.mjs. Do not edit by hand. */\n' +
    '(function (root, data) {\n' +
    "  if (typeof module === 'object' && module.exports) module.exports = data;\n" +
    '  else root.MapData = data;\n' +
    "})(typeof self !== 'undefined' ? self : this, " +
    JSON.stringify(out) +
    ');\n';
  fs.writeFileSync(outFile, js);
  console.log(`Wrote ${path.relative(root, outFile)} (${(js.length / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
export { generate, MAPS, graphOf };
