/*
 * Page logic: draws the current map, handles manual coloring, and replays
 * algorithm traces from core.js one step at a time, with the charts from
 * charts.js showing the whole run.
 */
(function () {
  'use strict';

  const Core = window.MapCore;
  const Checker = window.MapChecker;
  const DATA = window.MapData;
  const Charts = window.MapCharts;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const N_COLORS = Core.NUM_COLORS;
  const COLOR_NAMES = ['', 'blue', 'ochre', 'rose', 'green'];

  // order: 'fixed' uses the order menu, 'mrv' adds "most constrained first",
  // 'own' means the algorithm picks its own order, 'none' has no order at all.
  const ALGOS = {
    greedy: {
      name: 'Greedy',
      order: 'fixed',
      desc:
        'Visit the regions in a fixed order. Each takes the lowest-numbered color that none of ' +
        'its neighbors has. A color, once set, is never changed.',
    },
    dsatur: {
      name: 'DSATUR',
      order: 'own',
      desc:
        'No fixed order. Next, color the region whose colored neighbors already show the most ' +
        'different colors (its saturation). Ties go to the region with more uncolored neighbors.',
    },
    peeling: {
      name: 'Peeling',
      order: 'own',
      desc:
        'First peel the map: again and again, remove the region with the fewest neighbors left. ' +
        'Then put the regions back in reverse order, coloring each like greedy. Every map has a ' +
        'region with at most five neighbors (a consequence of Euler’s formula), so each region ' +
        'comes back next to at most five colored ones.',
    },
    kempe: {
      name: 'Kempe chains',
      order: 'fixed',
      desc:
        'Greedy, but when a region has no color left, look for a Kempe chain: a connected group ' +
        'of regions in two colors, say 1 and 3. Swapping 1 and 3 inside the whole chain keeps the ' +
        'coloring valid and can free a color. Kempe built his 1879 “proof” of the Four Color ' +
        'Theorem on this idea.',
    },
    backtrack: {
      name: 'Backtracking',
      order: 'fixed',
      desc:
        'Greedy, but at a dead end go back to the previous region in the order and give it its ' +
        'next untried color. If that fails too, go back further. It always finds a coloring in ' +
        'the end, but the end can be very far away.',
    },
    forward: {
      name: 'Forward checking',
      order: 'mrv',
      desc:
        'Backtracking that looks ahead. Each region keeps a list of colors still possible; ' +
        'coloring a region crosses its color off its neighbors’ lists, and an empty list means: ' +
        'undo now, not later. With “most constrained first”, the region with the fewest colors ' +
        'left goes next.',
    },
    local: {
      name: 'Local search',
      order: 'none',
      desc:
        'Start with every region colored at random, clashes and all. Then keep picking a region ' +
        'that clashes and give it the color with the fewest clashes. No order and no going back: ' +
        'only repairs.',
    },
  };

  const state = {
    mapIndex: 0,
    mode: 'manual',
    showGraph: false,
    showLeft: false,
    brush: 1,
    manual: {},
    algo: 'greedy',
    orders: { greedy: 'alphabetical', kempe: 'alphabetical', backtrack: 'alphabetical', forward: 'mrv' },
    seed: 1,
    custom: {},
    picking: null,
    run: null,
    step: 0,
    playing: false,
    speed: 1.5,
    hover: -1,
  };

  const $ = (id) => document.getElementById(id);
  const built = {};
  let els = null;
  let timer = null;
  let hits = {};

  function current() {
    const data = DATA[state.mapIndex];
    if (!built[data.id]) {
      const map = Core.buildMap(data);
      built[data.id] = { data, map, graph: Core.buildGraph(map) };
    }
    return built[data.id];
  }

  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------------------------------------------------------------------------
  // Text helpers. Everything interpolated here is a region name or a number.
  // ---------------------------------------------------------------------------

  const name = (v) => `<b>${current().graph.ids[v]}</b>`;
  const swatch = (c) => `<i class="sw c${c}"></i>&nbsp;${c}`;
  const plural = (k, word, many) => `${k} ${k === 1 ? word : many || word + 's'}`;
  function listing(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  const names = (list) => listing(list.map(name));
  const bits = (mask) => [1, 2, 3, 4].filter((c) => mask & Core.bit(c));

  // ---------------------------------------------------------------------------
  // Drawing the map
  // ---------------------------------------------------------------------------

  function mountMap() {
    const { data, map, graph } = current();
    const svg = $('map');
    const [vx, vy, vw, vh] = map.viewBox;
    svg.setAttribute('viewBox', map.viewBox.join(' '));
    const title = svgEl('title', { id: 'map-title' });
    title.textContent = `Map "${data.title}" with ${map.ids.length} regions`;
    svg.replaceChildren(title);

    const defs = svgEl('defs', {}, svg);
    const shadow = svgEl('filter', { id: 'shadow', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
    svgEl('feGaussianBlur', { stdDeviation: 4 }, shadow);
    const grain = svgEl('filter', { id: 'grain', x: 0, y: 0, width: '100%', height: '100%' }, defs);
    svgEl('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.85, numOctaves: 2, seed: 4 }, grain);
    svgEl('feColorMatrix', { values: '0 0 0 0 0.32  0 0 0 0 0.27  0 0 0 0 0.2  0 0 0 0.55 0' }, grain);
    const hatch = svgEl('pattern', { id: 'peeled', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    svgEl('rect', { width: 7, height: 7, style: 'fill: var(--land)' }, hatch);
    svgEl('rect', { width: 2.2, height: 7, style: 'fill: var(--ink); fill-opacity: 0.22' }, hatch);

    // Shallow water: the land outline stroked wide, under the land.
    for (const [width, opacity] of [[36, 0.4], [22, 0.6], [10, 0.9]]) {
      const g = svgEl('g', { class: 'shallow', opacity }, svg);
      for (const r of map.regions) svgEl('path', { d: r.path, 'stroke-width': width }, g);
    }
    const shadowG = svgEl('g', { class: 'land-shadow', transform: 'translate(2,4)', filter: 'url(#shadow)', opacity: 0.32 }, svg);
    for (const r of map.regions) svgEl('path', { d: r.path }, shadowG);

    const gRegions = svgEl('g', {}, svg);
    svgEl('rect', { class: 'grain', x: vx, y: vy, width: vw, height: vh, filter: 'url(#grain)' }, svg);
    const gBorders = svgEl('g', {}, svg);
    const gConflicts = svgEl('g', {}, svg);
    const gOutlines = svgEl('g', {}, svg);
    const gContacts = svgEl('g', {}, svg);
    const gGraph = svgEl('g', { class: 'graph' }, svg);
    const gEdges = svgEl('g', {}, gGraph);
    const gVertices = svgEl('g', {}, gGraph);
    const gLabels = svgEl('g', { class: 'labels' }, svg);

    els = { regions: [], outlines: [], vertices: [], edges: [], labels: [], conflicts: gConflicts };
    map.regions.forEach((r, i) => {
      els.regions.push(svgEl('path', { d: r.path, class: 'region', 'data-i': i }, gRegions));
      els.outlines.push(svgEl('path', { d: r.path, class: 'outline' }, gOutlines));
    });
    for (const arc of map.arcs) {
      svgEl('path', { d: 'M' + arc.pts.map((p) => p.join(',')).join('L'), class: arc.coast ? 'border coast' : 'border' }, gBorders);
    }
    for (const { at } of graph.contactPoints) {
      const g = svgEl('g', { class: 'contact', transform: `translate(${at[0]},${at[1]})` }, gContacts);
      svgEl('circle', { r: 6.5 }, g);
      svgEl('circle', { r: 1.8, class: 'dot' }, g);
    }

    // Graph edges run through the middle of the border they stand for.
    const f = (v) => Math.round(v * 10) / 10;
    for (let i = 0; i < graph.n; i++) {
      for (const j of graph.neighbors[i]) {
        if (j < i) continue;
        const [x1, y1] = map.regions[i].label;
        const [x2, y2] = map.regions[j].label;
        const [mx, my] = graph.crossing[Core.pairKey(i, j)];
        const tx = (x2 - x1) / 6;
        const ty = (y2 - y1) / 6;
        const d =
          `M${x1},${y1}` +
          `C${f(x1 + (mx - x1) / 3)},${f(y1 + (my - y1) / 3)} ${f(mx - tx)},${f(my - ty)} ${mx},${my}` +
          `C${f(mx + tx)},${f(my + ty)} ${f(x2 - (x2 - mx) / 3)},${f(y2 - (y2 - my) / 3)} ${x2},${y2}`;
        els.edges.push({ i, j, el: svgEl('path', { d, class: 'edge' }, gEdges) });
      }
    }

    map.regions.forEach((r, i) => {
      const [x, y] = r.label;
      const size = Math.max(10, Math.min(20, r.clearance * 0.6));
      els.vertices.push(svgEl('circle', { cx: x, cy: y, r: Math.max(6, Math.min(13, r.clearance * 0.5)), class: 'vertex', 'data-i': i }, gVertices));
      const g = svgEl('g', { transform: `translate(${x},${y})` }, gLabels);
      svgEl('text', { class: 'label-letter', 'font-size': size }, g).textContent = r.id;
      const num = svgEl('text', { class: 'label-num', y: size * 0.95, 'font-size': size * 0.62 }, g);
      const s = Math.max(3.5, Math.min(6, size * 0.33));
      const glyph = svgEl('g', { class: 'glyph', transform: `translate(${-2 * s - 1.5},${size * 0.62})` }, g);
      const cells = [1, 2, 3, 4].map((c, k) => svgEl('rect', { x: k * (s + 1), width: s, height: s, rx: 1 }, glyph));
      const badge = svgEl('g', { class: 'badge', transform: `translate(0,${-size * 0.95 - 4})` }, g);
      const rect = svgEl('rect', { y: -7.5, height: 15, rx: 7.5 }, badge);
      const text = svgEl('text', {}, badge);
      els.labels.push({ num, glyph, cells, badge, rect, text, showNum: r.clearance >= 13 });
    });
  }

  function shownColors() {
    const { data, graph } = current();
    if (state.mode === 'manual') {
      if (!state.manual[data.id]) state.manual[data.id] = new Uint8Array(graph.n);
      return state.manual[data.id];
    }
    if (!state.run) return new Uint8Array(graph.n);
    return state.run.steps[state.step].colors;
  }

  function currentStep() {
    return state.mode === 'algo' && state.run ? state.run.steps[state.step] : null;
  }

  function conflictPairs(colors) {
    const { graph } = current();
    const pairs = [];
    for (let i = 0; i < graph.n; i++) {
      for (const j of graph.neighbors[i]) if (j > i && colors[i] && colors[i] === colors[j]) pairs.push([i, j]);
    }
    return pairs;
  }

  // The step at which region u got the color it has at step k.
  function colorSince(u, k) {
    const steps = state.run.steps;
    let j = k;
    while (j > 0 && steps[j - 1].colors[u] === steps[k].colors[u]) j--;
    return j;
  }

  function renderMap(colors) {
    const { graph } = current();
    $('map').classList.toggle('graph-on', state.showGraph);
    const marks = Array.from({ length: graph.n }, () => []);
    const badges = new Array(graph.n).fill(null);
    const st = currentStep();
    const k = state.step;

    if (state.mode === 'algo' && state.picking) {
      state.picking.forEach((v, i) => (badges[v] = { text: `${i + 1}` }));
    } else if (st) {
      const prev = k > 0 ? state.run.steps[k - 1].colors : colors;
      if (st.kind === 'assign' || st.kind === 'move') {
        marks[st.v].push('is-active');
        for (const u of graph.neighbors[st.v]) if (prev[u]) marks[u].push('is-context');
        if (st.kind === 'move') badges[st.v] = { text: `${st.from} → ${st.to}` };
      }
      if (st.kind === 'stuck' || st.kind === 'deadend') {
        marks[st.v].push('is-stuck');
        badges[st.v] = { text: 'no color left', kind: 'critical' };
        for (const u of graph.neighbors[st.v]) {
          if (!colors[u]) continue;
          marks[u].push('is-blocker');
          badges[u] = { text: `step ${colorSince(u, k)}` };
        }
      }
      if (st.kind === 'undo') {
        marks[st.v].push('is-undo');
        badges[st.v] = { text: `undo ${st.color}` };
      }
      if (st.kind === 'chain' || st.kind === 'swap') {
        marks[st.v].push('is-active');
        badges[st.v] = st.kind === 'chain' ? { text: 'no color left', kind: 'critical' } : { text: `${st.a} is free` };
        for (const u of st.chain) marks[u].push('is-chain');
        for (const u of st.starts) if (!badges[u]) badges[u] = { text: st.kind === 'chain' ? `${st.a}↔${st.b}` : 'swapped' };
      }
      if (st.kind === 'wipeout') {
        marks[st.v].push('is-active');
        marks[st.u].push('is-stuck');
        badges[st.u] = { text: 'nothing left', kind: 'critical' };
      }
      if (st.kind === 'assign' && st.pruned) for (const u of st.pruned) marks[u].push('is-pruned');
      if (st.kind === 'peel') {
        marks[st.v].push('is-active');
        badges[st.v] = { text: `${plural(st.degree, 'neighbor')} left` };
      }
      if (state.algo === 'dsatur' && !['done', 'stuck'].includes(st.kind)) {
        colors.forEach((c, u) => {
          if (c || badges[u]) return;
          let seen = 0;
          for (const w of graph.neighbors[u]) if (colors[w]) seen |= Core.bit(colors[w]);
          badges[u] = { text: `sat ${Core.popcount(seen)}`, kind: 'soft' };
        });
      }
    }
    if (state.hover >= 0) {
      marks[state.hover].push('is-hover');
      for (const u of graph.neighbors[state.hover]) marks[u].push('is-hover-nbr');
      for (const u of graph.pointContacts[state.hover]) marks[u].push('is-hover-point');
    }

    const peeled = st && st.peeled;
    els.regions.forEach((p, i) => {
      let cls = 'region';
      if (colors[i]) cls += ` c${colors[i]}`;
      else if (peeled && peeled[i]) cls += ' is-peeled';
      p.setAttribute('class', cls);
    });
    els.outlines.forEach((p, i) => p.setAttribute('class', ['outline', ...marks[i]].join(' ')));
    els.vertices.forEach((p, i) => {
      const cls = ['vertex'];
      if (colors[i]) cls.push(`c${colors[i]}`);
      for (const m of ['is-hover', 'is-active', 'is-stuck']) if (marks[i].includes(m)) cls.push(m);
      if (marks[i].includes('is-undo')) cls.push('is-active');
      p.setAttribute('class', cls.join(' '));
    });

    const focus = st && st.v != null ? st.v : -1;
    for (const { i, j, el } of els.edges) {
      const cls = ['edge'];
      if (colors[i] && colors[i] === colors[j]) cls.push('is-conflict');
      else if ([state.hover, focus].includes(i) || [state.hover, focus].includes(j)) cls.push('is-lit');
      el.setAttribute('class', cls.join(' '));
    }

    // "Colors left" glyphs for uncolored regions.
    const showLeft = state.showLeft && !(state.mode === 'algo' && (state.picking || state.algo === 'local'));
    els.labels.forEach((l, i) => {
      l.num.textContent = colors[i] && l.showNum ? `${colors[i]}` : '';
      const glyphOn = showLeft && !colors[i] && !(peeled && peeled[i]);
      l.glyph.style.display = glyphOn ? '' : 'none';
      if (glyphOn) {
        let left = 0;
        if (st && st.domains) left = st.domains[i] & ~(st.tried ? st.tried[i] : 0);
        else {
          left = (1 << N_COLORS) - 1;
          for (const u of graph.neighbors[i]) if (colors[u]) left &= ~Core.bit(colors[u]);
        }
        l.cells.forEach((cell, k) => cell.setAttribute('class', left & Core.bit(k + 1) ? `c${k + 1}` : 'off'));
      }
      const b = badges[i];
      l.badge.style.display = b ? '' : 'none';
      if (!b) return;
      l.badge.setAttribute('class', 'badge' + (b.kind ? ` badge-${b.kind}` : ''));
      l.text.textContent = b.text;
      let w = 10 + b.text.length * 5.6;
      try {
        w = 10 + l.text.getComputedTextLength();
      } catch (e) {
        // Not laid out yet: keep the estimate.
      }
      l.rect.setAttribute('x', -w / 2);
      l.rect.setAttribute('width', w);
    });

    els.conflicts.replaceChildren();
    for (const [i, j] of conflictPairs(colors)) {
      for (const line of graph.borderLines[Core.pairKey(i, j)]) {
        const d = 'M' + line.map(([x, y]) => `${x},${y}`).join('L');
        svgEl('path', { d, class: 'conflict-halo' }, els.conflicts);
        svgEl('path', { d, class: 'conflict-line' }, els.conflicts);
      }
    }
  }

  function renderInspector(colors) {
    const { graph } = current();
    const v = state.hover;
    if (v < 0) {
      $('inspector').innerHTML = 'Hover over a region (or a dot, in graph view) to see its neighbors.';
      return;
    }
    const nb = graph.neighbors[v];
    let text = `Region ${name(v)}${colors[v] ? ` (color ${colors[v]})` : ''}: ` +
      `${nb.length ? `${plural(nb.length, 'neighbor')}, ${names(nb)}` : 'no neighbors'}.`;
    const pts = graph.pointContacts[v];
    if (pts.length) {
      text += ` It touches ${names(pts)} only at a point, so ${pts.length === 1 ? 'that is not a neighbor' : 'those are not neighbors'}.`;
    }
    $('inspector').innerHTML = text;
  }

  // ---------------------------------------------------------------------------
  // Panels
  // ---------------------------------------------------------------------------

  function checkerVerdict(colors) {
    const { data, graph } = current();
    const coloring = {};
    graph.ids.forEach((id, i) => (coloring[id] = colors[i]));
    return Checker.checkColoring(data, coloring, N_COLORS);
  }

  function renderManual(colors) {
    const { graph } = current();
    for (const b of $('brushes').children) b.setAttribute('aria-checked', String(Number(b.dataset.brush) === state.brush));
    const colored = colors.filter((c) => c).length;
    const conflicts = conflictPairs(colors);
    $('manual-status').innerHTML =
      `${colored} of ${graph.n} regions colored · ` +
      (conflicts.length ? `<span class="tag-critical">${plural(conflicts.length, 'conflict')}</span>` : 'no conflicts');
    let verdict = '';
    if (conflicts.length) {
      const shown = conflicts.slice(0, 3).map(([i, j]) => `${name(i)} and ${name(j)}`);
      verdict =
        `<div class="note-bad"><strong>Conflict.</strong> ${listing(shown)}${conflicts.length > 3 ? ' (and more)' : ''} ` +
        'are neighbors with the same color. The dotted line marks the shared border.</div>';
    } else if (colored === graph.n) {
      const check = checkerVerdict(colors);
      verdict = check.complete
        ? `<div class="note-good"><strong>Valid coloring</strong> with ${plural(check.used, 'color')}. ` +
          'The independent checker agrees: no two neighbors share a color.</div>'
        : '<div class="note-bad"><strong>The checker disagrees</strong> with the map view. This is a bug; please report it.</div>';
    }
    $('manual-verdict').innerHTML = verdict;
  }

  // Which regions the strip lists, in what order.
  function stripOrder() {
    const run = state.run;
    if (!run) return [];
    if (run.order) return run.order;
    return firstColoredOrder(run);
  }

  function firstColoredOrder(run) {
    const n = current().graph.n;
    const seen = new Set();
    const out = [];
    for (const st of run.steps) {
      if (st.kind === 'assign' && !seen.has(st.v)) {
        seen.add(st.v);
        out.push(st.v);
      }
    }
    for (let v = 0; v < n; v++) if (!seen.has(v)) out.push(v);
    return out;
  }

  function renderOrderStrip(colors) {
    const strip = $('order-strip');
    const { graph } = current();
    const st = currentStep();
    const chip = (v, cls, sub, tried) =>
      `<li class="chip ${cls}"${v != null ? ` data-i="${v}"` : ''}><span class="chip-box${v != null && colors[v] ? ` c${colors[v]}` : ''}"` +
      `${sub ? ` title="${sub}"` : ''}>${v == null ? '?' : graph.ids[v]}</span>` +
      `<span class="chip-tried">${bits(tried || 0).map((c) => `<i class="c${c}" title="tried ${c}"></i>`).join('')}</span></li>`;

    if (state.picking) {
      let html = state.picking.map((v, k) => chip(v, '', `${k + 1}`)).join('');
      for (let k = state.picking.length; k < graph.n; k++) html += chip(null, 'is-unknown', '');
      strip.innerHTML = html;
      return;
    }
    if (!state.run || state.algo === 'local') {
      strip.innerHTML = '';
      return;
    }
    const order = stripOrder();
    const pos = order.indexOf(st.v);
    // Algorithms that choose as they go reveal their order step by step.
    let known = graph.n;
    if (state.algo === 'dsatur' || (state.algo === 'forward' && !state.run.order)) {
      const seen = new Set();
      for (let s = 0; s <= state.step; s++) {
        const x = state.run.steps[s];
        if (x.kind === 'assign') seen.add(x.v);
      }
      known = seen.size + (st.kind === 'deadend' && !seen.has(st.v) ? 1 : 0);
    }
    if (state.algo === 'peeling') {
      known = state.run.steps.slice(0, state.step + 1).filter((x) => x.kind === 'peel').length;
    }
    let html = '';
    order.forEach((v, k) => {
      if (k >= known) {
        html += chip(null, 'is-unknown', '');
        return;
      }
      const cls = [];
      if (v === st.v && st.kind !== 'done') cls.push(['stuck', 'deadend'].includes(st.kind) ? 'is-stuck' : 'is-active');
      if (['greedy', 'kempe'].includes(state.algo) && pos >= 0 && k > pos && st.kind !== 'done') cls.push('is-future');
      if (state.algo === 'greedy' && st.kind === 'start') cls.push('is-future');
      html += chip(v, cls.join(' '), `${k + 1}`, st.tried ? st.tried[v] : 0);
    });
    strip.innerHTML = html;
  }

  function describe(st, colors) {
    const { graph } = current();
    const algo = state.algo;
    const label = ALGOS[algo].name;
    const k = state.step;
    const prev = k > 0 ? state.run.steps[k - 1].colors : colors;
    const out = { title: '', body: [], tone: '' };
    const takers = (v, cs) => {
      const by = [null, [], [], [], []];
      for (const u of graph.neighbors[v]) if (cs[u]) by[cs[u]].push(u);
      return [1, 2, 3, 4].filter((c) => by[c].length).map((c) => `${swatch(c)} by ${names(by[c])}`);
    };

    switch (st.kind) {
      case 'start':
        out.title = 'Ready';
        if (algo === 'dsatur') out.body.push('Nothing is colored yet, so every saturation is 0. The small “sat” labels show each uncolored region’s saturation as the run goes on.');
        else if (algo === 'peeling') out.body.push('First the peeling: regions are removed one at a time, always the one with the fewest neighbors left.');
        else if (algo === 'forward') out.body.push('Nothing is colored yet; every region still has all four colors on its list. Turn on “Colors left” to see the lists.');
        else out.body.push(`Nothing is colored yet. ${label} will follow the order shown above.`);
        out.body.push('Press ▶ to play, or step with ▶| and the arrow keys. The charts below show the whole run; click them to jump.');
        break;

      case 'init':
        out.title = 'A random start';
        out.body.push(`Every region gets a random color. ${plural(st.conflicts, 'border clashes', 'borders clash')} (dotted lines).`);
        break;

      case 'peel':
        out.title = `Remove ${name(st.v)}`;
        out.body.push(`${name(st.v)} has the fewest neighbors left among the remaining regions: ${st.degree}. Set it aside; it will be colored after every region removed later.`);
        out.body.push('Euler’s formula guarantees that some region always has at most 5 neighbors left, so this never gets stuck.');
        break;

      case 'assign': {
        if (algo === 'peeling') {
          const back = graph.neighbors[st.v].filter((u) => prev[u]);
          out.title = `Put back ${name(st.v)}: color ${swatch(st.color)}`;
          out.body.push(`${name(st.v)} comes back next to ${plural(back.length, 'colored neighbor')}${back.length ? `: ${back.map((u) => `${name(u)} (${prev[u]})`).join(', ')}` : ''}.`);
          out.body.push(`Free: ${st.available.join(', ')}. Take the lowest, ${st.color}.`);
          break;
        }
        out.title = `Step ${k}: ${name(st.v)} gets color ${swatch(st.color)}`;
        if (algo === 'dsatur') {
          const s = st.score;
          if (st.reason === 'saturation') out.body.push(`Why ${name(st.v)}? Its colored neighbors show ${plural(s.saturation, 'different color')}, more than any other uncolored region.`);
          else if (st.reason === 'free') out.body.push(`Why ${name(st.v)}? It is tied for the highest saturation (${s.saturation}) and has the most uncolored neighbors (${s.free}).`);
          else out.body.push(`Why ${name(st.v)}? It is tied on saturation (${s.saturation}) and on uncolored neighbors (${s.free}); the tie goes to the earlier name.`);
        }
        if (algo === 'forward' && st.why && !st.why.fixed) {
          const w = st.why;
          if (w.reason === 'fewest') out.body.push(`Why ${name(st.v)}? It has the fewest colors left on its list: ${w.left}.`);
          else if (w.reason === 'free') out.body.push(`Why ${name(st.v)}? It is tied for the fewest colors left (${w.left}) and has the most uncolored neighbors (${w.free}).`);
          else out.body.push(`Why ${name(st.v)}? It is tied for the fewest colors left (${w.left}) and on uncolored neighbors (${w.free}); the tie goes to the earlier name.`);
        }
        const colored = graph.neighbors[st.v].filter((u) => prev[u]);
        out.body.push(colored.length ? `Colored neighbors: ${colored.map((u) => `${name(u)} (${prev[u]})`).join(', ')}.` : 'None of its neighbors has a color yet.');
        const tried = bits(st.tried ? st.tried[st.v] : 0);
        if (tried.length) out.body.push(`Already tried here and abandoned: ${tried.join(', ')}.`);
        out.body.push(`${tried.length ? 'Free and untried' : 'Free'}: ${st.available.join(', ')}. Take the lowest, ${st.color}.`);
        if (st.pruned) {
          out.body.push(st.pruned.length
            ? `Look-ahead: cross ${st.color} off the lists of ${names(st.pruned)} (dotted outlines).`
            : `Look-ahead: no uncolored neighbor still had ${st.color} on its list.`);
        }
        break;
      }

      case 'stuck':
        out.tone = 'critical';
        out.title = `<span class="tag-critical">✕ Stuck</span> at ${name(st.v)}`;
        out.body.push(`No color is left for ${name(st.v)}: color ${listing(takers(st.v, colors))}.`);
        if (st.kempe) {
          out.body.push('No Kempe chain swap, single or double, frees a color here. Kempe believed (1879) that swaps always work; Heawood showed in 1890 that they can fail.');
        } else {
          out.body.push(`${label} never changes a color once it is set, so the run ends here. The outlined neighbors got their colors at the steps marked on the map; a different choice there could have left a color free.`);
          out.body.push('This map can still be colored with four colors. Try Kempe chains or Backtracking with the same order, or Forward checking.');
        }
        break;

      case 'deadend': {
        out.tone = 'critical';
        out.title = `<span class="tag-critical">Dead end</span> at ${name(st.v)}`;
        const parts = takers(st.v, colors);
        const tried = bits(st.tried ? st.tried[st.v] : 0);
        if (tried.length) parts.push(`${tried.map(swatch).join(', ')} tried before`);
        out.body.push(`Every color is ruled out for ${name(st.v)}: ${listing(parts)}.`);
        if (algo === 'backtrack') {
          out.body.push(st.pos > 0 ? `Go back one step in the order, to ${name(state.run.order[st.pos - 1])}.` : 'There is no earlier choice to change.');
        } else {
          out.body.push('Go back to the most recent choice and try its next color.');
        }
        break;
      }

      case 'undo':
        out.title = `Back to ${name(st.v)}`;
        out.body.push(st.wipeout
          ? `Take back color ${swatch(st.color)} from ${name(st.v)} and mark it as tried. ${name(st.v)} tries its next color.`
          : `Erase ${name(st.v)}’s color ${swatch(st.color)} and mark it as tried. Next, ${name(st.v)} takes its next free, untried color. If none is left, the search goes back further.`);
        out.body.push(`Backtracks so far: ${st.backtracks}.`);
        break;

      case 'wipeout':
        out.tone = 'critical';
        out.title = `<span class="tag-critical">Look-ahead:</span> ${name(st.u)} would have nothing left`;
        out.body.push(`Coloring ${name(st.v)} with ${st.color} crossed ${st.color} off ${name(st.u)}’s list, and the list is now empty. Plain backtracking would only notice when it reaches ${name(st.u)}; forward checking undoes the choice right away.`);
        break;

      case 'chain': {
        out.tone = 'critical';
        out.title = `Kempe chain for ${name(st.v)}${st.of > 1 ? ` (swap ${st.part} of ${st.of})` : ''}`;
        out.body.push(`${name(st.v)} has no color left: color ${listing(takers(st.v, colors))}.`);
        out.body.push(`The outlined regions are colored ${st.a} or ${st.b} and connected to ${names(st.starts)}: a Kempe chain. Every neighbor of the chain colored ${st.a} or ${st.b} is in the chain, so swapping ${st.a} and ${st.b} inside it keeps the coloring valid.`);
        out.body.push(st.of > 1 && st.part === 1
          ? 'No single swap frees a color here. Kempe’s trick: swap this chain first, which changes the chains available next.'
          : `The chain contains no neighbor of ${name(st.v)} colored ${st.b}, so after the swap no neighbor has color ${st.a}.`);
        break;
      }

      case 'swap':
        out.title = `Swap ${st.a} ↔ ${st.b} in the chain`;
        out.body.push(`${plural(st.chain.length, 'region')} traded colors ${swatch(st.a)} and ${swatch(st.b)}. No border clashes.`);
        out.body.push(st.of > 1 && st.part === 1 ? 'Now look for a second chain.' : `Color ${st.a} is now free for ${name(st.v)}.`);
        break;

      case 'move': {
        out.title = `Recolor ${name(st.v)}: ${swatch(st.from)} → ${swatch(st.to)}`;
        const counts = st.counts.map((c, i) => `${i + 1}: ${c}`).join(', ');
        out.body.push(`${name(st.v)} clashes with a neighbor. How many neighbors have each color: ${counts}.`);
        out.body.push(st.random
          ? 'No other color would reduce the clashes, so take a random step to get out of the rut.'
          : `Color ${st.to} clashes least${st.counts[st.to - 1] === st.counts[st.from - 1] ? ' (no fewer than before, but moving on helps)' : ''}.`);
        out.body.push(`Clashing borders now: ${st.conflicts}.`);
        break;
      }

      case 'done': {
        out.tone = 'good';
        out.title = `<span class="tag-good">✓ Done</span>: ${plural(graph.n, 'region')}, ${plural(st.used, 'color')}`;
        const extra = {
          backtrack: ` It took ${plural(st.backtracks, 'backtrack')}.`,
          forward: ` It took ${plural(st.backtracks, 'backtrack')}.`,
          kempe: ` It needed ${plural(st.swaps, 'Kempe swap')}.`,
          local: ` It took ${plural(k - 1, 'repair')}.`,
        }[algo] || '';
        out.body.push(`Every region has a color and no neighbors share one.${extra}`);
        const check = checkerVerdict(colors);
        out.body.push(check.complete
          ? 'Independent check (from the generator’s neighbor list): valid.'
          : '<span class="tag-critical">Independent check failed.</span> This is a bug; please report it.');
        break;
      }

      case 'fail':
        out.tone = 'critical';
        out.title = '<span class="tag-critical">No four-coloring</span>';
        out.body.push('Every possibility was tried. This should never happen for a map drawn in the plane.');
        break;

      case 'limit':
        out.tone = 'critical';
        out.title = `Stopped after ${k} steps`;
        out.body.push(algo === 'local'
          ? 'The repairs keep going around in circles. Try a new random start.'
          : 'The search is lost in a huge tree of choices. Try another order, or Forward checking with “most constrained first”.');
        break;
    }
    return out;
  }

  function renderChoices(st, colors) {
    const box = $('choices');
    if (!st || st.v == null || ['done', 'peel', 'swap'].includes(st.kind)) {
      box.innerHTML = '';
      return;
    }
    const { graph } = current();
    const k = state.step;
    const before = ['assign', 'stuck', 'deadend', 'chain', 'move'].includes(st.kind) && k > 0 ? state.run.steps[k - 1].colors : colors;
    const v = st.kind === 'wipeout' ? st.u : st.v;
    const tried = st.tried ? st.tried[v] : 0;
    const by = [null, [], [], [], []];
    for (const u of graph.neighbors[v]) if (before[u] && u !== v) by[before[u]].push(u);
    let html = `<div class="choice"><span></span><span></span><span>Colors for ${name(v)}:</span></div>`;
    for (let c = 1; c <= N_COLORS; c++) {
      let cls;
      let text;
      if (st.kind === 'move') {
        cls = c === st.to ? 'is-chosen' : c === st.from ? 'is-blocked' : 'is-free';
        text = `${plural(st.counts[c - 1], 'neighbor')}${c === st.from ? ' · was' : ''}${c === st.to ? ' · chosen' : ''}`;
      } else if (by[c].length) {
        cls = 'is-blocked';
        text = `taken by ${names(by[c])}`;
      } else if (tried & Core.bit(c)) {
        cls = 'is-tried';
        text = 'tried, led to a dead end';
      } else if (st.kind === 'assign' && c === st.color) {
        cls = 'is-chosen';
        text = 'free · chosen';
      } else {
        cls = 'is-free';
        text = 'free';
      }
      html += `<div class="choice ${cls}"><span class="num">${c}</span><i class="sw c${c}"></i><span>${text}</span></div>`;
    }
    box.innerHTML = html;
  }

  function renderAlgo(colors) {
    const { graph } = current();
    const meta = ALGOS[state.algo];
    for (const b of $('algo-tabs').children) b.setAttribute('aria-selected', String(b.dataset.algo === state.algo));
    $('algo-desc').textContent = meta.desc;

    const select = $('order-select');
    const hasOrder = meta.order === 'fixed' || meta.order === 'mrv';
    $('order-row').hidden = !hasOrder && state.algo !== 'local';
    select.hidden = !hasOrder;
    select.previousElementSibling.hidden = !hasOrder;
    if (hasOrder) {
      const mrv = select.querySelector('option[value="mrv"]');
      mrv.hidden = mrv.disabled = meta.order !== 'mrv';
      select.value = state.orders[state.algo];
    }
    const key = hasOrder ? state.orders[state.algo] : null;
    const shuffle = $('order-shuffle');
    shuffle.hidden = !(key === 'random' || state.algo === 'local');
    shuffle.textContent = state.algo === 'local' ? 'New random start' : 'Shuffle';
    $('order-repick').hidden = key !== 'custom' || !!state.picking;

    renderOrderStrip(colors);

    const last = state.run ? state.run.steps.length - 1 : 0;
    const scrub = $('scrub');
    scrub.max = String(last);
    scrub.value = String(state.step);
    scrub.disabled = !state.run;
    $('step-count').textContent = state.run ? `Step ${state.step} of ${last}` : '';
    $('to-start').disabled = $('step-back').disabled = !state.run || state.step === 0;
    $('to-end').disabled = $('step-fwd').disabled = !state.run || state.step === last;
    $('play').disabled = !state.run;
    $('play').textContent = state.playing ? '❚❚' : '▶';
    $('play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');

    const explain = $('explain');
    if (state.picking) {
      explain.className = 'explain';
      explain.innerHTML =
        '<h3>Pick your own order</h3>' +
        `<p>Click the regions on the map in the order the algorithm should visit them (${state.picking.length} of ${graph.n} chosen).</p>`;
      $('choices').innerHTML = '';
      $('stats').textContent = '';
      return;
    }
    const st = currentStep();
    const d = describe(st, colors);
    explain.className = 'explain' + (d.tone ? ` is-${d.tone}` : '');
    explain.innerHTML = `<h3>${d.title}</h3>` + d.body.map((p) => `<p>${p}</p>`).join('');
    renderChoices(st, colors);

    const colored = colors.filter((c) => c).length;
    const used = new Set(colors.filter((c) => c)).size;
    const parts = [`colored ${colored} of ${graph.n}`, `colors used ${used}`];
    if (st.backtracks != null) parts.push(`backtracks ${st.backtracks}`);
    if (state.algo === 'kempe') parts.push(`swaps ${state.run.steps.slice(0, state.step + 1).filter((s) => s.kind === 'swap').length}`);
    if (state.algo === 'local') parts.push(`clashes ${st.conflicts}`);
    $('stats').textContent = parts.join(' · ');
  }

  // ---------------------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------------------

  function renderProcess() {
    const box = $('process');
    box.hidden = state.mode !== 'algo' || !state.run;
    if (box.hidden) return;
    const { graph } = current();
    const run = state.run;
    const st = currentStep();
    const rows = state.algo === 'local' ? graph.ids.map((_, i) => i) : stripOrder();
    $('process-caption').textContent = `${ALGOS[state.algo].name} on this map: ${plural(run.steps.length - 1, 'step')}${run.success ? '' : ', unfinished'}.`;
    $('timeline-title').textContent = 'Every region at every step';
    $('timeline-note').textContent =
      'One row per region (in the order of the strip above), one column per step; the color is the region’s color at that step. ' +
      (state.algo === 'backtrack' || state.algo === 'forward' ? 'Backtracking shows up as colors appearing and vanishing.' : 'Uncolored is light.');
    hits.timeline = Charts.timeline($('timeline'), run, rows, graph.ids, state.step, st.v != null ? st.v : -1);

    const detail = $('detail');
    const algo = state.algo;
    if (algo === 'backtrack' || algo === 'forward') {
      $('detail-title').textContent = 'Search tree';
      $('detail-note').textContent =
        'Each square is a color tried, one level down per region; ✕ marks a dead end. The ink line is the current path from the top. Gray branches were abandoned.';
      hits.detail = Charts.tree(detail, run, state.step);
    } else if (algo === 'local') {
      $('detail-title').textContent = 'Clashing borders';
      $('detail-note').textContent = 'How many borders have the same color on both sides after each repair. The run ends when this reaches 0.';
      hits.detail = Charts.line(detail, run, 'clashes', run.steps.map((s) => s.conflicts), state.step);
    } else if (algo === 'peeling') {
      $('detail-title').textContent = 'Neighbors left when each region is removed';
      $('detail-note').textContent =
        'Euler’s formula says this is never more than 5 (dashed line), which is why 6 colors always suffice. Here it stays far below.';
      const values = run.steps.map((s) => (s.kind === 'peel' ? { value: s.degree } : null));
      hits.detail = Charts.bars(detail, run, 'peel', values, 6, state.step, { ref: { value: 5, label: 'never above 5 (Euler)' }, zeroIsFine: true });
    } else {
      $('detail-title').textContent = 'Free colors at each decision';
      $('detail-note').textContent =
        algo === 'kempe'
          ? 'How many colors were free when each region was colored. Red marks a region with none left, where a Kempe swap stepped in.'
          : 'How many colors were free when each region was colored. Red marks a region with none left.';
      const values = run.steps.map((s) => {
        if (s.kind === 'assign') return { value: s.available.length };
        if (s.kind === 'stuck') return { value: 0 };
        if (s.kind === 'chain' && s.part === 1) return { value: 0 };
        return null;
      });
      hits.detail = Charts.bars(detail, run, 'free', values, 4, state.step);
    }
  }

  function render() {
    const { data } = current();
    for (const b of $('map-tabs').children) b.setAttribute('aria-selected', String(Number(b.dataset.i) === state.mapIndex));
    for (const b of $('mode-tabs').children) b.setAttribute('aria-selected', String(b.dataset.mode === state.mode));
    $('manual-panel').hidden = state.mode !== 'manual';
    $('algo-panel').hidden = state.mode !== 'algo';
    $('map-note').textContent = data.note;
    $('show-graph').checked = state.showGraph;
    $('show-left').checked = state.showLeft;

    const colors = shownColors();
    renderMap(colors);
    renderInspector(colors);
    if (state.mode === 'manual') renderManual(colors);
    else renderAlgo(colors);
    renderProcess();
  }

  // ---------------------------------------------------------------------------
  // Running algorithms
  // ---------------------------------------------------------------------------

  function computeRun() {
    const { data, map, graph } = current();
    stop();
    state.step = 0;
    state.picking = null;
    state.run = null;
    const algo = state.algo;
    if (algo === 'dsatur') state.run = Core.dsaturTrace(graph);
    else if (algo === 'peeling') state.run = Core.smallestLastTrace(graph);
    else if (algo === 'local') state.run = Core.minConflictsTrace(graph, state.seed);
    else {
      const key = state.orders[algo];
      let order = null;
      if (key === 'custom') {
        order = state.custom[data.id];
        if (!order) {
          state.picking = [];
          return;
        }
      } else if (key !== 'mrv') {
        order = Core.ORDERS[key].make(map, graph, state.seed);
      }
      if (algo === 'greedy') state.run = Core.greedyTrace(graph, order);
      else if (algo === 'kempe') state.run = Core.kempeTrace(graph, order);
      else if (algo === 'backtrack') state.run = Core.backtrackTrace(graph, order);
      else state.run = Core.forwardCheckTrace(graph, order);
    }
  }

  function stop() {
    state.playing = false;
    clearTimeout(timer);
  }

  function tick() {
    if (!state.playing || !state.run) return;
    const last = state.run.steps.length - 1;
    if (state.step < last) {
      // At high speeds, skip ahead several steps per frame.
      const per = Math.max(1, Math.round(state.speed / 30));
      state.step = Math.min(last, state.step + per);
      render();
      timer = setTimeout(tick, Math.max(16, 1000 / state.speed));
    } else {
      stop();
      render();
    }
  }

  function togglePlay() {
    if (!state.run) return;
    if (state.playing) stop();
    else {
      if (state.step === state.run.steps.length - 1) state.step = 0;
      state.playing = true;
      timer = setTimeout(tick, Math.min(300, 1000 / state.speed));
    }
    render();
  }

  function goTo(step) {
    if (!state.run) return;
    stop();
    state.step = Math.max(0, Math.min(state.run.steps.length - 1, step));
    render();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  function regionClicked(i) {
    const { data, graph } = current();
    if (state.mode === 'manual') {
      const colors = shownColors();
      colors[i] = state.brush === 0 || colors[i] === state.brush ? 0 : state.brush;
      render();
      return;
    }
    if (state.picking && !state.picking.includes(i)) {
      state.picking.push(i);
      if (state.picking.length === graph.n) {
        state.custom[data.id] = state.picking;
        computeRun();
      }
      render();
    }
  }

  function setup() {
    $('map-tabs').innerHTML = DATA.map(
      (d, i) => `<button role="tab" data-i="${i}">${d.title}<span class="count">${d.regions.length}</span></button>`
    ).join('');
    $('map-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.mapIndex = Number(b.dataset.i);
      state.hover = -1;
      mountMap();
      computeRun();
      render();
    });

    $('mode-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      stop();
      state.mode = b.dataset.mode;
      render();
    });
    $('show-graph').addEventListener('change', (e) => {
      state.showGraph = e.target.checked;
      render();
    });
    $('show-left').addEventListener('change', (e) => {
      state.showLeft = e.target.checked;
      render();
    });

    let brushes = '';
    for (let c = 1; c <= N_COLORS; c++) {
      brushes += `<button class="brush" role="radio" data-brush="${c}" aria-label="Color ${c}, ${COLOR_NAMES[c]}"><i class="sw c${c}"></i>${c}</button>`;
    }
    brushes += '<button class="brush" role="radio" data-brush="0" aria-label="Eraser"><i class="sw erase"></i>erase</button>';
    $('brushes').innerHTML = brushes;
    $('brushes').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.brush = Number(b.dataset.brush);
      render();
    });
    $('manual-clear').addEventListener('click', () => {
      shownColors().fill(0);
      render();
    });

    $('algo-tabs').innerHTML = Object.entries(ALGOS)
      .map(([key, a]) => `<button role="tab" data-algo="${key}">${a.name}</button>`)
      .join('');
    $('algo-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.algo = b.dataset.algo;
      state.showLeft = state.algo === 'forward' ? true : state.showLeft;
      computeRun();
      render();
    });

    const select = $('order-select');
    select.innerHTML =
      '<option value="mrv">Most constrained first</option>' +
      Object.entries(Core.ORDERS).map(([key, o]) => `<option value="${key}">${o.label}</option>`).join('') +
      '<option value="custom">Your own order (click regions)</option>';
    select.addEventListener('change', () => {
      state.orders[state.algo] = select.value;
      computeRun();
      render();
    });
    $('order-shuffle').addEventListener('click', () => {
      state.seed++;
      computeRun();
      render();
    });
    $('order-repick').addEventListener('click', () => {
      delete state.custom[current().data.id];
      computeRun();
      render();
    });

    $('to-start').addEventListener('click', () => goTo(0));
    $('step-back').addEventListener('click', () => goTo(state.step - 1));
    $('step-fwd').addEventListener('click', () => goTo(state.step + 1));
    $('to-end').addEventListener('click', () => goTo(Infinity));
    $('play').addEventListener('click', togglePlay);
    $('speed').addEventListener('change', (e) => (state.speed = Number(e.target.value)));
    $('scrub').addEventListener('input', (e) => goTo(Number(e.target.value)));

    for (const id of ['timeline', 'detail']) {
      $(id).addEventListener('click', (e) => {
        const r = e.target.getBoundingClientRect();
        const s = hits[id] && hits[id](e.clientX - r.left, e.clientY - r.top);
        if (s != null) goTo(s);
      });
    }
    $('order-strip').addEventListener('pointerover', (e) => {
      const li = e.target.closest('[data-i]');
      const i = li ? Number(li.dataset.i) : -1;
      if (i !== state.hover) {
        state.hover = i;
        render();
      }
    });
    $('order-strip').addEventListener('pointerleave', () => {
      state.hover = -1;
      render();
    });

    document.addEventListener('keydown', (e) => {
      if (state.mode !== 'algo' || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target.closest('input, select, textarea, button')) return;
      const keys = {
        ArrowRight: () => goTo(state.step + 1),
        ArrowLeft: () => goTo(state.step - 1),
        Home: () => goTo(0),
        End: () => goTo(Infinity),
        ' ': togglePlay,
      };
      if (keys[e.key]) {
        e.preventDefault();
        keys[e.key]();
      }
    });

    const svg = $('map');
    const indexOf = (e) => {
      const t = e.target.closest('[data-i]');
      return t ? Number(t.dataset.i) : -1;
    };
    svg.addEventListener('click', (e) => {
      const i = indexOf(e);
      if (i >= 0) regionClicked(i);
    });
    svg.addEventListener('pointerover', (e) => {
      const i = indexOf(e);
      if (i !== state.hover) {
        state.hover = i;
        render();
      }
    });
    svg.addEventListener('pointerleave', () => {
      state.hover = -1;
      render();
    });
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderProcess, 120);
    });

    mountMap();
    computeRun();
    render();
  }

  setup();
})();
