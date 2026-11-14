/*
 * Page wiring: each chapter gets one figure built from MapView, TreeView and
 * Player. All runs come from core.js; nothing here decides a color.
 */
(function () {
  'use strict';

  const Core = window.MapCore;
  const DATA = window.MapData;
  const FX = window.MapFX;
  const h = window.h;
  const NAMES = ['', 'blue', 'yellow', 'pink', 'green'];
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Maps, built once each.
  const cache = {};
  function get(id) {
    if (!cache[id]) {
      const data = DATA.find((d) => d.id === id);
      const map = Core.buildMap(data);
      cache[id] = { data, map, graph: Core.buildGraph(map) };
    }
    return cache[id];
  }

  // ---------------------------------------------------------------------------
  // Small text helpers. Everything interpolated is a region name or a number.
  const sw = (c) => `<i class="sw c${c}"></i>`;
  const swn = (c) => `<span class="swn">${sw(c)}${c}</span>`;
  const nm = (g, v) => `<b class="rn">${g.ids[v]}</b>`;
  function list(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  const nms = (g, vs) => list(vs.map((v) => nm(g, v)));
  const plural = (k, one, many) => `${k.toLocaleString('en-US')} ${k === 1 ? one : many || one + 's'}`;
  const bitsOf = (m) => [1, 2, 3, 4].filter((c) => m & (1 << (c - 1)));
  const popcount = Core.popcount;

  // Four slots, one per color: free, or crossed out with the neighbors that block it.
  function slots(g, colors, v, { tried = 0, chosen = 0, limit = 4 } = {}) {
    const block = [[], [], [], [], []];
    for (const u of g.neighbors[v]) if (colors[u]) block[colors[u]].push(u);
    let out = '<div class="slots">';
    for (let c = 1; c <= limit; c++) {
      const b = block[c];
      const t = tried & (1 << (c - 1));
      const cls = chosen === c ? 'chosen' : b.length || t ? 'blocked' : 'free';
      const why = b.length ? b.map((u) => g.ids[u]).join(' ') : t ? 'tried' : chosen === c ? 'chosen' : 'free';
      out += `<div class="slot ${cls}"><span class="slot-sw c${c}"></span><span class="slot-why">${why}</span></div>`;
    }
    return out + '</div>';
  }

  function brushes(host, count, onPick, start = 1) {
    let cur = start;
    const btns = [];
    for (let c = 1; c <= count; c++) {
      const b = h('button', { type: 'button', class: `brush c${c}`, 'aria-label': `Paint ${NAMES[c]}`, title: NAMES[c] });
      b.addEventListener('click', () => set(c));
      btns.push(b);
      host.appendChild(b);
    }
    const er = h('button', { type: 'button', class: 'brush eraser', 'aria-label': 'Erase', title: 'Erase' });
    er.addEventListener('click', () => set(0));
    btns.push(er);
    host.appendChild(er);
    function set(c) {
      cur = c;
      btns.forEach((b, k) => b.classList.toggle('on', c ? k === c - 1 : k === count));
      onPick && onPick(c);
    }
    set(start);
    return { get: () => cur, set };
  }

  function tabs(host, items, onPick, start) {
    const btns = items.map((it) => {
      const b = h('button', { type: 'button', class: 'tab' }, it.label);
      if (it.sub) b.append(h('small', null, it.sub));
      b.addEventListener('click', () => pick(it.key));
      host.appendChild(b);
      return b;
    });
    function pick(key) {
      btns.forEach((b, k) => b.classList.toggle('on', items[k].key === key));
      onPick(key);
    }
    btns.forEach((b, k) => b.classList.toggle('on', items[k].key === start));
    return { pick };
  }

  // Run something only while it is on screen.
  function whenVisible(el, on, off) {
    if (typeof IntersectionObserver !== 'function') return on();
    new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? on() : off && off())), { threshold: 0.15 }).observe(el);
  }

  // For each step of a run: the regions that are dead (no color left) there.
  function deadPerStep(g, trace) {
    return trace.steps.map((s) => Core.deadRegions(g, s.colors));
  }

  // The step at which region v became dead and stayed dead until step k.
  function deadSince(dead, v, k) {
    let j = k;
    while (j > 0 && dead[j - 1].includes(v)) j--;
    return j;
  }

  // The step at which u got the color it has at step k.
  function coloredAt(trace, u, k) {
    const s = trace.steps;
    let j = k;
    while (j > 0 && s[j - 1].colors[u] === s[k].colors[u]) j--;
    return j;
  }

  // Blame arrows into v: one per neighbor that holds a color.
  function blame(g, colors, v) {
    return g.neighbors[v].filter((u) => colors[u]).map((u) => ({ from: u, to: v, color: colors[u] }));
  }

  // ===========================================================================
  // Hero: DSATUR coloring a map on its own, over and over.
  // ===========================================================================
  (function hero() {
    const b = get('continent');
    const host = $('hero');
    const view = new MapView(host, b, { labels: 'none', hover: false });
    const trace = Core.dsaturTrace(b.graph);
    let i = 0;
    let timer = null;
    const tick = () => {
      const s = trace.steps[i];
      if (s.kind === 'assign') view.paint(s.colors, { pulseFrom: s.v });
      else view.paint(s.colors);
      view.setMarks(s.kind === 'assign' ? { [s.v]: 'active' } : {});
      i = (i + 1) % trace.steps.length;
      timer = setTimeout(tick, i === 0 ? 3200 : i === 1 ? 900 : 480);
    };
    whenVisible(host, () => !timer && tick(), () => {
      clearTimeout(timer);
      timer = null;
    });
  })();

  // ===========================================================================
  // 1. The rule: paint by hand; morph the map into its graph.
  // ===========================================================================
  (function rules() {
    const hostMap = $('f1-map');
    let view;
    let b;
    let colors;
    let brush;
    const readout = $('f1-readout');
    const morph = $('f1-morph');

    function mount(id) {
      b = get(id);
      hostMap.replaceChildren();
      colors = new Uint8Array(b.graph.n);
      view = new MapView(hostMap, b, {
        stripes: false,
        labels: b.graph.n <= 14 ? 'all' : 'auto',
        onRegion: (i) => {
          colors[i] = colors[i] === brush.get() ? 0 : brush.get();
          render();
        },
        onHover: (i) => render(i),
      });
      view.setMorph(morph.value / 1000);
      render();
    }

    function render(hov = -1) {
      view.paint(colors);
      const clashes = view.showClashes(true);
      const g = b.graph;
      const done = colors.every((c) => c) && !clashes.length;
      let html = `<div class="stat-row"><div class="stat"><b>${colors.filter((c) => c).length}</b><span>of ${g.n} colored</span></div>
        <div class="stat ${clashes.length ? 'bad' : ''}"><b>${clashes.length}</b><span>${clashes.length === 1 ? 'clash' : 'clashes'}</span></div></div>`;
      if (hov >= 0) {
        const pc = g.pointContacts[hov];
        html += `<p class="hov-info">${nm(g, hov)} has ${plural(g.neighbors[hov].length, 'neighbor')}: ${nms(g, g.neighbors[hov])}.`;
        if (pc.length) html += ` It touches ${nms(g, pc)} only at a point, so ${pc.length === 1 ? 'that is' : 'those are'} not neighbors.`;
        html += '</p>';
      } else if (done) html += `<p class="ok">Done: every border separates two different colors.</p>`;
      else if (clashes.length) html += `<p>Clash: ${list(clashes.map(([i, j]) => `${nm(g, i)}–${nm(g, j)}`))} share a border and a color.</p>`;
      else html += `<p class="muted">Hover over a region to see its neighbors.</p>`;
      readout.innerHTML = html;
    }

    brush = brushes($('f1-brushes'), 4);
    morph.addEventListener('input', () => view.setMorph(morph.value / 1000));
    tabs($('f1-maps'), [
      { key: 'corners', label: 'Four corners', sub: '7' },
      { key: 'isthmus', label: 'Isthmus', sub: '40' },
      { key: 'continent', label: 'Continent', sub: '32' },
    ], mount, 'corners');
    mount('corners');
  })();

  // ===========================================================================
  // 2. Three colors are not enough: the odd ring.
  // ===========================================================================
  (function three() {
    const b = get('ring');
    const g = b.graph;
    const colors = new Uint8Array(g.n);
    const readout = $('f2-readout');
    let brush;
    let why = false;
    const view = new MapView($('f2-map'), b, {
      stripes: 'dead',
      labels: 'all',
      onRegion: (i) => {
        colors[i] = colors[i] === brush.get() ? 0 : brush.get();
        render();
      },
    });

    // The center touches everything; the others form a ring.
    const center = g.neighbors.findIndex((l) => l.length === g.n - 1);
    const ring = [];
    {
      let v = g.neighbors[center].find((u) => u !== center);
      while (v !== undefined && !ring.includes(v)) {
        ring.push(v);
        v = g.neighbors[v].find((u) => u !== center && !ring.includes(u));
      }
    }

    function render() {
      const masks = Core.optionMasks(g, colors).map((m) => m & 7);
      view.paint(colors, { masks });
      const clashes = view.showClashes(true);
      const dead = [...masks.keys()].filter((v) => !colors[v] && !masks[v]);
      view.setArrows(dead.length ? blame(g, colors, dead[0]) : []);
      view.setMarks(Object.fromEntries(dead.map((v) => [v, 'dead-mark'])));
      let html = '';
      if (why) {
        html = `<h4>The ring is odd</h4>
          <p>${nm(g, center)} touches all five others, so none of them can share its color. They have
          only two colors between them. Going around the ring, the two colors must alternate:
          ${ring.map((v, k) => `${nm(g, v)}&nbsp;${sw(k % 2 ? 2 : 1)}`).join(' → ')} → back to ${nm(g, ring[0])}.</p>
          <p>Five is odd, so the last region sits next to the first with the same color. Every odd ring around a center needs a fourth color.</p>`;
      } else if (dead.length) {
        html = `<p class="bad-text">${nm(g, dead[0])} has no color left: its neighbors already use all three.</p>
          <p class="muted">Erase and try again, or press “Show why”.</p>`;
      } else if (colors.every((c) => c) && !clashes.length) {
        html = `<p class="ok">You did it?</p>`;
      } else if (clashes.length) {
        html = `<p class="bad-text">Clash on ${list(clashes.map(([i, j]) => `${nm(g, i)}–${nm(g, j)}`))}.</p>`;
      } else html = `<p class="muted">${colors.filter((c) => c).length} of ${g.n} colored, with three colors.</p>`;
      readout.innerHTML = html;
    }

    brush = brushes($('f2-brushes'), 3);
    $('f2-why').addEventListener('click', () => {
      why = !why;
      $('f2-why').textContent = why ? 'Back to the map' : 'Show why';
      if (why) {
        // Center gets 3; the ring alternates 1, 2, 1, 2, 1, and the last pair clashes.
        colors.fill(0);
        colors[center] = 3;
        ring.forEach((v, k) => (colors[v] = k % 2 ? 2 : 1));
        view.morphTo(0.34);
        const pairs = ring.map((v, k) => [v, ring[(k + 1) % ring.length]]);
        setTimeout(() => view.highlightEdges(pairs, 'ring-edge'), 500);
      } else {
        colors.fill(0);
        view.highlightEdges([]);
        view.morphTo(0);
      }
      render();
    });
    render();
  })();

  // ===========================================================================
  // 3. Every choice takes options away: paint with stripes and pulses.
  // ===========================================================================
  (function options() {
    const b = get('trap');
    const g = b.graph;
    let colors = new Uint8Array(g.n);
    const readout = $('f3-readout');
    let brush;
    const view = new MapView($('f3-map'), b, {
      labels: 'all',
      onRegion: (i) => {
        const was = colors[i];
        colors[i] = was === brush.get() ? 0 : brush.get();
        render(colors[i] ? i : -1);
      },
    });

    function render(from = -1) {
      view.paint(colors, { pulseFrom: from });
      const clashes = view.showClashes(true);
      const masks = Core.optionMasks(g, colors);
      const dead = Core.deadRegions(g, colors);
      const forced = [...masks.keys()].filter((v) => !colors[v] && popcount(masks[v]) === 1);
      const delay = from >= 0 && !FX.reduced ? 450 : 0;
      clearTimeout(render.t);
      render.t = setTimeout(() => {
        view.setArrows(dead.length ? blame(g, colors, dead[0]) : []);
        view.setMarks(Object.fromEntries(dead.map((v) => [v, 'dead-mark'])));
      }, delay);
      const legend = `<div class="legend">
        <div><i class="lg lg-4"></i><span>all 4 open</span></div>
        <div><i class="lg lg-2"></i><span>2 left</span></div>
        <div><i class="lg lg-1"></i><span>1 left: forced</span></div>
        <div><i class="lg lg-0"></i><span>dead</span></div></div>`;
      let html = legend;
      if (dead.length) {
        const v = dead[0];
        html += `<div class="callout bad"><h4>${nm(g, v)} is dead</h4>${slots(g, colors, v)}
          <p>Every color is used by a neighbor. Nothing can be done at ${nm(g, v)} itself: one of the arrows has to change.</p></div>`;
      } else if (clashes.length) {
        html += `<p class="bad-text">Clash on ${list(clashes.map(([i, j]) => `${nm(g, i)}–${nm(g, j)}`))}.</p>`;
      } else if (colors.every((c) => c)) {
        html += `<p class="ok">All ${g.n} regions colored, no clashes.</p>`;
      } else if (forced.length) {
        html += `<p>Forced: ${list(forced.map((v) => `${nm(g, v)} ${sw(bitsOf(masks[v])[0])}`))}. Only one stripe left.</p>`;
      } else {
        html += `<p class="muted">Pick a color and paint. Try the alphabetical order, each with the first free color.</p>`;
      }
      readout.innerHTML = html;
    }
    brush = brushes($('f3-brushes'), 4);
    $('f3-reset').addEventListener('click', () => {
      colors = new Uint8Array(g.n);
      render();
    });
    render();
  })();

  // ===========================================================================
  // Shared: describing one step of any run, for the side panels.
  // ===========================================================================
  function describe(algo, trace, k, g, dead) {
    const s = trace.steps[k];
    const prev = trace.steps[k - 1];
    const before = prev ? prev.colors : s.colors;
    switch (s.kind) {
      case 'start':
        return `<p class="muted">Nothing colored yet. Press play, or step with →.</p>`;
      case 'init':
        return `<p>Every region starts with a random color: <b>${plural(s.conflicts, 'clashing border')}</b>.</p>`;
      case 'assign': {
        let why = '';
        if (algo === 'dsatur' && s.score)
          why = `<p class="why">Picked because its neighbors already use ${plural(s.score.saturation, 'color')}, more than any other uncolored region${s.reason === 'free' ? ' (tie broken by more uncolored neighbors)' : s.reason === 'letter' ? ' (tie broken by letter)' : ''}.</p>`;
        if (algo === 'forward' && s.why && s.why.left !== undefined)
          why = `<p class="why">Most cornered: ${plural(s.why.left, 'color')} left.</p>`;
        if (algo === 'peeling') why = `<p class="why">Put back in reverse order. Its neighbors already back use at most 5 colors.</p>`;
        const pr = s.pruned && s.pruned.length ? `<p>Crosses ${swn(s.color)} off ${nms(g, s.pruned)}.</p>` : '';
        return `<h4>${nm(g, s.v)} takes ${swn(s.color)}</h4>${slots(g, before, s.v, { tried: s.tried ? prev.tried[s.v] : 0, chosen: s.color })}${why}${pr}`;
      }
      case 'stuck': {
        const since = dead ? deadSince(dead, s.v, k) : k;
        const late = k - since;
        return `<div class="callout bad"><h4>Stuck at ${nm(g, s.v)}</h4>${slots(g, s.colors, s.v)}
          <p>All four colors are taken around ${nm(g, s.v)}.${late > 0 ? ` It has had no color left since step ${since}. That was ${plural(late, 'step')} ago, but ${algo === 'greedy' ? 'greedy' : 'this method'} only looks at one region at a time.` : ''}</p>
          ${algo === 'greedy' || algo === 'dsatur' ? `<p>This method never changes a color it has set, so the run ends here, even though the map can be colored.</p>` : ''}</div>`;
      }
      case 'deadend':
        return `<div class="callout bad"><h4>Dead end at ${nm(g, s.v)}</h4>${slots(g, s.colors, s.v, { tried: prev ? prev.tried[s.v] : 0 })}<p>No color left to try. Go back one region.</p></div>`;
      case 'undo':
        return s.wipeout
          ? `<h4>Undo ${nm(g, s.v)} ${sw(s.color)}</h4><p>It left ${nm(g, s.from)} with nothing. Try ${nm(g, s.v)}'s next color.</p>`
          : `<h4>Back to ${nm(g, s.v)}</h4><p>Remove its ${swn(s.color)} and try its next color.</p>`;
      case 'wipeout':
        return `<div class="callout bad"><h4>${nm(g, s.u)} ran out</h4><p>Coloring ${nm(g, s.v)} ${sw(s.color)} took the last stripe from ${nm(g, s.u)}. Forward checking sees it now, not later.</p></div>`;
      case 'chain':
        return `<div class="callout chain"><h4>Kempe chain for ${nm(g, s.v)}</h4>${slots(g, s.colors, s.v)}<p>Regions colored ${swn(s.a)} or ${swn(s.b)} connected to ${nms(g, s.starts)}: ${nms(g, s.chain)}. Swap the two colors inside it.</p></div>`;
      case 'swap':
        return `<h4>Swapped ${sw(s.a)}↔${sw(s.b)}</h4><p>${nm(g, s.v)} now has ${swn(s.a)} free.</p>`;
      case 'peel':
        return `<h4>Remove ${nm(g, s.v)}</h4><p>It has ${plural(s.degree, 'neighbor')} left, the fewest on the map.</p>`;
      case 'move':
        return `<h4>${nm(g, s.v)}: ${sw(s.from)} → ${sw(s.to)}</h4><p>${s.random ? 'No move helps, so a random one.' : 'The color with the fewest clashing neighbors.'} Clashing borders now: <b>${s.conflicts}</b>.</p>`;
      case 'done':
        return `<div class="callout good"><h4>Done</h4><p>Every region colored, no clashes, ${plural(s.used, 'color')} used.</p></div>`;
      case 'limit':
        return `<div class="callout bad"><h4>Gave up</h4><p>Stopped after ${plural(trace.steps.length - 1, 'step')}.</p></div>`;
      case 'fail':
        return `<div class="callout bad"><h4>No coloring</h4></div>`;
    }
    return '';
  }

  const DOOM_KEY = '<span><i class="tk"></i>one column per step, in the color chosen</span><span><i></i>a region already has no color left</span>';

  const tickOf = (s) =>
    ({ assign: s.color, stuck: 'bad', deadend: 'bad', wipeout: 'bad', undo: 'undo', done: 'done', limit: 'bad', fail: 'bad', move: s.to, chain: 'other', swap: 'other', peel: 'undo' })[s.kind] || null;

  // Draw step k of a run on a MapView: colors (with a pulse if this is the
  // next step after `prev`), the active region, arrows at dead ends.
  function showStep(view, trace, k, prev, g, opts = {}) {
    const s = trace.steps[k];
    const animate = prev === k - 1 && s.kind === 'assign';
    view.paint(s.colors, { pulseFrom: animate ? s.v : -1, peeled: s.peeled });
    const marks = {};
    const badges = [];
    let arrows = [];
    if (opts.dead) for (const v of opts.dead[k]) marks[v] = 'dead-mark';
    if (s.v !== undefined && s.kind !== 'move') marks[s.v] = s.kind === 'undo' ? 'undo' : 'active';
    if (s.kind === 'stuck' || s.kind === 'deadend') {
      arrows = blame(g, s.colors, s.v);
      marks[s.v] = 'dead-mark';
    }
    if (s.kind === 'wipeout') {
      arrows = blame(g, s.colors, s.u);
      marks[s.u] = 'dead-mark';
    }
    if (s.kind === 'move') marks[s.v] = 'active';
    if (opts.next !== undefined && opts.next >= 0 && !marks[opts.next]) marks[opts.next] = 'next';
    view.setMarks(marks);
    view.setArrows(arrows);
    if (s.kind === 'chain' || s.kind === 'swap') view.showChain(s.chain);
    view.showClashes(opts.clashes !== false);
    view.setBadges(badges);
  }

  // ===========================================================================
  // 4. Greedy on the trap.
  // ===========================================================================
  (function greedy() {
    const b = get('trap');
    const g = b.graph;
    const view = new MapView($('f4-map'), b, { labels: 'all' });
    const readout = $('f4-readout');
    const orderHost = $('f4-order');
    let trace;
    let dead;
    let seed = 1;

    const sel = $('f4-order-sel');
    for (const [key, o] of Object.entries(Core.ORDERS)) sel.append(h('option', { value: key }, o.label));
    sel.addEventListener('change', () => load());

    const player = new Player({
      host: $('f4-player'),
      length: 1,
      onStep: (k, prev) => step(k, prev),
      tick: (k) => trace && trace.steps[k] && tickOf(trace.steps[k]),
      doomed: (k) => dead && dead[k].length > 0 && trace.steps[k].kind !== 'stuck',
      legend: DOOM_KEY,
    });

    function load() {
      if (sel.value === 'random') seed++;
      const order = Core.ORDERS[sel.value].make(b.map, g, seed);
      trace = Core.greedyTrace(g, order);
      dead = deadPerStep(g, trace);
      orderHost.replaceChildren(
        h('span', { class: 'order-label' }, 'Order'),
        ...order.map((v) => h('span', { class: 'chip', 'data-v': v }, g.ids[v]))
      );
      player.setLength(trace.steps.length, 0);
    }

    function step(k, prev) {
      if (!trace) return;
      const s = trace.steps[k];
      const pos = s.pos !== undefined ? s.pos : s.kind === 'start' ? -1 : trace.order.length;
      const next = s.kind === 'assign' || s.kind === 'start' ? trace.order[pos + 1] : -1;
      showStep(view, trace, k, prev, g, { dead, next });
      if (s.kind === 'stuck') {
        // Badges: when each blocking neighbor got its color.
        view.setBadges(g.neighbors[s.v].filter((u) => s.colors[u]).map((u) => ({ i: u, text: `step ${coloredAt(trace, u, k)}` })));
      }
      orderHost.querySelectorAll('.chip').forEach((c) => {
        const v = +c.dataset.v;
        c.className = 'chip' + (s.colors[v] ? ` c${s.colors[v]} filled` : '') + (v === s.v ? ' cur' : '') + (s.kind === 'stuck' && v === s.v ? ' bad' : '');
      });
      readout.innerHTML = describe('greedy', trace, k, g, dead);
    }
    load();
  })();

  // ===========================================================================
  // 5. Greedy vs DSATUR, side by side.
  // ===========================================================================
  (function race() {
    const b = get('continent');
    const g = b.graph;
    const lanes = [
      { trace: Core.greedyTrace(g, Core.ORDERS.alphabetical.make(b.map, g)), host: $('f5-map-a'), status: $('f5-status-a'), algo: 'greedy' },
      { trace: Core.dsaturTrace(g), host: $('f5-map-b'), status: $('f5-status-b'), algo: 'dsatur' },
    ];
    for (const L of lanes) {
      L.view = new MapView(L.host, b, { labels: 'auto' });
      L.dead = deadPerStep(g, L.trace);
    }
    const len = Math.max(...lanes.map((L) => L.trace.steps.length));
    new Player({
      host: $('f5-player'),
      length: len,
      onStep: (k, prev) => {
        for (const L of lanes) {
          const n = L.trace.steps.length;
          const kk = Math.min(k, n - 1);
          const pk = prev >= 0 && prev < n - 1 ? prev : -2;
          const s = L.trace.steps[kk];
          const nx = L.trace.steps[kk + 1];
          showStep(L.view, L.trace, kk, pk, g, { dead: L.dead, next: nx && nx.v !== undefined ? nx.v : -1 });
          let txt = '';
          if (s.kind === 'start') txt = `${g.n} regions to color.`;
          else if (s.kind === 'assign') {
            const k2 = s.available.length;
            txt = `Step ${kk}: ${nm(g, s.v)} takes ${sw(s.color)}. It had ${plural(k2, 'option')}.`;
          } else if (s.kind === 'stuck') txt = `<span class="bad-text">Stuck at ${nm(g, s.v)} after ${plural(kk - 1, 'region')}: no color left.</span>`;
          else if (s.kind === 'done') txt = `<span class="ok">Done: all ${g.n} regions colored.</span>`;
          const deadNow = L.dead[kk].filter((v) => v !== s.v);
          if (deadNow.length && s.kind !== 'stuck') txt += ` <span class="bad-text">${nms(g, deadNow)} already has no color left.</span>`;
          L.status.innerHTML = txt;
        }
      },
      // The strip follows DSATUR, with greedy's dead end in red.
      tick: (k) => {
        const a = lanes[0].trace.steps[k];
        const b2 = lanes[1].trace.steps[Math.min(k, lanes[1].trace.steps.length - 1)];
        return a && a.kind === 'stuck' ? 'bad' : tickOf(b2);
      },
      label: (k) => `Step ${k}`,
    });
  })();

  // ===========================================================================
  // 6. Backtracking with its search tree.
  // ===========================================================================
  (function backtrack() {
    const b = get('continent');
    const g = b.graph;
    const order = Core.ORDERS.leftToRight.make(b.map, g);
    const trace = Core.backtrackTrace(g, order);
    const dead = deadPerStep(g, trace);
    const view = new MapView($('f6-map'), b, { labels: 'auto' });
    const readout = $('f6-readout');
    let player;
    const tree = new TreeView($('f6-tree'), {
      trace,
      graph: g,
      onPick: (step) => {
        player.pause();
        player.go(step);
      },
    });
    player = new Player({
      host: $('f6-player'),
      length: trace.steps.length,
      speed: 'fast',
      onStep: (k, prev) => {
        const s = trace.steps[k];
        showStep(view, trace, k, prev, g, { dead });
        tree.show(k);
        const st = tree.stats(k);
        const deadNow = dead[k].filter((v) => v !== s.v);
        let html = `<div class="stat-row">
          <div class="stat"><b>${st.all}</b><span>tries</span></div>
          <div class="stat"><b>${s.backtracks}</b><span>backtracks</span></div>
          <div class="stat bad"><b>${st.wasted}</b><span>wasted</span></div></div>`;
        html += describe('backtrack', trace, k, g, dead);
        if (deadNow.length && s.kind !== 'deadend') {
          const v = deadNow[0];
          const since = deadSince(dead, v, k);
          html += `<div class="callout bad soft"><p>${nm(g, v)} has had no color left since step ${since}. Backtracking won't notice until it reaches ${nm(g, v)} in its order, so everything it does until then is wasted.</p></div>`;
        }
        readout.innerHTML = html;
      },
      tick: (k) => tickOf(trace.steps[k]),
      doomed: (k) => dead[k].length > 0 && trace.steps[k].kind !== 'deadend',
      legend: DOOM_KEY,
    });
  })();

  // ===========================================================================
  // 7. Three searches, same map: plain, forward checking, most cornered first.
  // ===========================================================================
  (function trio() {
    const b = get('ragged');
    const g = b.graph;
    const order = Core.ORDERS.random.make(b.map, g, 1);
    const runs = [
      { title: 'Backtracking', sub: 'fixed order', trace: Core.backtrackTrace(g, order) },
      { title: 'Forward checking', sub: 'same order', trace: Core.forwardCheckTrace(g, order) },
      { title: 'Forward checking', sub: 'most cornered first', trace: Core.forwardCheckTrace(g, null) },
    ];
    const host = $('f7-trio');
    const maxLeaves = Math.max(...runs.map((r) => r.trace.nodes.filter((n, i, a) => !a.some((m) => m.parent === i)).length));
    for (const r of runs) {
      const col = h('div', { class: 'trio-col' });
      col.append(h('h3', null, r.title, h('small', null, r.sub)));
      const treeHost = h('div', { class: 'tree-host trio-tree' });
      const mapHost = h('div', { class: 'trio-map' });
      r.stat = h('p', { class: 'trio-stat' });
      col.append(treeHost, h('div', { class: 'trio-under' }, mapHost, r.stat));
      host.append(col);
      r.view = new MapView(mapHost, b, { labels: 'none', hover: false });
      r.tree = new TreeView(treeHost, { trace: r.trace, graph: g, sx: (W) => (W - 20) / Math.max(1, maxLeaves - 1) });
    }
    const clock = $('f7-clock');
    function at(t) {
      // t = number of tries so far (same for all three).
      for (const r of runs) {
        const nodes = r.trace.nodes;
        const finished = t >= nodes.length;
        const step = finished ? r.trace.steps.length - 1 : nodes[Math.max(0, Math.floor(t))].step;
        r.tree.show(step);
        const s = r.trace.steps[step];
        r.view.paint(s.colors);
        const marks = {};
        for (const v of Core.deadRegions(g, s.colors)) marks[v] = 'dead-mark';
        r.view.setMarks(marks);
        const st = r.tree.stats(step);
        r.stat.innerHTML = finished
          ? `<b class="ok">Found it</b> after <b>${st.all.toLocaleString('en-US')}</b> tries${st.wasted ? `, <span class="bad-text">${st.wasted.toLocaleString('en-US')} wasted</span>` : ''}.`
          : `<b>${st.all.toLocaleString('en-US')}</b> tries${st.wasted ? `, <span class="bad-text">${st.wasted.toLocaleString('en-US')} wasted</span>` : ''}…`;
      }
      clock.textContent = t >= runs[0].trace.nodes.length ? '' : `${Math.floor(t).toLocaleString('en-US')} tries each`;
    }
    const total = Math.max(...runs.map((r) => r.trace.nodes.length));
    at(total);
    let anim = null;
    $('f7-run').addEventListener('click', () => {
      const id = (anim = {});
      const T = 14000;
      const t0 = performance.now();
      // Exponential clock: the first tries go slowly enough to see the short runs finish.
      const frame = (now) => {
        if (anim !== id) return;
        const u = Math.min(1, (now - t0) / T);
        const t = Math.exp(u * Math.log(total + 1)) - 1;
        at(u >= 1 ? total : t);
        if (u < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  })();

  // ===========================================================================
  // 8. Kempe chains, by hand.
  // ===========================================================================
  (function kempe() {
    const b = get('trap');
    const g = b.graph;
    const stuck = Core.greedyTrace(g, Core.ORDERS.alphabetical.make(b.map, g)).steps.at(-1);
    const target = stuck.v;
    let colors;
    let pick = -1;
    let partner = 0;
    let done = false;
    const tools = $('f8-tools');
    const readout = $('f8-readout');
    const view = new MapView($('f8-map'), b, {
      labels: 'all',
      onRegion: (i) => {
        if (done || !g.neighbors[target].includes(i)) return;
        pick = i;
        partner = 0;
        render();
      },
    });
    view.setMorph(0.3);

    function reset() {
      colors = Uint8Array.from(stuck.colors);
      pick = -1;
      partner = 0;
      done = false;
      render();
    }

    function chainInfo() {
      const a = colors[pick];
      const chain = Core.kempeChain(g, colors, pick, a, partner);
      const inChain = new Set(chain);
      const nbs = g.neighbors[target];
      const reachB = nbs.filter((u) => colors[u] === partner && inChain.has(u));
      const otherA = nbs.filter((u) => colors[u] === a && !inChain.has(u));
      return { a, chain, ok: !reachB.length && !otherA.length, reachB, otherA };
    }

    function render() {
      view.paint(colors);
      view.showClashes(true);
      const marks = { [target]: colors[target] ? 'active' : 'dead-mark' };
      if (!done) for (const u of g.neighbors[target]) marks[u] = u === pick ? 'active' : 'cand';
      tools.replaceChildren();
      let html = `<h4>Colors around ${nm(g, target)}</h4>${slots(g, colors, target, { chosen: colors[target] })}`;
      if (done) {
        view.showChain([]);
        html += colors[target]
          ? `<div class="callout good"><p>${nm(g, target)} takes ${swn(colors[target])}. Nothing else was undone.</p></div>`
          : `<div class="callout bad"><p>The swap kept the map valid but freed nothing for ${nm(g, target)}. Try another chain.</p></div>`;
        tools.append(h('button', { type: 'button', class: 'btn', onclick: reset }, 'Start over'));
      } else if (pick < 0) {
        view.showChain([]);
        html += `<p class="muted">Click one of the outlined neighbors of ${nm(g, target)}.</p>`;
      } else {
        const a = colors[pick];
        tools.append(h('span', { class: 'tools-label' }, `Swap ${NAMES[a]} with`));
        for (let c = 1; c <= 4; c++) {
          if (c === a) continue;
          const btn = h('button', { type: 'button', class: 'btn pair' + (partner === c ? ' on' : '') });
          btn.innerHTML = `${sw(a)}↔${sw(c)}`;
          btn.addEventListener('click', () => {
            partner = c;
            render();
          });
          tools.append(btn);
        }
        if (partner) {
          const info = chainInfo();
          view.showChain(info.chain);
          for (const v of info.chain) if (!marks[v] || marks[v] === 'cand') marks[v] = 'chain';
          html += `<p>Kempe chain of ${nm(g, pick)} in ${swn(a)} and ${swn(partner)}: ${nms(g, info.chain)}.</p>`;
          if (info.ok) html += `<div class="callout good"><p>No other neighbor of ${nm(g, target)} is in it, and none is ${sw(a)} outside it. After the swap no neighbor of ${nm(g, target)} is ${sw(a)}.</p></div>`;
          else if (info.reachB.length)
            html += `<div class="callout bad"><p>The chain comes back to ${nm(g, target)} through ${nms(g, info.reachB)} (${sw(partner)}). After the swap that region is ${sw(a)}, so ${sw(a)} is still blocked.</p></div>`;
          else html += `<div class="callout bad"><p>${nms(g, info.otherA)} also ${info.otherA.length === 1 ? 'is' : 'are'} ${sw(a)} but not in this chain, so ${sw(a)} stays blocked.</p></div>`;
          const go = h('button', { type: 'button', class: 'btn btn-main' }, 'Swap');
          go.addEventListener('click', () => {
            const { chain } = info;
            done = true;
            tools.replaceChildren();
            view.ripple(chain, a, partner, pick, () => {
              colors = Uint8Array.from(view.colors);
              const free = Core.colorOptions(g, colors, target, 0).available;
              if (free.length) colors[target] = free[0];
              render();
              if (free.length) view.flash(target, 'hit');
            });
          });
          tools.append(go);
        } else html += `<p class="muted">Now choose the second color.</p>`;
      }
      view.setMarks(marks);
      readout.innerHTML = html;
    }
    reset();
  })();

  // ===========================================================================
  // 9. Peeling.
  // ===========================================================================
  (function peel() {
    const b = get('continent');
    const g = b.graph;
    const trace = Core.smallestLastTrace(g);
    const view = new MapView($('f9-map'), b, { labels: 'auto' });
    const stack = $('f9-stack');
    const readout = $('f9-readout');
    const peels = trace.steps.filter((s) => s.kind === 'peel');
    stack.replaceChildren(
      h('div', { class: 'stack-head' }, h('span', null, 'Removed, in order'), h('span', null, 'neighbors left')),
      ...peels.map((s) =>
        h('div', { class: 'stack-row', 'data-v': s.v }, h('span', { class: 'chip' }, g.ids[s.v]), h('span', { class: 'bar' }, ...[1, 2, 3, 4, 5].map((k) => h('i', { class: k <= s.degree ? 'on' : '' }))), h('b', null, String(s.degree)))
      )
    );
    view.setMorph(0.3);
    new Player({
      host: $('f9-player'),
      length: trace.steps.length,
      speed: 'normal',
      onStep: (k, prev) => {
        const s = trace.steps[k];
        showStep(view, trace, k, prev, g, {});
        const peeled = s.peeled || new Uint8Array(g.n);
        view.edges.forEach((e) => e.el.classList.toggle('gone', !!(peeled[e.i] || peeled[e.j])));
        if (s.kind === 'peel') view.setBadges([{ i: s.v, text: `${s.degree} left` }]);
        stack.querySelectorAll('.stack-row').forEach((row) => {
          const v = +row.dataset.v;
          const removed = peeled[v] || s.colors[v];
          row.classList.toggle('in', !!removed || k >= peels.length + 1);
          row.classList.toggle('cur', v === s.v);
          row.querySelector('.chip').className = 'chip' + (s.colors[v] ? ` c${s.colors[v]} filled` : '');
        });
        // Keep the current row in view inside the list, without scrolling the page.
        const cur = stack.querySelector('.stack-row.cur');
        if (cur) {
          const top = cur.offsetTop - stack.offsetTop;
          if (top < stack.scrollTop + 30 || top > stack.scrollTop + stack.clientHeight - 30) stack.scrollTop = top - stack.clientHeight / 2;
        }
        let html = describe('peeling', trace, k, g);
        if (s.kind === 'assign') html = `<h4>${nm(g, s.v)} comes back</h4>${slots(g, trace.steps[k - 1].colors, s.v, { chosen: s.color })}<p>It returns next to ${plural(g.neighbors[s.v].filter((u) => trace.steps[k - 1].colors[u]).length, 'colored neighbor')}, never more than when it left.</p>`;
        if (s.kind === 'peel' && k === peels.length) html += `<p>Nothing left. Now put them back, last removed first.</p>`;
        readout.innerHTML = html;
      },
      tick: (k) => tickOf(trace.steps[k]),
    });
  })();

  // ===========================================================================
  // 10. Playground.
  // ===========================================================================
  (function lab() {
    const ALGOS = [
      { key: 'greedy', label: 'Greedy', order: true },
      { key: 'dsatur', label: 'DSATUR' },
      { key: 'backtrack', label: 'Backtracking', order: true, tree: true },
      { key: 'forward', label: 'Forward checking', order: true, tree: true, mrv: true },
      { key: 'kempe', label: 'Kempe chains', order: true },
      { key: 'peeling', label: 'Peeling' },
      { key: 'local', label: 'Local search' },
    ];
    const st = { map: 'patchwork', algo: 'forward', order: 'leftToRight', seed: 1, mrv: false };
    let b;
    let view;
    let tree;
    let trace;
    let dead;
    const readout = $('lab-readout');
    const opts = $('lab-opts');
    const treeBox = $('lab-tree-box');

    const player = new Player({
      host: $('lab-player'),
      length: 1,
      speed: 'fast',
      onStep: (k, prev) => step(k, prev),
      tick: (k) => trace && trace.steps[k] && tickOf(trace.steps[k]),
      doomed: (k) => dead && trace.algorithm !== 'local' && dead[k].length > 0 && !['stuck', 'deadend', 'wipeout'].includes(trace.steps[k].kind),
      legend: DOOM_KEY,
    });

    function mountMap() {
      b = get(st.map);
      const host = $('lab-map');
      host.replaceChildren();
      view = new MapView(host, b, { labels: 'auto' });
      load();
    }

    function load() {
      const g = b.graph;
      const A = ALGOS.find((a) => a.key === st.algo);
      const order = Core.ORDERS[st.order].make(b.map, g, st.seed);
      trace = {
        greedy: () => Core.greedyTrace(g, order),
        dsatur: () => Core.dsaturTrace(g),
        backtrack: () => Core.backtrackTrace(g, order),
        forward: () => Core.forwardCheckTrace(g, st.mrv ? null : order),
        kempe: () => Core.kempeTrace(g, order),
        peeling: () => Core.smallestLastTrace(g),
        local: () => Core.minConflictsTrace(g, st.seed),
      }[st.algo]();
      dead = deadPerStep(g, trace);
      view.opts.stripes = st.algo !== 'local';
      view.setMorph(st.algo === 'kempe' || st.algo === 'peeling' ? 0.3 : 0);
      treeBox.hidden = !A.tree;
      if (A.tree) {
        if (!tree)
          tree = new TreeView($('lab-tree'), {
            trace,
            graph: g,
            onPick: (s) => {
              player.pause();
              player.go(s);
            },
          });
        else {
          tree.o.graph = g;
          tree.setTrace(trace);
        }
      }
      // Options for this algorithm.
      opts.replaceChildren();
      if (A.order && !(A.mrv && st.mrv)) {
        const sel = h('select', { 'aria-label': 'Order' });
        for (const [key, o] of Object.entries(Core.ORDERS)) sel.append(h('option', { value: key }, o.label));
        sel.value = st.order;
        sel.addEventListener('change', () => {
          st.order = sel.value;
          if (st.order === 'random') st.seed++;
          load();
        });
        opts.append(h('label', { class: 'field' }, 'Order ', sel));
        if (st.order === 'random') opts.append(h('button', { type: 'button', class: 'btn', onclick: () => { st.seed++; load(); } }, 'Shuffle'));
      }
      if (A.mrv) {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = st.mrv;
        cb.addEventListener('change', () => {
          st.mrv = cb.checked;
          load();
        });
        opts.append(h('label', { class: 'check' }, cb, ' Most cornered first'));
      }
      if (st.algo === 'local') opts.append(h('button', { type: 'button', class: 'btn', onclick: () => { st.seed++; load(); } }, 'New random start'));
      player.setLength(trace.steps.length, 0);
    }

    function step(k, prev) {
      if (!trace) return;
      const g = b.graph;
      const s = trace.steps[k];
      const local = trace.algorithm === 'local';
      let next = -1;
      const nx = trace.steps[k + 1];
      if (nx && nx.kind === 'assign' && ['greedy', 'dsatur', 'kempe'].includes(trace.algorithm)) next = nx.v;
      showStep(view, trace, k, prev, g, { dead: local ? null : dead, next });
      if (st.algo === 'peeling') {
        const peeled = s.peeled || new Uint8Array(g.n);
        view.edges.forEach((e) => e.el.classList.toggle('gone', !!(peeled[e.i] || peeled[e.j])));
        if (s.kind === 'peel') view.setBadges([{ i: s.v, text: `${s.degree} left` }]);
      } else view.edges.forEach((e) => e.el.classList.remove('gone'));
      if (tree && !treeBox.hidden) tree.show(k);
      const colored = s.colors.filter((c) => c).length;
      let stats = `<div class="stat-row"><div class="stat"><b>${colored}</b><span>of ${g.n} colored</span></div>`;
      if (s.backtracks !== undefined) stats += `<div class="stat"><b>${s.backtracks}</b><span>backtracks</span></div>`;
      if (tree && !treeBox.hidden) stats += `<div class="stat bad"><b>${tree.stats(k).wasted}</b><span>wasted tries</span></div>`;
      if (local) stats += `<div class="stat ${s.conflicts ? 'bad' : ''}"><b>${s.conflicts}</b><span>clashes</span></div>`;
      stats += '</div>';
      readout.innerHTML = stats + describe(trace.algorithm, trace, k, g, dead);
    }

    tabs($('lab-maps'), DATA.map((d) => ({ key: d.id, label: d.title, sub: String(d.regions.length) })), (key) => {
      st.map = key;
      mountMap();
    }, st.map);
    tabs($('lab-algos'), ALGOS.map((a) => ({ key: a.key, label: a.label })), (key) => {
      st.algo = key;
      load();
    }, st.algo);
    mountMap();
  })();
})();
