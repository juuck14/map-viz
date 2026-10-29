/*
 * Map coloring core: map geometry, neighbors, and step-by-step traces of
 * coloring algorithms. No DOM access, so the same file runs in the browser
 * (as window.MapCore) and in Node (tests and the map generator).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NUM_COLORS = 4;
  const FULL = (1 << NUM_COLORS) - 1;
  const bit = (c) => 1 << (c - 1);
  const popcount = (m) => ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1));
  const round1 = (v) => Math.round(v * 10) / 10;

  // ---------------------------------------------------------------------------
  // Maps
  //
  // A map's borders are stored as arcs: each border between two regions (or a
  // region and the sea) is one polyline, shared by both sides. A region lists
  // its arcs in clockwise order; ~k means arc k walked backwards.
  // ---------------------------------------------------------------------------

  function decodeArc(flat) {
    const pts = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < flat.length; i += 2) {
      x = i === 0 ? flat[0] : x + flat[i];
      y = i === 0 ? flat[1] : y + flat[i + 1];
      pts.push([x / 10, y / 10]);
    }
    return pts;
  }

  function buildMap(data) {
    const arcs = data.arcs.map(decodeArc);
    const users = arcs.map(() => []);
    const regions = data.regions.map((r, ri) => {
      const polygon = [];
      for (const ref of r.arcs) {
        const k = ref < 0 ? ~ref : ref;
        users[k].push(ri);
        const pts = ref < 0 ? arcs[k].slice().reverse() : arcs[k];
        polygon.push(...pts.slice(0, -1));
      }
      return { id: r.id, polygon };
    });
    regions.forEach((r, ri) => {
      r.area = Math.abs(signedArea(r.polygon));
      // The generator stores label points; compute them only if missing.
      const stored = data.regions[ri];
      const lab = stored.label ? { point: stored.label, clearance: stored.clearance } : labelPoint(r.polygon);
      r.label = lab.point;
      r.clearance = lab.clearance;
      r.path = 'M' + r.polygon.map(([x, y]) => `${x},${y}`).join('L') + 'Z';
    });
    const xs = regions.flatMap((r) => r.polygon.map((p) => p[0]));
    const ys = regions.flatMap((r) => r.polygon.map((p) => p[1]));
    const pad = 28;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return {
      id: data.id,
      title: data.title,
      note: data.note,
      ids: regions.map((r) => r.id),
      regions,
      arcs: arcs.map((pts, k) => ({ pts, users: users[k], coast: users[k].length === 1 })),
      viewBox: [minX, minY, Math.max(...xs) + pad - minX, Math.max(...ys) + pad - minY].map(round1),
      data,
    };
  }

  function signedArea(polygon) {
    let s = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      s += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    }
    return s / 2;
  }

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
      best = Math.min(best, distToSegment(x, y, polygon[b][0], polygon[b][1], polygon[a][0], polygon[a][1]));
    }
    return best;
  }

  // The interior point farthest from the border (where the label and the graph
  // vertex go): a coarse grid, then a few rounds of refinement around the best.
  function labelPoint(polygon) {
    const xs = polygon.map((p) => p[0]);
    const ys = polygon.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0;
    const h = Math.max(...ys) - y0;
    let step = Math.max(w, h) / 24;
    let cands = [];
    for (let x = x0 + step / 2; x < x0 + w; x += step)
      for (let y = y0 + step / 2; y < y0 + h; y += step) {
        if (pointInPolygon(x, y, polygon)) cands.push([x, y, distToBoundary(x, y, polygon)]);
      }
    if (!cands.length) cands.push([polygon[0][0], polygon[0][1], 0]);
    for (let round = 0; round < 4; round++) {
      cands.sort((a, b) => b[2] - a[2]);
      const top = cands.slice(0, 4);
      step /= 3;
      const next = top.slice();
      for (const [cx, cy] of top)
        for (let i = -2; i <= 2; i++)
          for (let j = -2; j <= 2; j++) {
            const x = cx + i * step;
            const y = cy + j * step;
            if ((i || j) && pointInPolygon(x, y, polygon)) next.push([x, y, distToBoundary(x, y, polygon)]);
          }
      cands = next;
    }
    cands.sort((a, b) => b[2] - a[2]);
    return { point: [round1(cands[0][0]), round1(cands[0][1])], clearance: round1(cands[0][2]) };
  }

  // ---------------------------------------------------------------------------
  // Neighbors: two regions are neighbors exactly when their borders overlap
  // along a segment of positive length. Touching at a single point does not
  // count. This looks only at the polygons, not at how the map was made.
  // ---------------------------------------------------------------------------

  const MIN_SHARED = 1e-3;
  const ON_LINE = 1e-3;

  function sharedPart(e, f) {
    const dx = e.bx - e.ax;
    const dy = e.by - e.ay;
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    const ux = dx / len;
    const uy = dy / len;
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

  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  function buildGraph(map) {
    const n = map.regions.length;
    const edges = [];
    map.regions.forEach((r, ri) => {
      const p = r.polygon;
      for (let k = 0; k < p.length; k++) {
        const [ax, ay] = p[k];
        const [bx, by] = p[(k + 1) % p.length];
        edges.push({ r: ri, ax, ay, bx, by, x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) });
      }
    });

    // Compare only edges that fall in the same bucket of a coarse grid. A pair
    // is handled in the one bucket that holds the corner of their overlap.
    const CELL = 32;
    const buckets = new Map();
    const bucketOf = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    edges.forEach((e, id) => {
      for (let gx = Math.floor((e.x0 - ON_LINE) / CELL); gx <= Math.floor((e.x1 + ON_LINE) / CELL); gx++)
        for (let gy = Math.floor((e.y0 - ON_LINE) / CELL); gy <= Math.floor((e.y1 + ON_LINE) / CELL); gy++) {
          const key = `${gx},${gy}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(id);
        }
    });
    const found = {};
    for (const [key, ids] of buckets) {
      for (let a = 0; a < ids.length; a++) {
        const e = edges[ids[a]];
        for (let b = a + 1; b < ids.length; b++) {
          const f = edges[ids[b]];
          if (f.r === e.r) continue;
          if (f.x0 > e.x1 + ON_LINE || f.x1 < e.x0 - ON_LINE || f.y0 > e.y1 + ON_LINE || f.y1 < e.y0 - ON_LINE) continue;
          if (bucketOf(Math.max(e.x0, f.x0) - ON_LINE, Math.max(e.y0, f.y0) - ON_LINE) !== key) continue;
          const seg = sharedPart(e, f);
          if (!seg) continue;
          const first = e.r < f.r ? ids[a] : ids[b];
          (found[pairKey(e.r, f.r)] ||= []).push([first, seg]);
        }
      }
    }

    const neighbors = Array.from({ length: n }, () => []);
    const borders = {};
    for (const [key, list] of Object.entries(found)) {
      const [i, j] = key.split('|').map(Number);
      neighbors[i].push(j);
      neighbors[j].push(i);
      // In the order they appear around the lower-numbered region.
      borders[key] = list.sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    }
    neighbors.forEach((list) => list.sort((a, b) => a - b));

    const cornerOwners = new Map();
    map.regions.forEach((r, ri) => {
      for (const [x, y] of r.polygon) {
        const key = `${x},${y}`;
        if (!cornerOwners.has(key)) cornerOwners.set(key, new Set());
        cornerOwners.get(key).add(ri);
      }
    });
    const pointContacts = Array.from({ length: n }, () => []);
    const contactPoints = []; // where regions touch without being neighbors
    for (const [key, owners] of cornerOwners) {
      let touching = false;
      for (const i of owners)
        for (const j of owners)
          if (i !== j && !neighbors[i].includes(j)) {
            touching = true;
            if (!pointContacts[i].includes(j)) pointContacts[i].push(j);
          }
      if (touching) contactPoints.push({ at: key.split(',').map(Number), regions: [...owners].sort((a, b) => a - b) });
    }
    pointContacts.forEach((list) => list.sort((a, b) => a - b));

    const borderLines = {};
    const crossing = {};
    for (const [key, segs] of Object.entries(borders)) {
      const lines = joinSegments(segs);
      borderLines[key] = lines;
      const longest = lines.reduce((a, b) => (polylineLength(a) >= polylineLength(b) ? a : b));
      crossing[key] = pointAlong(longest, polylineLength(longest) / 2).map(round1);
    }

    return { n, ids: map.ids, neighbors, borders, borderLines, crossing, pointContacts, contactPoints };
  }

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
    for (let k = 1; k < line.length; k++) len += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
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
  // Visiting orders for greedy and backtracking
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

  const range = (n) => Array.from({ length: n }, (_, i) => i);

  const ORDERS = {
    alphabetical: { label: 'Alphabetical', make: (map, graph) => range(graph.n) },
    leftToRight: {
      label: 'Left to right',
      make: (map, graph) => range(graph.n).sort((a, b) => map.regions[a].label[0] - map.regions[b].label[0] || a - b),
    },
    mostNeighbors: {
      label: 'Most neighbors first',
      make: (map, graph) => range(graph.n).sort((a, b) => graph.neighbors[b].length - graph.neighbors[a].length || a - b),
    },
    random: {
      label: 'Random',
      make: (map, graph, seed) => {
        const rand = mulberry32(seed || 1);
        const order = range(graph.n);
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
  // Each algorithm records every decision as a step with a full snapshot of
  // the colors (0 = uncolored, 1..4), so the page can move backwards and
  // forwards freely. Sets of colors are bit masks: color c is bit c-1.
  // ---------------------------------------------------------------------------

  function colorOptions(graph, colors, v, triedMask) {
    const blockers = [null, [], [], [], []];
    for (const u of graph.neighbors[v]) if (colors[u]) blockers[colors[u]].push(u);
    const available = [];
    for (let c = 1; c <= NUM_COLORS; c++) {
      if (blockers[c].length === 0 && !(triedMask & bit(c))) available.push(c);
    }
    return { available, blockers };
  }

  function countColors(colors) {
    let m = 0;
    for (const c of colors) if (c) m |= bit(c);
    return popcount(m);
  }

  function countConflicts(graph, colors) {
    let k = 0;
    for (let v = 0; v < graph.n; v++) for (const u of graph.neighbors[v]) if (u > v && colors[u] && colors[u] === colors[v]) k++;
    return k;
  }

  // Greedy: visit regions in a fixed order; each takes the lowest color no
  // neighbor has. A choice is never revised, so the run can get stuck.
  function greedyTrace(graph, order) {
    const colors = new Uint8Array(graph.n);
    const steps = [{ kind: 'start', colors: colors.slice() }];
    for (let pos = 0; pos < order.length; pos++) {
      const v = order[pos];
      const { available, blockers } = colorOptions(graph, colors, v, 0);
      if (!available.length) {
        steps.push({ kind: 'stuck', v, pos, blockers, colors: colors.slice() });
        return { algorithm: 'greedy', order, steps, success: false };
      }
      colors[v] = available[0];
      steps.push({ kind: 'assign', v, pos, color: available[0], available, blockers, colors: colors.slice() });
    }
    steps.push({ kind: 'done', colors: colors.slice(), used: countColors(colors) });
    return { algorithm: 'greedy', order, steps, success: true };
  }

  // DSATUR (Brélaz 1979): next, color the region whose colored neighbors show
  // the most different colors. Ties: most uncolored neighbors, then the
  // earlier letter. Never revises a choice.
  function dsaturScores(graph, colors) {
    return Array.from(colors, (c, v) => {
      if (c) return null;
      let seen = 0;
      let free = 0;
      for (const u of graph.neighbors[v]) {
        if (colors[u]) seen |= bit(colors[u]);
        else free++;
      }
      return { saturation: popcount(seen), free };
    });
  }

  function dsaturTrace(graph) {
    const colors = new Uint8Array(graph.n);
    const order = [];
    const steps = [{ kind: 'start', colors: colors.slice() }];
    for (let pos = 0; pos < graph.n; pos++) {
      const sc = dsaturScores(graph, colors);
      let v = -1;
      for (let u = 0; u < graph.n; u++) {
        if (!sc[u]) continue;
        if (v < 0 || sc[u].saturation > sc[v].saturation || (sc[u].saturation === sc[v].saturation && sc[u].free > sc[v].free)) v = u;
      }
      const rivals = sc.filter((s, u) => s && u !== v && s.saturation === sc[v].saturation);
      const reason = !rivals.length ? 'saturation' : rivals.every((s) => s.free < sc[v].free) ? 'free' : 'letter';
      order.push(v);
      const { available, blockers } = colorOptions(graph, colors, v, 0);
      if (!available.length) {
        steps.push({ kind: 'stuck', v, pos, blockers, score: sc[v], reason, colors: colors.slice() });
        return { algorithm: 'dsatur', order, steps, success: false };
      }
      colors[v] = available[0];
      steps.push({ kind: 'assign', v, pos, color: available[0], available, blockers, score: sc[v], reason, colors: colors.slice() });
    }
    steps.push({ kind: 'done', colors: colors.slice(), used: countColors(colors) });
    return { algorithm: 'dsatur', order, steps, success: true };
  }

  // Backtracking: like greedy, but at a dead end go back to the previous
  // region in the order and give it its next untried color. Finds a
  // four-coloring whenever one exists (given enough steps).
  //
  // The search tree is recorded too: one node per color tried, plus a leaf
  // for each dead end. step.cur is the deepest node on the current path.
  function backtrackTrace(graph, order, maxSteps = 20000) {
    const n = graph.n;
    const colors = new Uint8Array(n);
    const tried = new Uint8Array(n);
    const nodes = [];
    const nodeAt = new Int32Array(n).fill(-1); // node of the color set at each position
    let backtracks = 0;
    let cur = -1;
    const snap = (extra) => ({ ...extra, colors: colors.slice(), tried: tried.slice(), backtracks, cur });
    const steps = [snap({ kind: 'start' })];
    let pos = 0;
    for (;;) {
      if (pos === order.length) {
        steps.push(snap({ kind: 'done', used: countColors(colors) }));
        return { algorithm: 'backtrack', order, steps, nodes, success: true };
      }
      if (steps.length >= maxSteps) {
        steps.push(snap({ kind: 'limit' }));
        return { algorithm: 'backtrack', order, steps, nodes, success: false };
      }
      const v = order[pos];
      const { available, blockers } = colorOptions(graph, colors, v, tried[v]);
      if (available.length) {
        colors[v] = available[0];
        nodes.push({ parent: cur, v, color: available[0], step: steps.length });
        cur = nodeAt[pos] = nodes.length - 1;
        steps.push(snap({ kind: 'assign', v, pos, color: available[0], available, blockers }));
        pos++;
        continue;
      }
      nodes.push({ parent: cur, v, color: 0, dead: true, step: steps.length });
      steps.push(snap({ kind: 'deadend', v, pos, blockers }));
      tried[v] = 0;
      if (pos === 0) {
        steps.push(snap({ kind: 'fail' }));
        return { algorithm: 'backtrack', order, steps, nodes, success: false };
      }
      pos--;
      const u = order[pos];
      const old = colors[u];
      tried[u] |= bit(old);
      colors[u] = 0;
      backtracks++;
      nodes[nodeAt[pos]].undone = steps.length;
      cur = nodes[nodeAt[pos]].parent;
      steps.push(snap({ kind: 'undo', v: u, pos, color: old, from: v }));
    }
  }

  // Forward checking: every region keeps a set of colors still possible.
  // Coloring a region removes its color from the uncolored neighbors' sets. If
  // some set becomes empty, that choice is undone at once, before any more
  // regions are colored. The next region is either the next one in a fixed
  // order, or (order = null) the "most constrained" one: fewest colors left,
  // then most uncolored neighbors, then the earlier letter.
  function forwardCheckTrace(graph, order = null, maxSteps = 20000) {
    const n = graph.n;
    const colors = new Uint8Array(n);
    const domains = new Uint8Array(n).fill(FULL);
    const tried = new Uint8Array(n);
    const frames = []; // decisions on the current path: { v, color, pruned, node, why }
    const nodes = [];
    let backtracks = 0;
    let cur = -1;
    const snap = (extra) => ({ ...extra, colors: colors.slice(), domains: domains.slice(), tried: tried.slice(), backtracks, cur, depth: frames.length });
    const steps = [snap({ kind: 'start' })];

    const choose = () => {
      if (order) {
        const v = order.find((u) => !colors[u]);
        return v === undefined ? null : { v, fixed: true };
      }
      let best = -1;
      let bs = 0;
      let bf = 0;
      const free = (v) => graph.neighbors[v].filter((u) => !colors[u]).length;
      for (let v = 0; v < n; v++) {
        if (colors[v]) continue;
        const s = popcount(domains[v] & ~tried[v]);
        const f = free(v);
        if (best < 0 || s < bs || (s === bs && f > bf)) [best, bs, bf] = [v, s, f];
      }
      if (best < 0) return null;
      const rivals = range(n).filter((v) => !colors[v] && v !== best && popcount(domains[v] & ~tried[v]) === bs);
      const reason = !rivals.length ? 'fewest' : rivals.every((v) => free(v) < bf) ? 'free' : 'letter';
      return { v: best, left: bs, free: bf, reason };
    };
    const undo = (fr) => {
      colors[fr.v] = 0;
      for (const u of fr.pruned) domains[u] |= bit(fr.color);
      tried[fr.v] |= bit(fr.color);
      nodes[fr.node].undone = steps.length;
      cur = nodes[fr.node].parent;
    };

    let frame = null;
    for (;;) {
      if (steps.length >= maxSteps) {
        steps.push(snap({ kind: 'limit' }));
        return { algorithm: 'forward', order, steps, nodes, success: false };
      }
      if (!frame) {
        const why = choose();
        if (!why) {
          steps.push(snap({ kind: 'done', used: countColors(colors) }));
          return { algorithm: 'forward', order, steps, nodes, success: true };
        }
        frame = { v: why.v, why };
      }
      const v = frame.v;
      const options = domains[v] & ~tried[v];
      if (!options) {
        nodes.push({ parent: cur, v, color: 0, dead: true, step: steps.length });
        steps.push(snap({ kind: 'deadend', v, why: frame.why }));
        tried[v] = 0;
        if (!frames.length) {
          steps.push(snap({ kind: 'fail' }));
          return { algorithm: 'forward', order, steps, nodes, success: false };
        }
        frame = frames.pop();
        const old = frame.color;
        undo(frame);
        backtracks++;
        steps.push(snap({ kind: 'undo', v: frame.v, color: old, from: v }));
        continue;
      }
      let c = 1;
      while (!(options & bit(c))) c++;
      colors[v] = c;
      const pruned = [];
      let wiped = -1;
      for (const u of graph.neighbors[v]) {
        if (colors[u] || !(domains[u] & bit(c))) continue;
        domains[u] &= ~bit(c);
        pruned.push(u);
        if (!domains[u] && wiped < 0) wiped = u;
      }
      frame.color = c;
      frame.pruned = pruned;
      nodes.push({ parent: cur, v, color: c, step: steps.length });
      frame.node = cur = nodes.length - 1;
      const available = [];
      for (let k = 1; k <= NUM_COLORS; k++) if (options & bit(k)) available.push(k);
      steps.push(snap({ kind: 'assign', v, color: c, available, pruned, why: frame.why }));
      if (wiped >= 0) {
        nodes[cur].wipeout = wiped;
        steps.push(snap({ kind: 'wipeout', v, color: c, u: wiped }));
        undo(frame);
        steps.push(snap({ kind: 'undo', v, color: c, from: wiped, wipeout: true }));
        continue;
      }
      frames.push(frame);
      frame = null;
    }
  }

  // Peeling: repeatedly remove the region with the fewest neighbors left.
  // In any map some region has at most 5 neighbors (a consequence of Euler's
  // formula), so each removed region has at most 5 neighbors left at that
  // moment. Then regions come back in reverse order and are colored greedily.
  function peel(graph, steps, colors, peeled) {
    const left = graph.neighbors.map((l) => l.length);
    const order = [];
    for (let pos = 0; pos < graph.n; pos++) {
      let v = -1;
      for (let u = 0; u < graph.n; u++) if (!peeled[u] && (v < 0 || left[u] < left[v])) v = u;
      const degree = left[v];
      peeled[v] = 1;
      for (const u of graph.neighbors[v]) if (!peeled[u]) left[u]--;
      order.push(v);
      steps.push({ kind: 'peel', v, pos, degree, colors: colors.slice(), peeled: peeled.slice() });
    }
    return order;
  }

  function smallestLastTrace(graph) {
    const colors = new Uint8Array(graph.n);
    const peeled = new Uint8Array(graph.n);
    const steps = [{ kind: 'start', colors: colors.slice(), peeled: peeled.slice() }];
    const order = peel(graph, steps, colors, peeled);
    for (let k = order.length - 1; k >= 0; k--) {
      const v = order[k];
      peeled[v] = 0;
      const { available, blockers } = colorOptions(graph, colors, v, 0);
      if (!available.length) {
        steps.push({ kind: 'stuck', v, pos: k, blockers, colors: colors.slice(), peeled: peeled.slice() });
        return { algorithm: 'peeling', order, steps, success: false };
      }
      colors[v] = available[0];
      steps.push({ kind: 'assign', v, pos: k, color: available[0], available, blockers, colors: colors.slice(), peeled: peeled.slice() });
    }
    steps.push({ kind: 'done', colors: colors.slice(), peeled: peeled.slice(), used: countColors(colors) });
    return { algorithm: 'peeling', order, steps, success: true };
  }

  // Kempe chains. For colors a and b, a Kempe chain is a connected group of
  // regions colored a or b. Swapping a and b inside one chain keeps the
  // coloring valid. If every chain that holds an a-colored neighbor of v holds
  // no b-colored neighbor of v, swapping those chains frees color a for v.
  function kempeChain(graph, colors, start, a, b) {
    const seen = new Set([start]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      for (const u of graph.neighbors[queue[i]]) {
        if (!seen.has(u) && (colors[u] === a || colors[u] === b)) {
          seen.add(u);
          queue.push(u);
        }
      }
    }
    return [...seen].sort((x, y) => x - y);
  }

  // The smallest single swap that frees a color for v, or null.
  function findKempeSwap(graph, colors, v) {
    let best = null;
    for (let a = 1; a <= NUM_COLORS; a++) {
      for (let b = 1; b <= NUM_COLORS; b++) {
        if (a === b) continue;
        const na = graph.neighbors[v].filter((u) => colors[u] === a);
        const nb = new Set(graph.neighbors[v].filter((u) => colors[u] === b));
        if (!na.length) continue;
        const chain = new Set();
        for (const u of na) if (!chain.has(u)) for (const w of kempeChain(graph, colors, u, a, b)) chain.add(w);
        if ([...chain].some((w) => nb.has(w))) continue;
        if (!best || chain.size < best.chain.length) best = { a, b, chain: [...chain].sort((x, y) => x - y), starts: na };
      }
    }
    return best;
  }

  function applySwap(colors, { a, b, chain }) {
    for (const u of chain) colors[u] = colors[u] === a ? b : a;
  }

  // Kempe's own trick for the hard case: one swap that does not free a color
  // by itself, followed by one that does.
  function findDoubleSwap(graph, colors, v) {
    let best = null;
    for (let a = 1; a <= NUM_COLORS; a++) {
      for (let b = 1; b <= NUM_COLORS; b++) {
        if (a === b) continue;
        for (const u of graph.neighbors[v]) {
          if (colors[u] !== a) continue;
          const first = { a, b, chain: kempeChain(graph, colors, u, a, b), starts: [u] };
          const trial = colors.slice();
          applySwap(trial, first);
          const second = findKempeSwap(graph, trial, v);
          if (second && (!best || first.chain.length + second.chain.length < best[0].chain.length + best[1].chain.length)) {
            best = [first, second];
          }
        }
      }
    }
    return best;
  }

  // Greedy with Kempe repairs: follow the order like greedy; when a region has
  // no color left, look for a Kempe chain swap (or two, Kempe's trick for the
  // hard case) that frees a color, instead of giving up.
  function kempeTrace(graph, order) {
    const colors = new Uint8Array(graph.n);
    const steps = [{ kind: 'start', colors: colors.slice() }];
    let swaps = 0;
    for (let pos = 0; pos < order.length; pos++) {
      const v = order[pos];
      let { available, blockers } = colorOptions(graph, colors, v, 0);
      if (!available.length) {
        const single = findKempeSwap(graph, colors, v);
        const moves = single ? [single] : findDoubleSwap(graph, colors, v);
        if (!moves) {
          steps.push({ kind: 'stuck', v, pos, blockers, kempe: true, colors: colors.slice() });
          return { algorithm: 'kempe', order, steps, success: false, swaps };
        }
        moves.forEach((m, i) => {
          steps.push({ kind: 'chain', v, pos, ...m, blockers, part: i + 1, of: moves.length, colors: colors.slice() });
          applySwap(colors, m);
          swaps++;
          steps.push({ kind: 'swap', v, pos, ...m, part: i + 1, of: moves.length, colors: colors.slice() });
        });
        ({ available, blockers } = colorOptions(graph, colors, v, 0));
      }
      colors[v] = available[0];
      steps.push({ kind: 'assign', v, pos, color: available[0], available, blockers, colors: colors.slice() });
    }
    steps.push({ kind: 'done', colors: colors.slice(), used: countColors(colors), swaps });
    return { algorithm: 'kempe', order, steps, success: true, swaps };
  }

  // Local search (min-conflicts): start with every region colored at random,
  // then keep recoloring a region that clashes with a neighbor, choosing the
  // color with the fewest clashes. When no move helps, make a random one.
  function minConflictsTrace(graph, seed = 1, maxSteps = 4000) {
    const rand = mulberry32(seed * 7919 + 13);
    const n = graph.n;
    const colors = new Uint8Array(n);
    for (let v = 0; v < n; v++) colors[v] = 1 + Math.floor(rand() * NUM_COLORS);
    let conflicts = countConflicts(graph, colors);
    const steps = [{ kind: 'init', colors: colors.slice(), conflicts }];
    let last = -1;
    for (;;) {
      if (conflicts === 0) {
        steps.push({ kind: 'done', colors: colors.slice(), conflicts, used: countColors(colors) });
        return { algorithm: 'local', steps, success: true, seed };
      }
      if (steps.length >= maxSteps) {
        steps.push({ kind: 'limit', colors: colors.slice(), conflicts });
        return { algorithm: 'local', steps, success: false, seed };
      }
      const clashing = range(n).filter((v) => graph.neighbors[v].some((u) => colors[u] === colors[v]));
      for (let k = clashing.length - 1; k > 0; k--) {
        const m = Math.floor(rand() * (k + 1));
        [clashing[k], clashing[m]] = [clashing[m], clashing[k]];
      }
      let move = null;
      for (const v of clashing) {
        if (v === last && clashing.length > 1) continue; // do not move the same region twice in a row
        const counts = [0, 0, 0, 0, 0];
        for (const u of graph.neighbors[v]) counts[colors[u]]++;
        const from = colors[v];
        let best = Infinity;
        for (let c = 1; c <= NUM_COLORS; c++) if (c !== from) best = Math.min(best, counts[c]);
        if (best > counts[from]) continue;
        const options = [];
        for (let c = 1; c <= NUM_COLORS; c++) if (c !== from && counts[c] === best) options.push(c);
        move = { v, from, to: options[Math.floor(rand() * options.length)], counts: counts.slice(1), random: false };
        break;
      }
      if (!move) {
        const v = clashing[0];
        const counts = [0, 0, 0, 0, 0];
        for (const u of graph.neighbors[v]) counts[colors[u]]++;
        const from = colors[v];
        let to = 1 + Math.floor(rand() * (NUM_COLORS - 1));
        if (to >= from) to++;
        move = { v, from, to, counts: counts.slice(1), random: true };
      }
      colors[move.v] = move.to;
      last = move.v;
      conflicts = countConflicts(graph, colors);
      steps.push({ kind: 'move', ...move, colors: colors.slice(), conflicts });
    }
  }

  return {
    NUM_COLORS,
    bit,
    popcount,
    buildMap,
    buildGraph,
    labelPoint,
    pointInPolygon,
    distToBoundary,
    pairKey,
    ORDERS,
    colorOptions,
    countConflicts,
    kempeChain,
    greedyTrace,
    dsaturTrace,
    dsaturScores,
    backtrackTrace,
    forwardCheckTrace,
    smallestLastTrace,
    kempeTrace,
    minConflictsTrace,
  };
});
