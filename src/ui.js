/*
 * Page logic: draws the current map, handles manual coloring, and replays
 * algorithm traces from core.js one step at a time.
 */
(function () {
  'use strict';

  const Core = window.MapCore;
  const Checker = window.MapChecker;
  const SPECS = window.MapSpecs;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const N_COLORS = Core.NUM_COLORS;

  const ALGOS = {
    greedy: {
      desc:
        'Visit the regions in a fixed order. Give each one the lowest-numbered color that ' +
        'none of its neighbors has. A color, once set, is never changed.',
    },
    dsatur: {
      desc:
        'Like greedy, but there is no fixed order. Next, color the region whose colored ' +
        'neighbors already show the most different colors (its saturation). Ties go to the ' +
        'region with more uncolored neighbors.',
    },
    backtrack: {
      desc:
        'Like greedy, but when a region has no color left, go back to the previous region ' +
        'and give it its next untried color. If that fails too, go back further.',
    },
  };

  const state = {
    mapIndex: 0,
    mode: 'manual',
    showGraph: false,
    brush: 1,
    manual: {}, // map id -> colors
    algo: 'greedy',
    orderKey: 'alphabetical', // a key of Core.ORDERS, or 'custom'
    seed: 1,
    custom: {}, // map id -> order picked by the reader
    picking: null, // regions clicked so far while picking an order
    run: null,
    step: 0,
    playing: false,
    speed: 1.25,
    hover: -1,
  };

  const $ = (id) => document.getElementById(id);
  const built = {};
  let els = null;
  let timer = null;

  function current() {
    const spec = SPECS[state.mapIndex];
    if (!built[spec.id]) {
      const map = Core.buildMap(spec);
      built[spec.id] = { spec, map, graph: Core.buildGraph(map) };
    }
    return built[spec.id];
  }

  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------------------------------------------------------------------------
  // Text helpers. Everything interpolated here is a region letter or a number.
  // ---------------------------------------------------------------------------

  const letter = (v) => `<b>${current().graph.ids[v]}</b>`;
  const swatch = (c) => `<i class="sw c${c}"></i>&nbsp;${c}`;
  const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  function listing(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  // ---------------------------------------------------------------------------
  // Drawing the map
  // ---------------------------------------------------------------------------

  function mountMap() {
    const { spec, map, graph } = current();
    const svg = $('map');
    svg.setAttribute('viewBox', map.viewBox.join(' '));
    const title = svgEl('title', { id: 'map-title' });
    title.textContent = `Map "${spec.title}" with ${map.ids.length} regions, ${map.ids.join(', ')}`;
    svg.replaceChildren(title);

    const gRegions = svgEl('g', {}, svg);
    const gConflicts = svgEl('g', {}, svg);
    const gOutlines = svgEl('g', {}, svg);
    const gGraph = svgEl('g', { class: 'graph' }, svg);
    const gEdges = svgEl('g', {}, gGraph);
    const gVertices = svgEl('g', {}, gGraph);
    const gLabels = svgEl('g', { class: 'labels' }, svg);

    els = { regions: [], outlines: [], vertices: [], edges: [], labels: [], conflicts: gConflicts };
    map.regions.forEach((r, i) => {
      els.regions.push(svgEl('path', { d: r.path, class: 'region', 'data-i': i }, gRegions));
      els.outlines.push(svgEl('path', { d: r.path, class: 'outline' }, gOutlines));
    });

    // Each graph edge is a smooth curve through the middle of the border it
    // stands for (two cubic pieces, Catmull-Rom style, so it does not overshoot).
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
      els.vertices.push(svgEl('circle', { cx: x, cy: y, r: 15, class: 'vertex', 'data-i': i }, gVertices));
      const g = svgEl('g', { transform: `translate(${x},${y})` }, gLabels);
      svgEl('text', { class: 'label-letter' }, g).textContent = r.id;
      const num = svgEl('text', { class: 'label-num', y: 21 }, g);
      const badge = svgEl('g', { class: 'badge', transform: 'translate(0,-27)' }, g);
      const rect = svgEl('rect', { y: -9, height: 18, rx: 9 }, badge);
      const text = svgEl('text', {}, badge);
      els.labels.push({ num, badge, rect, text });
    });
  }

  function shownColors() {
    const { spec, graph } = current();
    if (state.mode === 'manual') {
      if (!state.manual[spec.id]) state.manual[spec.id] = new Array(graph.n).fill(0);
      return state.manual[spec.id];
    }
    if (!state.run) return new Array(graph.n).fill(0);
    return state.run.steps[state.step].colors;
  }

  function currentStep() {
    return state.mode === 'algo' && state.run ? state.run.steps[state.step] : null;
  }

  function conflictPairs(colors) {
    const { graph } = current();
    const pairs = [];
    for (let i = 0; i < graph.n; i++) {
      for (const j of graph.neighbors[i]) {
        if (j > i && colors[i] && colors[i] === colors[j]) pairs.push([i, j]);
      }
    }
    return pairs;
  }

  function renderMap(colors) {
    const { graph } = current();
    $('map').classList.toggle('graph-on', state.showGraph);

    const marks = Array.from({ length: graph.n }, () => []);
    const badges = new Array(graph.n).fill(null);
    const st = currentStep();
    if (state.mode === 'algo' && state.picking) {
      state.picking.forEach((v, k) => (badges[v] = { text: `${k + 1}` }));
    } else if (st) {
      if (st.kind === 'assign') {
        marks[st.v].push('is-active');
        for (const u of graph.neighbors[st.v]) if (colors[u]) marks[u].push('is-context');
      } else if (st.kind === 'stuck' || st.kind === 'deadend') {
        marks[st.v].push('is-stuck');
        badges[st.v] = { text: 'no color left', kind: 'critical' };
        for (const u of graph.neighbors[st.v]) {
          if (!colors[u]) continue;
          marks[u].push('is-blocker');
          badges[u] = { text: `step ${st.setAt[u]}` };
        }
      } else if (st.kind === 'undo') {
        marks[st.v].push('is-undo');
        badges[st.v] = { text: `undo ${st.color}` };
      }
      if (state.algo === 'dsatur' && st.kind !== 'done' && st.kind !== 'stuck') {
        colors.forEach((c, u) => {
          if (c || badges[u]) return;
          const seen = new Set(graph.neighbors[u].map((w) => colors[w]).filter((x) => x));
          badges[u] = { text: `sat ${seen.size}`, kind: 'soft' };
        });
      }
    }
    if (state.hover >= 0) {
      marks[state.hover].push('is-hover');
      for (const u of graph.neighbors[state.hover]) marks[u].push('is-hover-nbr');
      for (const u of graph.pointContacts[state.hover]) marks[u].push('is-hover-point');
    }

    els.regions.forEach((p, i) => p.setAttribute('class', 'region' + (colors[i] ? ` c${colors[i]}` : '')));
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

    els.labels.forEach((l, i) => {
      l.num.textContent = colors[i] ? `${colors[i]}` : '';
      const b = badges[i];
      l.badge.style.display = b ? '' : 'none';
      if (!b) return;
      l.badge.setAttribute('class', 'badge' + (b.kind ? ` badge-${b.kind}` : ''));
      l.text.textContent = b.text;
      let w = 12 + b.text.length * 6.4;
      try {
        w = 12 + l.text.getComputedTextLength();
      } catch (e) {
        // Not laid out yet: keep the estimate.
      }
      l.rect.setAttribute('x', -w / 2);
      l.rect.setAttribute('width', w);
    });

    // Conflicts: dotted line along every border whose two sides share a color.
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
    const nbrs = graph.neighbors[v].map((u) => letter(u));
    let text = `Region ${letter(v)}${colors[v] ? ` (color ${colors[v]})` : ''}: ` +
      `${nbrs.length ? `neighbors ${listing(nbrs)}` : 'no neighbors'}.`;
    const pts = graph.pointContacts[v].map((u) => letter(u));
    if (pts.length) {
      text += ` It touches ${listing(pts)} only at a point, so ${pts.length === 1 ? 'that is' : 'those are'} not ${pts.length === 1 ? 'a neighbor' : 'neighbors'}.`;
    }
    $('inspector').innerHTML = text;
  }

  // ---------------------------------------------------------------------------
  // Panels
  // ---------------------------------------------------------------------------

  function checkerVerdict(colors) {
    const { spec, graph } = current();
    const coloring = {};
    graph.ids.forEach((id, i) => (coloring[id] = colors[i]));
    return Checker.checkColoring(spec.grid, coloring, N_COLORS);
  }

  function renderManual(colors) {
    const { graph } = current();
    for (const b of $('brushes').children) {
      b.setAttribute('aria-checked', String(Number(b.dataset.brush) === state.brush));
    }
    const colored = colors.filter((c) => c).length;
    const conflicts = conflictPairs(colors);
    $('manual-status').innerHTML =
      `${colored} of ${graph.n} regions colored · ` +
      (conflicts.length ? `<span class="tag-critical">${plural(conflicts.length, 'conflict')}</span>` : 'no conflicts');

    let verdict = '';
    if (conflicts.length) {
      const shown = conflicts.slice(0, 3).map(([i, j]) => `${letter(i)} and ${letter(j)}`);
      verdict =
        `<div class="note-bad"><strong>Conflict.</strong> ${listing(shown)}` +
        `${conflicts.length > 3 ? ' (and more)' : ''} are neighbors with the same color. ` +
        'The dotted line marks the shared border.</div>';
    } else if (colored === graph.n) {
      const check = checkerVerdict(colors);
      verdict = check.complete
        ? `<div class="note-good"><strong>Valid coloring</strong> with ${plural(check.used, 'color')}. ` +
          'The independent checker agrees: no two neighbors share a color.</div>'
        : '<div class="note-bad"><strong>The checker disagrees</strong> with the map view. ' +
          'This is a bug; please report it.</div>';
    }
    $('manual-verdict').innerHTML = verdict;
  }

  function renderOrderStrip(colors) {
    const strip = $('order-strip');
    const { graph } = current();
    const st = currentStep();
    const chip = (v, cls, sub, tried) =>
      `<li class="chip ${cls}"><span class="chip-box${v != null && colors[v] ? ` c${colors[v]}` : ''}">` +
      `${v == null ? '?' : graph.ids[v]}</span>` +
      `<span class="chip-tried">${(tried || []).map((c) => `<i class="c${c}" title="tried ${c}"></i>`).join('')}</span>` +
      `<span class="chip-pos">${sub}</span></li>`;

    if (state.picking) {
      let html = state.picking.map((v, k) => chip(v, '', k + 1)).join('');
      for (let k = state.picking.length; k < graph.n; k++) html += chip(null, 'is-unknown', k + 1);
      strip.innerHTML = html;
      return;
    }
    const run = state.run;
    const pos = st.pos == null ? (st.kind === 'done' ? run.order.length : -1) : st.pos;
    const known = state.algo === 'dsatur' ? (st.kind === 'start' ? 0 : st.kind === 'done' ? graph.n : pos + 1) : graph.n;
    let html = '';
    run.order.forEach((v, k) => {
      if (k >= known) {
        html += chip(null, 'is-unknown', k + 1);
        return;
      }
      const cls = [];
      if (k === pos && st.kind !== 'done') cls.push(st.kind === 'stuck' || st.kind === 'deadend' ? 'is-stuck' : 'is-active');
      if (state.algo !== 'backtrack' && k > pos && st.kind !== 'done') cls.push('is-future');
      html += chip(v, cls.join(' '), k + 1, st.tried ? st.tried[v] : null);
    });
    for (let k = run.order.length; k < known; k++) html += chip(null, 'is-unknown', k + 1);
    strip.innerHTML = html;
  }

  function describe(st, colors) {
    const { graph } = current();
    const algo = state.algo;
    const name = { greedy: 'Greedy', dsatur: 'DSATUR', backtrack: 'Backtracking' }[algo];
    const k = state.step;
    const out = { title: '', body: [], tone: '' };
    const colorTakers = (blockers) =>
      Object.keys(blockers)
        .filter((c) => blockers[c].length)
        .map((c) => `${swatch(c)} by ${listing(blockers[c].map(letter))}`);

    switch (st.kind) {
      case 'start':
        out.title = 'Ready';
        out.body.push(
          algo === 'dsatur'
            ? 'Nothing is colored yet, so every saturation is 0. The small “sat” labels on the map show each uncolored region’s saturation as the run goes on.'
            : `Nothing is colored yet. ${name} will follow the order shown above.`
        );
        out.body.push('Press ▶ to play, or step with ▶| and the arrow keys.');
        break;

      case 'assign': {
        out.title = `Step ${k}: ${letter(st.v)} gets color ${swatch(st.color)}`;
        if (algo === 'dsatur') {
          const s = st.scores[st.v];
          if (st.reason === 'saturation') {
            out.body.push(`Why ${letter(st.v)}? Its colored neighbors show ${plural(s.saturation, 'different color')}, more than any other uncolored region.`);
          } else if (st.reason === 'free') {
            out.body.push(`Why ${letter(st.v)}? It is tied for the highest saturation (${s.saturation}) and has the most uncolored neighbors (${s.free}).`);
          } else {
            out.body.push(`Why ${letter(st.v)}? It is tied on saturation (${s.saturation}) and on uncolored neighbors (${s.free}); the tie goes to the earlier letter.`);
          }
        }
        const coloredNbrs = graph.neighbors[st.v].filter((u) => colors[u] && u !== st.v);
        if (coloredNbrs.length === 0) {
          out.body.push('None of its neighbors has a color yet.');
        } else {
          out.body.push(`Colored neighbors: ${coloredNbrs.map((u) => `${letter(u)} (${colors[u]})`).join(', ')}.`);
        }
        const tried = st.tried ? st.tried[st.v] : [];
        if (tried.length) out.body.push(`Already tried here and abandoned: ${tried.join(', ')}.`);
        out.body.push(
          `${tried.length ? 'Free and untried' : 'Free'}: ${st.available.join(', ')}. Take the lowest, ${st.color}.`
        );
        break;
      }

      case 'stuck':
        out.tone = 'critical';
        out.title = `<span class="tag-critical">✕ Stuck</span> at ${letter(st.v)}`;
        out.body.push(`No color is left for ${letter(st.v)}: color ${listing(colorTakers(st.blockers))}.`);
        out.body.push(
          `${name} never changes a color once it is set, so the run ends here. The outlined ` +
          'neighbors got their colors at the steps marked on the map; a different choice there ' +
          `could have left a color free for ${letter(st.v)}.`
        );
        out.body.push(
          'This map can still be colored with four colors. Try Backtracking with the same order, ' +
          'or DSATUR.'
        );
        break;

      case 'deadend': {
        out.tone = 'critical';
        out.title = `<span class="tag-critical">Dead end</span> at ${letter(st.v)}`;
        const tried = st.tried[st.v];
        const parts = colorTakers(st.blockers);
        if (tried.length) parts.push(`${tried.map((c) => swatch(c)).join(', ')} tried before`);
        out.body.push(`Every color is ruled out for ${letter(st.v)}: ${listing(parts)}.`);
        out.body.push(
          st.pos > 0
            ? `Go back one step in the order, to ${letter(state.run.order[st.pos - 1])}.`
            : 'There is no earlier choice to change.'
        );
        break;
      }

      case 'undo':
        out.title = `Back to ${letter(st.v)}`;
        out.body.push(
          `Erase ${letter(st.v)}’s color ${swatch(st.color)} and mark it as tried. ` +
          `Next, ${letter(st.v)} takes its next free, untried color. If none is left, the search goes back further.`
        );
        out.body.push(`Backtracks so far: ${st.backtracks}.`);
        break;

      case 'done': {
        out.tone = 'good';
        out.title = `<span class="tag-good">✓ Done</span>: ${plural(graph.n, 'region')}, ${plural(st.used, 'color')}`;
        out.body.push(
          algo === 'backtrack'
            ? `Every region has a color and no neighbors share one. It took ${plural(st.backtracks, 'backtrack')}.`
            : 'Every region has a color and no neighbors share one.'
        );
        const check = checkerVerdict(colors);
        out.body.push(
          check.complete
            ? 'Independent check (from the map’s grid): valid.'
            : '<span class="tag-critical">Independent check failed.</span> This is a bug; please report it.'
        );
        break;
      }

      case 'fail':
        out.tone = 'critical';
        out.title = '<span class="tag-critical">No four-coloring</span>';
        out.body.push('Backtracking tried every possibility. This should never happen for a map drawn in the plane.');
        break;

      case 'limit':
        out.tone = 'critical';
        out.title = 'Stopped';
        out.body.push(`The search was stopped after ${k} steps.`);
        break;
    }
    return out;
  }

  function renderChoices(st, colors) {
    const box = $('choices');
    if (!st || st.v == null || st.kind === 'done') {
      box.innerHTML = '';
      return;
    }
    const { graph } = current();
    let blockers = st.blockers;
    const tried = st.tried ? st.tried[st.v] : [];
    if (!blockers) blockers = Core.colorOptions(graph, colors, st.v, tried).blockers;
    let html = `<div class="choice"><span></span><span></span><span>Colors for ${letter(st.v)}:</span></div>`;
    for (let c = 1; c <= N_COLORS; c++) {
      let cls;
      let text;
      if (blockers[c].length) {
        cls = 'is-blocked';
        text = `taken by ${listing(blockers[c].map(letter))}`;
      } else if (tried.includes(c)) {
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
    for (const b of $('algo-tabs').children) b.setAttribute('aria-selected', String(b.dataset.algo === state.algo));
    $('algo-desc').textContent = ALGOS[state.algo].desc;
    $('order-row').hidden = state.algo === 'dsatur';
    $('order-select').value = state.orderKey;
    $('order-shuffle').hidden = state.orderKey !== 'random';
    $('order-repick').hidden = state.orderKey !== 'custom' || !!state.picking;

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
        `<p>Click the regions on the map in the order the algorithm should visit them ` +
        `(${state.picking.length} of ${graph.n} chosen).</p>`;
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
    let stats = `Colored ${colored} of ${graph.n} · colors used ${used}`;
    if (state.algo === 'backtrack') stats += ` · backtracks ${st.backtracks}`;
    $('stats').textContent = stats;
  }

  function render() {
    const { spec } = current();
    for (const b of $('map-tabs').children) b.setAttribute('aria-selected', String(Number(b.dataset.i) === state.mapIndex));
    for (const b of $('mode-tabs').children) b.setAttribute('aria-selected', String(b.dataset.mode === state.mode));
    $('manual-panel').hidden = state.mode !== 'manual';
    $('algo-panel').hidden = state.mode !== 'algo';
    $('map-note').textContent = spec.note;

    const colors = shownColors();
    renderMap(colors);
    renderInspector(colors);
    if (state.mode === 'manual') renderManual(colors);
    else renderAlgo(colors);
  }

  // ---------------------------------------------------------------------------
  // Running algorithms
  // ---------------------------------------------------------------------------

  function computeRun() {
    const { map, graph } = current();
    stop();
    state.step = 0;
    state.picking = null;
    state.run = null;
    if (state.algo === 'dsatur') {
      state.run = Core.dsaturTrace(graph);
      return;
    }
    let order;
    if (state.orderKey === 'custom') {
      order = state.custom[map.id];
      if (!order) {
        state.picking = [];
        return;
      }
    } else {
      order = Core.ORDERS[state.orderKey].make(map, graph, state.seed);
    }
    state.run = state.algo === 'greedy' ? Core.greedyTrace(graph, order) : Core.backtrackTrace(graph, order);
  }

  function stop() {
    state.playing = false;
    clearTimeout(timer);
  }

  function tick() {
    if (!state.playing || !state.run) return;
    if (state.step < state.run.steps.length - 1) {
      state.step++;
      render();
      timer = setTimeout(tick, 1000 / state.speed);
    } else {
      stop();
      render();
    }
  }

  function togglePlay() {
    if (!state.run) return;
    if (state.playing) {
      stop();
    } else {
      if (state.step === state.run.steps.length - 1) state.step = 0;
      state.playing = true;
      timer = setTimeout(tick, Math.min(400, 1000 / state.speed));
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
    const { spec, graph } = current();
    if (state.mode === 'manual') {
      const colors = shownColors();
      colors[i] = state.brush === 0 || colors[i] === state.brush ? 0 : state.brush;
      render();
      return;
    }
    if (state.picking && !state.picking.includes(i)) {
      state.picking.push(i);
      if (state.picking.length === graph.n) {
        state.custom[spec.id] = state.picking;
        computeRun();
      }
      render();
    }
  }

  function setup() {
    $('map-tabs').innerHTML = SPECS.map((s, i) => `<button role="tab" data-i="${i}">${s.title}</button>`).join('');
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

    const names = ['', 'blue', 'yellow', 'pink', 'green'];
    let brushes = '';
    for (let c = 1; c <= N_COLORS; c++) {
      brushes += `<button class="brush" role="radio" data-brush="${c}" aria-label="Color ${c}, ${names[c]}"><i class="sw c${c}"></i>${c}</button>`;
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

    $('algo-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.algo = b.dataset.algo;
      computeRun();
      render();
    });

    const select = $('order-select');
    select.innerHTML =
      Object.entries(Core.ORDERS).map(([key, o]) => `<option value="${key}">${o.label}</option>`).join('') +
      '<option value="custom">Your own order (click regions)</option>';
    select.addEventListener('change', () => {
      state.orderKey = select.value;
      computeRun();
      render();
    });
    $('order-shuffle').addEventListener('click', () => {
      state.seed++;
      computeRun();
      render();
    });
    $('order-repick').addEventListener('click', () => {
      delete state.custom[current().spec.id];
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

    mountMap();
    computeRun();
    render();
  }

  setup();
})();
