/*
 * Map coloring core: map geometry, adjacency, and step-by-step traces of
 * coloring algorithms. No DOM access, so the same file runs in the browser
 * (as window.MapCore) and in Node tests (via require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NUM_COLORS = 4;
  const SEA = '.';

  // ---------------------------------------------------------------------------
  // Map geometry
  //
  // A map is authored as a grid of letters (one letter per region, '.' for sea).
  // Grid corners are jittered and every border is smoothed, so the regions look
  // hand drawn while two neighbors still share exactly the same border points.
  // ---------------------------------------------------------------------------

  // Deterministic value in [0, 1) for a grid corner, so a map always looks the same.
  function noise(seed, i, j, k) {
    let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (i + 0x165667b1), 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h ^ (j + 0x27d4eb2f), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h ^ (k + 0x9e3779b1), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function parseGrid(rows) {
    const H = rows.length;
    const W = Math.max(...rows.map((r) => r.length));
    const at = (i, j) => (i < 0 || j < 0 || i >= H || j >= W ? SEA : rows[i][j] || SEA);
    return { H, W, at };
  }

  const round2 = (v) => Math.round(v * 100) / 100;

  // Chaikin corner cutting on an open chain; the two end points stay fixed.
  // The rule is symmetric, so smoothing a chain forwards or backwards gives the
  // same points. That keeps a shared border identical for both of its regions.
  function chaikinOpen(points, iterations) {
    let pts = points;
    for (let it = 0; it < iterations; it++) {
      const out = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, ay] = pts[k];
        const [bx, by] = pts[k + 1];
        out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
        out.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }

  function chaikinClosed(points, iterations) {
    let pts = points;
    for (let it = 0; it < iterations; it++) {
      const out = [];
      for (let k = 0; k < pts.length; k++) {
        const [ax, ay] = pts[k];
        const [bx, by] = pts[(k + 1) % pts.length];
        out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
        out.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
      }
      pts = out;
    }
    return pts;
  }

  // Build drawable regions from a map spec:
  // { id, title, grid: [...rows], cell, margin, jitter, smooth, seed }
  function buildMap(spec) {
    const { H, W, at } = parseGrid(spec.grid);
    const cell = spec.cell || 40;
    const margin = spec.margin == null ? cell * 0.6 : spec.margin;
    const jitter = spec.jitter == null ? 0.25 : spec.jitter;
    const smooth = spec.smooth == null ? 2 : spec.smooth;
    const seed = spec.seed || 1;

    const corner = (i, j) => [
      margin + j * cell + (noise(seed, i, j, 0) - 0.5) * 2 * jitter * cell,
      margin + i * cell + (noise(seed, i, j, 1) - 0.5) * 2 * jitter * cell,
    ];
    // A corner where three or more faces (regions or sea) meet is a junction.
    // Junctions are never moved by smoothing; four-region junctions are the
    // points where two regions touch without being neighbors.
    const isJunction = (i, j) =>
      new Set([at(i - 1, j - 1), at(i - 1, j), at(i, j - 1), at(i, j)]).size >= 3;

    const ids = [];
    for (let i = 0; i < H; i++)
      for (let j = 0; j < W; j++) {
        const c = at(i, j);
        if (c !== SEA && !ids.includes(c)) ids.push(c);
      }
    ids.sort();

    const regions = ids.map((id) => {
      // Directed boundary edges, clockwise on screen (y grows downwards).
      const next = new Map();
      const add = (a, b) => {
        const key = a.join(',');
        if (next.has(key)) {
          throw new Error(`Map "${spec.id}": region ${id} touches itself at corner (${key}).`);
        }
        next.set(key, b);
      };
      for (let i = 0; i < H; i++)
        for (let j = 0; j < W; j++) {
          if (at(i, j) !== id) continue;
          if (at(i - 1, j) !== id) add([i, j], [i, j + 1]);
          if (at(i, j + 1) !== id) add([i, j + 1], [i + 1, j + 1]);
          if (at(i + 1, j) !== id) add([i + 1, j + 1], [i + 1, j]);
          if (at(i, j - 1) !== id) add([i + 1, j], [i, j]);
        }
      // Follow the edges once around; a simple region uses all of them.
      const startKey = next.keys().next().value;
      const cycle = [];
      let key = startKey;
      do {
        const [i, j] = key.split(',').map(Number);
        cycle.push([i, j]);
        key = next.get(key).join(',');
      } while (key !== startKey && cycle.length <= next.size);
      if (cycle.length !== next.size) {
        throw new Error(`Map "${spec.id}": region ${id} is not one piece without holes.`);
      }

      // Smooth each border chain between junctions separately.
      const junctions = [];
      cycle.forEach(([i, j], k) => {
        if (isJunction(i, j)) junctions.push(k);
      });
      let polygon;
      if (junctions.length === 0) {
        polygon = chaikinClosed(cycle.map(([i, j]) => corner(i, j)), smooth);
      } else {
        const rotated = cycle.slice(junctions[0]).concat(cycle.slice(0, junctions[0]));
        polygon = [];
        let chain = [rotated[0]];
        for (let k = 1; k <= rotated.length; k++) {
          const c = rotated[k % rotated.length];
          chain.push(c);
          if (isJunction(c[0], c[1])) {
            const pts = chaikinOpen(chain.map(([i, j]) => corner(i, j)), smooth);
            polygon.push(...pts.slice(0, -1));
            chain = [c];
          }
        }
      }
      polygon = polygon.map(([x, y]) => [round2(x), round2(y)]);
      return { id, polygon, cells: countCells(at, H, W, id) };
    });

    // Frame the land with a little room for labels, instead of the whole grid.
    const xs = regions.flatMap((r) => r.polygon.map((p) => p[0]));
    const ys = regions.flatMap((r) => r.polygon.map((p) => p[1]));
    const pad = cell * 0.6;
    const map = {
      id: spec.id,
      title: spec.title,
      viewBox: [
        Math.min(...xs) - pad,
        Math.min(...ys) - pad,
        Math.max(...xs) - Math.min(...xs) + 2 * pad,
        Math.max(...ys) - Math.min(...ys) + 2 * pad,
      ].map(round2),
      ids,
      regions,
      spec,
    };
    for (const r of regions) {
      r.label = (spec.labels && spec.labels[r.id]) || labelPoint(r.polygon, cell / 8);
      r.path = 'M' + r.polygon.map(([x, y]) => `${x},${y}`).join('L') + 'Z';
    }
    return map;
  }

  function countCells(at, H, W, id) {
    let n = 0;
    for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) if (at(i, j) === id) n++;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Polygon helpers
  // ---------------------------------------------------------------------------

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
      const [xa, ya] = polygon[a];
      const [xb, yb] = polygon[b];
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
    return inside;
  }

  function distToSegment(x, y, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  }

  function distToBoundary(x, y, polygon) {
    let best = Infinity;
    for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
      best = Math.min(best, distToSegment(x, y, ...polygon[b], ...polygon[a]));
    }
    return best;
  }

  // The interior point farthest from the border: where the label (and the
  // graph vertex) goes. A coarse scan followed by a fine one is plenty here.
  function labelPoint(polygon, step) {
    const xs = polygon.map((p) => p[0]);
    const ys = polygon.map((p) => p[1]);
    let best = null;
    let bestD = -1;
    const scan = (x0, x1, y0, y1, s) => {
      for (let x = x0; x <= x1; x += s)
        for (let y = y0; y <= y1; y += s) {
          if (!pointInPolygon(x, y, polygon)) continue;
          const d = distToBoundary(x, y, polygon);
          if (d > bestD) {
            bestD = d;
            best = [x, y];
          }
        }
    };
    scan(Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), step);
    const [bx, by] = best;
    scan(bx - step, bx + step, by - step, by + step, step / 4);
    return [round2(best[0]), round2(best[1])];
  }

  // ---------------------------------------------------------------------------
  // Adjacency: two regions are neighbors exactly when their borders overlap
  // along a segment of positive length. Touching at a single point does not
  // count. This works on the polygons alone, for any polygonal map.
  // ---------------------------------------------------------------------------

  const MIN_SHARED = 1e-3; // shortest overlap that counts as a shared segment
  const ON_LINE = 1e-3; // how far a point may sit from a line and still be on it

  function sharedPart(e, f) {
    const dx = e.bx - e.ax;
    const dy = e.by - e.ay;
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    const ux = dx / len;
    const uy = dy / len;
    // Both ends of f must lie on the line through e.
    const off1 = (f.ax - e.ax) * uy - (f.ay - e.ay) * ux;
    const off2 = (f.bx - e.ax) * uy - (f.by - e.ay) * ux;
    if (Math.abs(off1) > ON_LINE || Math.abs(off2) > ON_LINE) return null;
    const t1 = (f.ax - e.ax) * ux + (f.ay - e.ay) * uy;
    const t2 = (f.bx - e.ax) * ux + (f.by - e.ay) * uy;
    const lo = Math.max(0, Math.min(t1, t2));
    const hi = Math.min(len, Math.max(t1, t2));
    if (hi - lo < MIN_SHARED) return null;
    return [e.ax + ux * lo, e.ay + uy * lo, e.ax + ux * hi, e.ay + uy * hi];
  }

  function regionEdges(regions) {
    const edges = [];
    regions.forEach((r, ri) => {
      const p = r.polygon;
      for (let k = 0; k < p.length; k++) {
        const [ax, ay] = p[k];
        const [bx, by] = p[(k + 1) % p.length];
        edges.push({
          r: ri,
          ax, ay, bx, by,
          minX: Math.min(ax, bx) - ON_LINE,
          maxX: Math.max(ax, bx) + ON_LINE,
          minY: Math.min(ay, by) - ON_LINE,
          maxY: Math.max(ay, by) + ON_LINE,
        });
      }
    });
    return edges;
  }

  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  function buildGraph(map) {
    const n = map.regions.length;
    const edges = regionEdges(map.regions);
    const borders = {}; // "i|j" -> list of shared segments [x1, y1, x2, y2]
    for (let a = 0; a < edges.length; a++) {
      const e = edges[a];
      for (let b = a + 1; b < edges.length; b++) {
        const f = edges[b];
        if (f.r === e.r) continue;
        if (f.minX > e.maxX || f.maxX < e.minX || f.minY > e.maxY || f.maxY < e.minY) continue;
        const seg = sharedPart(e, f);
        if (seg) (borders[pairKey(e.r, f.r)] ||= []).push(seg);
      }
    }

    const neighbors = Array.from({ length: n }, () => []);
    for (const key of Object.keys(borders)) {
      const [i, j] = key.split('|').map(Number);
      neighbors[i].push(j);
      neighbors[j].push(i);
    }
    neighbors.forEach((list) => list.sort((a, b) => a - b));

    // Regions that share a corner point but no border: shown to the reader as
    // "touches only at a point".
    const cornerOwners = new Map();
    map.regions.forEach((r, ri) => {
      for (const [x, y] of r.polygon) {
        const key = `${x},${y}`;
        if (!cornerOwners.has(key)) cornerOwners.set(key, new Set());
        cornerOwners.get(key).add(ri);
      }
    });
    const pointContacts = Array.from({ length: n }, () => []);
    for (const owners of cornerOwners.values()) {
      const list = [...owners];
      for (const i of list)
        for (const j of list)
          if (i !== j && !neighbors[i].includes(j) && !pointContacts[i].includes(j)) {
            pointContacts[i].push(j);
          }
    }
    pointContacts.forEach((list) => list.sort((a, b) => a - b));

    // Shared borders as polylines, and the point where a graph edge crosses
    // each border: halfway along the longest stretch.
    const borderLines = {};
    const crossing = {};
    for (const [key, segs] of Object.entries(borders)) {
      const lines = joinSegments(segs);
      borderLines[key] = lines;
      const longest = lines.reduce((a, b) => (polylineLength(a) >= polylineLength(b) ? a : b));
      crossing[key] = pointAlong(longest, polylineLength(longest) / 2).map(round2);
    }

    return { n, ids: map.ids, neighbors, borders, borderLines, crossing, pointContacts };
  }

  // Chain segments that meet end to start into polylines. The segments of one
  // border arrive in the order they appear around a polygon, so one pass plus
  // a wrap-around join is enough.
  function joinSegments(segs) {
    const same = (p, q) => Math.abs(p[0] - q[0]) < ON_LINE && Math.abs(p[1] - q[1]) < ON_LINE;
    const lines = [];
    for (const [x1, y1, x2, y2] of segs) {
      const last = lines[lines.length - 1];
      if (last && same(last[last.length - 1], [x1, y1])) last.push([x2, y2]);
      else lines.push([[x1, y1], [x2, y2]]);
    }
    if (lines.length > 1) {
      const first = lines[0];
      const last = lines[lines.length - 1];
      if (same(last[last.length - 1], first[0])) {
        lines[0] = last.concat(first.slice(1));
        lines.pop();
      }
    }
    return lines;
  }

  function polylineLength(line) {
    let len = 0;
    for (let k = 1; k < line.length; k++) {
      len += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
    }
    return len;
  }

  function pointAlong(line, dist) {
    for (let k = 1; k < line.length; k++) {
      const [ax, ay] = line[k - 1];
      const [bx, by] = line[k];
      const len = Math.hypot(bx - ax, by - ay);
      if (dist <= len && len > 0) return [ax + ((bx - ax) * dist) / len, ay + ((by - ay) * dist) / len];
      dist -= len;
    }
    return line[line.length - 1].slice();
  }

  // ---------------------------------------------------------------------------
  // Vertex orders for greedy coloring and backtracking
  // ---------------------------------------------------------------------------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const ORDERS = {
    alphabetical: {
      label: 'Alphabetical',
      make: (map, graph) => graph.ids.map((_, i) => i),
    },
    leftToRight: {
      label: 'Left to right',
      make: (map) =>
        map.regions
          .map((r, i) => i)
          .sort((a, b) => map.regions[a].label[0] - map.regions[b].label[0] || a - b),
    },
    mostNeighbors: {
      label: 'Most neighbors first',
      make: (map, graph) =>
        graph.ids
          .map((_, i) => i)
          .sort((a, b) => graph.neighbors[b].length - graph.neighbors[a].length || a - b),
    },
    random: {
      label: 'Random',
      make: (map, graph, seed) => {
        const rand = mulberry32(seed || 1);
        const order = graph.ids.map((_, i) => i);
        for (let k = order.length - 1; k > 0; k--) {
          const m = Math.floor(rand() * (k + 1));
          [order[k], order[m]] = [order[m], order[k]];
        }
        return order;
      },
    },
  };

  // ---------------------------------------------------------------------------
  // Algorithm traces
  //
  // Each algorithm records every decision as a step. A step carries a full
  // snapshot (colors 0 = uncolored, 1..4), so the page can move backwards and
  // forwards freely without re-running anything.
  // ---------------------------------------------------------------------------

  // Colors that region v may take: not used by a colored neighbor and not
  // already tried at this point of the search.
  function colorOptions(graph, colors, v, tried) {
    const blockers = {};
    for (let c = 1; c <= NUM_COLORS; c++) blockers[c] = [];
    for (const u of graph.neighbors[v]) if (colors[u]) blockers[colors[u]].push(u);
    const available = [];
    for (let c = 1; c <= NUM_COLORS; c++) {
      if (blockers[c].length === 0 && !(tried && tried.includes(c))) available.push(c);
    }
    return { available, blockers };
  }

  const countColors = (colors) => new Set(colors.filter((c) => c > 0)).size;

  // Greedy: visit regions in a fixed order and give each the smallest color not
  // used by a neighbor. A choice is never revised, so the run can get stuck.
  function greedyTrace(graph, order) {
    const colors = new Array(graph.n).fill(0);
    const setAt = new Array(graph.n).fill(-1); // step at which each color was chosen
    const steps = [{ kind: 'start', colors: colors.slice(), setAt: setAt.slice() }];
    for (let pos = 0; pos < order.length; pos++) {
      const v = order[pos];
      const { available, blockers } = colorOptions(graph, colors, v, null);
      if (available.length === 0) {
        steps.push({ kind: 'stuck', v, pos, blockers, colors: colors.slice(), setAt: setAt.slice() });
        return { algorithm: 'greedy', order, steps, success: false };
      }
      colors[v] = available[0];
      setAt[v] = steps.length;
      steps.push({
        kind: 'assign', v, pos, color: available[0], available, blockers,
        colors: colors.slice(), setAt: setAt.slice(),
      });
    }
    steps.push({ kind: 'done', colors: colors.slice(), setAt: setAt.slice(), used: countColors(colors) });
    return { algorithm: 'greedy', order, steps, success: true };
  }

  // DSATUR (Brélaz 1979): next, color the region whose colored neighbors show
  // the most different colors. Ties go to the region with the most uncolored
  // neighbors, then to the earlier letter. Like greedy, it never revises.
  function dsaturTrace(graph) {
    const n = graph.n;
    const colors = new Array(n).fill(0);
    const setAt = new Array(n).fill(-1);
    const order = [];
    const scores = () =>
      colors.map((c, v) => {
        if (c) return null;
        const seen = new Set();
        let free = 0;
        for (const u of graph.neighbors[v]) {
          if (colors[u]) seen.add(colors[u]);
          else free++;
        }
        return { saturation: seen.size, free };
      });
    const steps = [{ kind: 'start', colors: colors.slice(), setAt: setAt.slice(), scores: scores() }];
    for (let pos = 0; pos < n; pos++) {
      const sc = scores();
      let v = -1;
      for (let u = 0; u < n; u++) {
        if (!sc[u]) continue;
        if (
          v < 0 ||
          sc[u].saturation > sc[v].saturation ||
          (sc[u].saturation === sc[v].saturation && sc[u].free > sc[v].free)
        ) {
          v = u;
        }
      }
      // Why v won: 'saturation', 'free' (tie on saturation), or 'letter' (full tie).
      const rivals = sc.filter((s, u) => s && u !== v && s.saturation === sc[v].saturation);
      const reason = rivals.length === 0
        ? 'saturation'
        : rivals.every((s) => s.free < sc[v].free) ? 'free' : 'letter';
      order.push(v);
      const { available, blockers } = colorOptions(graph, colors, v, null);
      if (available.length === 0) {
        steps.push({ kind: 'stuck', v, pos, blockers, scores: sc, reason, colors: colors.slice(), setAt: setAt.slice() });
        return { algorithm: 'dsatur', order, steps, success: false };
      }
      colors[v] = available[0];
      setAt[v] = steps.length;
      steps.push({
        kind: 'assign', v, pos, color: available[0], available, blockers, scores: sc, reason,
        colors: colors.slice(), setAt: setAt.slice(),
      });
    }
    steps.push({ kind: 'done', colors: colors.slice(), setAt: setAt.slice(), used: countColors(colors) });
    return { algorithm: 'dsatur', order, steps, success: true };
  }

  // Backtracking: like greedy, but when a region has no color left, go back to
  // the previous region in the order and give it its next untried color.
  // This search always finds a four-coloring when one exists.
  function backtrackTrace(graph, order, maxSteps = 5000) {
    const n = graph.n;
    const colors = new Array(n).fill(0);
    const setAt = new Array(n).fill(-1);
    const tried = Array.from({ length: n }, () => []);
    let backtracks = 0;
    const snap = (extra) => ({
      ...extra,
      colors: colors.slice(),
      setAt: setAt.slice(),
      tried: tried.map((t) => t.slice()),
      backtracks,
    });
    const steps = [snap({ kind: 'start' })];
    let pos = 0;
    for (;;) {
      if (pos === order.length) {
        steps.push(snap({ kind: 'done', used: countColors(colors) }));
        return { algorithm: 'backtrack', order, steps, success: true };
      }
      if (steps.length >= maxSteps) {
        steps.push(snap({ kind: 'limit' }));
        return { algorithm: 'backtrack', order, steps, success: false };
      }
      const v = order[pos];
      const { available, blockers } = colorOptions(graph, colors, v, tried[v]);
      if (available.length > 0) {
        colors[v] = available[0];
        setAt[v] = steps.length;
        steps.push(snap({ kind: 'assign', v, pos, color: available[0], available, blockers }));
        pos++;
        continue;
      }
      steps.push(snap({ kind: 'deadend', v, pos, blockers }));
      tried[v] = [];
      if (pos === 0) {
        steps.push(snap({ kind: 'fail' }));
        return { algorithm: 'backtrack', order, steps, success: false };
      }
      pos--;
      const u = order[pos];
      const old = colors[u];
      tried[u].push(old);
      colors[u] = 0;
      setAt[u] = -1;
      backtracks++;
      steps.push(snap({ kind: 'undo', v: u, pos, color: old, from: v }));
    }
  }

  return {
    NUM_COLORS,
    SEA,
    buildMap,
    buildGraph,
    pointInPolygon,
    distToBoundary,
    ORDERS,
    colorOptions,
    greedyTrace,
    dsaturTrace,
    backtrackTrace,
    pairKey,
  };
});
