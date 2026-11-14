/*
 * MapView: one map drawn as SVG, with everything the chapters need to show
 * what an algorithm is doing on it.
 *
 *  - Colored regions are filled solid. Uncolored regions are striped with the
 *    colors they can still take; a region with none left is drawn dead.
 *  - The map can morph into its graph: regions shrink into dots, and an edge
 *    grows across each shared border.
 *  - Effects: pulses that carry a color across a border, blame arrows, Kempe
 *    chain highlights and ripples, badges, outlines.
 */
(function () {
  'use strict';

  const Core = window.MapCore;
  const NS = 'http://www.w3.org/2000/svg';
  const FULL = 15;
  let uid = 0;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const colorsOf = (mask) => [1, 2, 3, 4].filter((c) => mask & (1 << (c - 1)));
  const r1 = (v) => Math.round(v * 10) / 10;

  // A shared clock for all effects, so a whole page can be slowed or skipped.
  const FX = {
    scale: 1,
    reduced: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  class MapView {
    constructor(host, built, opts = {}) {
      this.id = 'mv' + uid++;
      this.built = built;
      this.map = built.map;
      this.graph = built.graph;
      this.opts = Object.assign({ labels: 'auto', stripes: true, hover: true }, opts);
      this.n = this.graph.n;
      this.colors = new Uint8Array(this.n);
      this.masks = new Uint8Array(this.n).fill(FULL);
      this.shown = new Int16Array(this.n).fill(-1); // what each region's fill currently shows
      this.morphT = 0;
      this.gen = 0; // bumped on every render; pending effects of older renders are dropped
      this.peeled = null;
      this.build(host);
    }

    // -------------------------------------------------------------------------
    build(host) {
      const { map, graph } = this;
      const svg = (this.svg = el('svg', { viewBox: map.viewBox.join(' '), class: 'mapview', role: 'img' }));
      el('title', {}, svg).textContent = `Map "${map.title}" with ${this.n} regions`;
      host.appendChild(svg);
      const defs = el('defs', {}, svg);
      const pid = this.id;

      // Stripes: one pattern per set of colors still possible, with a thin gap
      // of bare land between stripes so a striped region never looks painted.
      // A region with all four colors open is left bare.
      const W = 6;
      const G = 2.5;
      for (let m = 1; m < FULL; m++) {
        const cs = colorsOf(m);
        const P = (W + G) * cs.length;
        const p = el('pattern', { id: `${pid}-o${m}`, width: P, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(35)' }, defs);
        el('rect', { width: P, height: 10, class: 'opt-bg' }, p);
        cs.forEach((c, k) => el('rect', { x: k * (W + G), width: W, height: 10, class: `opt c${c}` }, p));
      }
      const dead = el('pattern', { id: `${pid}-dead`, width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
      el('rect', { width: 8, height: 8, class: 'dead-bg' }, dead);
      el('rect', { width: 2.2, height: 8, class: 'dead-line' }, dead);
      const peeled = el('pattern', { id: `${pid}-peel`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
      el('rect', { width: 6, height: 6, class: 'peel-bg' }, peeled);
      el('rect', { width: 1.4, height: 6, class: 'peel-line' }, peeled);
      const blur = el('filter', { id: `${pid}-blur`, x: '-10%', y: '-10%', width: '120%', height: '120%' }, defs);
      el('feGaussianBlur', { stdDeviation: 5 }, blur);
      const glow = el('filter', { id: `${pid}-glow`, x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
      el('feGaussianBlur', { stdDeviation: 3.5 }, glow);

      const sea = (this.gSea = el('g', { class: 'sea' }, svg));
      for (const [w, o] of [[44, 0.35], [26, 0.55], [12, 0.9]]) {
        const g = el('g', { class: 'shallow', opacity: o }, sea);
        for (const r of map.regions) el('path', { d: r.path, 'stroke-width': w }, g);
      }
      const sh = el('g', { class: 'land-shadow', transform: 'translate(3,6)', filter: `url(#${pid}-blur)` }, sea);
      for (const r of map.regions) el('path', { d: r.path }, sh);

      this.gRegions = el('g', { class: 'regions' }, svg);
      this.gBorders = el('g', { class: 'borders' }, svg);
      this.gClash = el('g', { class: 'clashes' }, svg);
      this.gMarks = el('g', { class: 'marks' }, svg);
      this.gHover = el('g', { class: 'hover-marks' }, svg);
      this.gContacts = el('g', { class: 'contacts' }, svg);
      this.gGraph = el('g', { class: 'graph' }, svg);
      this.gEdges = el('g', {}, this.gGraph);
      this.gChain = el('g', { class: 'chain-edges' }, this.gGraph);
      this.gVerts = el('g', {}, this.gGraph);
      this.gLabels = el('g', { class: 'labels' }, svg);
      this.gFx = el('g', { class: 'fx' }, svg);
      this.gBadges = el('g', { class: 'badges' }, svg);

      this.regionEls = map.regions.map((r, i) => {
        const p = el('path', { d: r.path, class: 'region', 'data-i': i, tabindex: this.opts.onRegion ? 0 : undefined }, this.gRegions);
        return p;
      });
      for (const arc of map.arcs) {
        el('path', { d: 'M' + arc.pts.map((p) => p.join(',')).join('L'), class: arc.coast ? 'border coast' : 'border' }, this.gBorders);
      }
      this.markEls = map.regions.map((r) => el('path', { d: r.path, class: 'mark' }, this.gMarks));
      for (const { at } of graph.contactPoints) {
        const g = el('g', { class: 'contact', transform: `translate(${at[0]},${at[1]})` }, this.gContacts);
        el('circle', { r: 9 }, g);
        el('circle', { r: 2.4, class: 'dot' }, g);
      }

      // Graph: an edge per pair of neighbors, through the middle of their border.
      this.edges = [];
      this.edgeOf = {};
      for (let i = 0; i < this.n; i++)
        for (const j of graph.neighbors[i]) {
          if (j < i) continue;
          const e = { i, j, cross: graph.crossing[Core.pairKey(i, j)], el: el('path', { class: 'edge' }, this.gEdges) };
          this.edgeOf[Core.pairKey(i, j)] = e;
          this.edges.push(e);
        }
      this.vr = map.regions.map((r) => clamp(r.clearance * 0.42, 7, 13));
      // How far each region reaches from its label point: shrunk by vr/reach,
      // the whole region hides behind its dot.
      this.reach = map.regions.map((r) => Math.max(...r.polygon.map(([x, y]) => Math.hypot(x - r.label[0], y - r.label[1]))));
      this.vertEls = map.regions.map((r, i) => el('circle', { cx: r.label[0], cy: r.label[1], r: this.vr[i], class: 'vertex', 'data-i': i }, this.gVerts));

      this.labelEls = map.regions.map((r, i) => {
        const size = clamp(r.clearance * 0.55, 9, 19);
        const t = el('text', { x: r.label[0], y: r.label[1], class: 'label', 'font-size': r1(size) }, this.gLabels);
        t.textContent = r.id;
        return t;
      });

      this.setMorph(0);
      this.applyLabels();

      // Pointer: click and hover on regions and on dots.
      const pick = (e) => {
        const t = e.target.closest('[data-i]');
        return t && this.svg.contains(t) ? Number(t.dataset.i) : -1;
      };
      svg.addEventListener('click', (e) => {
        const i = pick(e);
        if (i >= 0 && this.opts.onRegion) this.opts.onRegion(i, e);
      });
      svg.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.i !== undefined && this.opts.onRegion) {
          e.preventDefault();
          this.opts.onRegion(Number(e.target.dataset.i), e);
        }
      });
      if (this.opts.hover) {
        svg.addEventListener('pointerover', (e) => this.hover(pick(e)));
        svg.addEventListener('pointerleave', () => this.hover(-1));
      }
      if (this.opts.onRegion) svg.classList.add('clickable');
    }

    // -------------------------------------------------------------------------
    // Labels: all of them on small maps; on big ones only where something happens.
    applyLabels() {
      const mode = this.opts.labels;
      const all = mode === 'all' || (mode === 'auto' && this.n <= 14);
      this.svg.classList.toggle('labels-all', all);
      this.svg.classList.toggle('labels-none', mode === 'none');
    }

    hover(i) {
      if (i === this.hovered) return;
      this.hovered = i;
      this.gHover.replaceChildren();
      const nb = i >= 0 ? new Set(this.graph.neighbors[i]) : new Set();
      if (i >= 0) {
        const tr = this.regionEls[i].getAttribute('transform') || undefined;
        for (const j of nb) el('path', { d: this.map.regions[j].path, class: 'hov-nb', transform: this.regionEls[j].getAttribute('transform') || undefined }, this.gHover);
        el('path', { d: this.map.regions[i].path, class: 'hov-main', transform: tr }, this.gHover);
      }
      this.labelEls.forEach((t, k) => t.classList.toggle('hov', k === i || nb.has(k)));
      this.vertEls.forEach((c, k) => c.classList.toggle('hov', k === i || nb.has(k)));
      for (const e of this.edges) e.el.classList.toggle('hov', e.i === i || e.j === i);
      if (this.opts.onHover) this.opts.onHover(i);
    }

    // -------------------------------------------------------------------------
    // Fills
    fillFor(i) {
      const c = this.colors[i];
      if (this.peeled && this.peeled[i]) return `url(#${this.id}-peel)`;
      if (c) return `var(--c${c})`;
      if (!this.opts.stripes) return 'var(--land)';
      const m = this.masks[i];
      if (this.opts.stripes === 'dead' || m === FULL) return m ? 'var(--land)' : `url(#${this.id}-dead)`;
      return m ? `url(#${this.id}-o${m})` : `url(#${this.id}-dead)`;
    }

    setFill(i) {
      const f = this.fillFor(i);
      this.regionEls[i].style.fill = f;
      this.vertEls[i].style.fill = f;
      const dead = !this.colors[i] && this.opts.stripes && !this.masks[i] && !(this.peeled && this.peeled[i]);
      this.regionEls[i].classList.toggle('dead', dead);
      this.vertEls[i].classList.toggle('dead', dead);
      this.regionEls[i].classList.toggle('filled', !!this.colors[i]);
      this.regionEls[i].classList.toggle('peeled', !!(this.peeled && this.peeled[i]));
      this.labelEls[i].classList.toggle('peeled', !!(this.peeled && this.peeled[i]));
    }

    // Show a coloring. With `pulseFrom` (a region that has just been colored),
    // its color travels across each border, and each neighbor that loses that
    // option changes when the pulse arrives.
    paint(colors, opts = {}) {
      const gen = ++this.gen;
      this.clearFx();
      this.colors = Uint8Array.from(colors);
      this.peeled = opts.peeled ? Uint8Array.from(opts.peeled) : null;
      const masks = Core.optionMasks(this.graph, this.colors);
      if (opts.masks) for (let v = 0; v < this.n; v++) if (!this.colors[v]) masks[v] = opts.masks[v];
      const late = new Set();
      const from = opts.pulseFrom;
      if (from !== undefined && from >= 0 && this.colors[from] && !FX.reduced && FX.scale > 0) {
        const c = this.colors[from];
        const b = 1 << (c - 1);
        for (const u of this.graph.neighbors[from]) {
          if (this.colors[u] || (this.peeled && this.peeled[u])) continue;
          const lost = (this.masks[u] & b) && !(masks[u] & b);
          if (!lost) continue;
          late.add(u);
          this.pulse(from, u, c, () => {
            if (gen !== this.gen) return;
            this.masks[u] = masks[u];
            this.setFill(u);
            this.flash(u, masks[u] ? 'hit' : 'hit dead-hit');
          });
        }
      }
      for (let v = 0; v < this.n; v++) {
        if (late.has(v)) continue;
        this.masks[v] = masks[v];
        this.setFill(v);
      }
    }

    flash(i, cls) {
      const p = this.regionEls[i];
      cls.split(' ').forEach((c) => p.classList.add(c));
      setTimeout(() => cls.split(' ').forEach((c) => p.classList.remove(c)), 420);
    }

    // Borders whose two sides have the same color.
    showClashes(on = true) {
      this.gClash.replaceChildren();
      if (!on) return [];
      const pairs = [];
      for (let i = 0; i < this.n; i++)
        for (const j of this.graph.neighbors[i]) {
          if (j < i || !this.colors[i] || this.colors[i] !== this.colors[j]) continue;
          pairs.push([i, j]);
          for (const line of this.graph.borderLines[Core.pairKey(i, j)]) {
            const d = 'M' + line.map((p) => p.join(',')).join('L');
            el('path', { d, class: 'clash-glow' }, this.gClash);
            el('path', { d, class: 'clash' }, this.gClash);
          }
          this.edgeOf[Core.pairKey(i, j)].el.classList.add('clash-edge');
        }
      for (const e of this.edges) if (!(this.colors[e.i] && this.colors[e.i] === this.colors[e.j])) e.el.classList.remove('clash-edge');
      return pairs;
    }

    // Outlines: { regionIndex: 'active' | 'blame' | 'chain' | 'next' | 'focus' }
    setMarks(marks = {}) {
      this.markEls.forEach((p, i) => {
        p.setAttribute('class', 'mark' + (marks[i] ? ' ' + marks[i] : ''));
      });
      this.labelEls.forEach((t, i) => t.classList.toggle('marked', !!marks[i]));
      this.vertEls.forEach((c, i) => c.classList.toggle('marked', !!marks[i]));
      // Draw marked outlines last so they sit on top of plain borders.
      for (const i of Object.keys(marks)) this.gMarks.appendChild(this.markEls[i]);
    }

    // Small pills above region labels: [{ i, text, kind }]
    setBadges(list = []) {
      this.gBadges.replaceChildren();
      for (const { i, text, kind } of list) {
        const [x, y] = this.map.regions[i].label;
        const size = clamp(this.map.regions[i].clearance * 0.55, 9, 19);
        const g = el('g', { class: 'badge ' + (kind || ''), transform: `translate(${x},${r1(y - size * 0.9 - 9)})` }, this.gBadges);
        const rect = el('rect', { y: -9, height: 18, rx: 9 }, g);
        const t = el('text', { y: 0.5 }, g);
        t.textContent = text;
        const w = Math.max(18, text.length * 6.6 + 12);
        rect.setAttribute('x', -w / 2);
        rect.setAttribute('width', w);
      }
    }

    // -------------------------------------------------------------------------
    // Map -> graph. t in [0, 1]: 0 is the plain map, ~0.35 the graph drawn over
    // the map, 1 the bare graph (regions shrunk into their dots).
    setMorph(t) {
      this.morphT = t;
      const over = ease(clamp(t / 0.35));
      const shrink = ease(clamp((t - 0.35) / 0.65));
      this.svg.style.setProperty('--over', over.toFixed(3));
      this.svg.style.setProperty('--shrink', shrink.toFixed(3));
      this.svg.classList.toggle('graph-on', over > 0.01);
      this.svg.classList.toggle('graph-full', shrink > 0.98);
      this.map.regions.forEach((r, i) => {
        const [x, y] = r.label;
        const smin = (this.vr[i] * 0.9) / Math.max(this.reach[i], 1);
        const s = lerp(1, smin, shrink);
        const tr = shrink > 0 ? `translate(${r1(x)},${r1(y)}) scale(${s.toFixed(4)}) translate(${-x},${-y})` : '';
        this.regionEls[i].setAttribute('transform', tr);
        this.markEls[i].setAttribute('transform', tr);
      });
      for (const e of this.edges) e.el.setAttribute('d', this.edgePath(e.i, e.j, shrink));
      this.gChain.querySelectorAll('path').forEach((p) => p.setAttribute('d', this.edgePath(+p.dataset.i, +p.dataset.j, shrink)));
    }

    edgePath(i, j, shrink = ease(clamp((this.morphT - 0.35) / 0.65))) {
      const [x1, y1] = this.map.regions[i].label;
      const [x2, y2] = this.map.regions[j].label;
      const cross = this.graph.crossing[Core.pairKey(i, j)];
      const mx = lerp(cross[0], (x1 + x2) / 2, shrink);
      const my = lerp(cross[1], (y1 + y2) / 2, shrink);
      const tx = (x2 - x1) / 6;
      const ty = (y2 - y1) / 6;
      const f = r1;
      return (
        `M${x1},${y1}C${f(x1 + (mx - x1) / 3)},${f(y1 + (my - y1) / 3)} ${f(mx - tx)},${f(my - ty)} ${f(mx)},${f(my)}` +
        `C${f(mx + tx)},${f(my + ty)} ${f(x2 - (x2 - mx) / 3)},${f(y2 - (y2 - my) / 3)} ${x2},${y2}`
      );
    }

    // Animate the morph to a target value.
    morphTo(target, ms = 900) {
      const start = this.morphT;
      const t0 = performance.now();
      const id = (this.morphAnim = {});
      const tick = (now) => {
        if (this.morphAnim !== id) return;
        const k = FX.reduced ? 1 : clamp((now - t0) / ms);
        this.setMorph(lerp(start, target, k));
        if (k < 1) requestAnimationFrame(tick);
        else if (this.opts.onMorph) this.opts.onMorph(target);
      };
      requestAnimationFrame(tick);
    }

    // -------------------------------------------------------------------------
    // Effects
    clearFx() {
      this.gFx.replaceChildren();
      this.gChain.replaceChildren();
      this.fxTimers && this.fxTimers.forEach(clearTimeout);
      this.fxTimers = [];
      this.anims = [];
    }

    // A dot of color c that travels from region a, across the shared border, into b.
    pulse(a, b, c, done, delay = 0) {
      const dur = 420 * FX.scale;
      const [x1, y1] = this.map.regions[a].label;
      const [x2, y2] = this.map.regions[b].label;
      const [mx, my] = this.graph.crossing[Core.pairKey(a, b)];
      const trail = el('path', { d: `M${x1},${y1}Q${2 * mx - (x1 + x2) / 2},${2 * my - (y1 + y2) / 2} ${x2},${y2}`, class: `pulse-trail s${c}` }, this.gFx);
      const len = trail.getTotalLength();
      trail.style.strokeDasharray = `0 ${len}`;
      const dot = el('circle', { r: 5.5, class: `pulse c${c}`, cx: x1, cy: y1 }, this.gFx);
      dot.style.opacity = 0;
      const gen = this.gen;
      const t0 = performance.now() + delay;
      const tick = (now) => {
        if (gen !== this.gen) return;
        const k = clamp((now - t0) / dur);
        if (k > 0) {
          const e = ease(k);
          const p = trail.getPointAtLength(e * len);
          dot.setAttribute('cx', p.x);
          dot.setAttribute('cy', p.y);
          dot.style.opacity = k < 0.9 ? 1 : (1 - k) * 10;
          trail.style.strokeDasharray = `${e * len} ${len}`;
          trail.style.opacity = 0.9 * (1 - k * 0.6);
        }
        if (k < 1) requestAnimationFrame(tick);
        else {
          dot.remove();
          trail.remove();
          done && done();
        }
      };
      requestAnimationFrame(tick);
    }

    // Arrows from regions into a target: [{ from, to, color, label }]
    setArrows(list = []) {
      this.gFx.querySelectorAll('.arrow').forEach((a) => a.remove());
      for (const { from, to, color } of list) {
        const [lx, ly] = this.map.regions[from].label;
        const [x2, y2] = this.map.regions[to].label;
        const [mx, my] = this.graph.crossing[Core.pairKey(from, to)];
        // Start just off the source's label so the label stays readable.
        const sd = Math.hypot(mx - lx, my - ly) || 1;
        const off = Math.min(sd * 0.35, 15);
        const x1 = lx + ((mx - lx) / sd) * off;
        const y1 = ly + ((my - ly) / sd) * off;
        // Stop short of the target's label.
        const dx = x2 - mx;
        const dy = y2 - my;
        const d = Math.hypot(dx, dy) || 1;
        const stop = Math.min(d * 0.55, 26);
        const ex = x2 - (dx / d) * stop;
        const ey = y2 - (dy / d) * stop;
        const g = el('g', { class: `arrow s${color}` }, this.gFx);
        const path = `M${x1},${y1}Q${mx},${my} ${r1(ex)},${r1(ey)}`;
        el('path', { d: path, class: 'arrow-halo' }, g);
        el('path', { d: path, class: 'arrow-line' }, g);
        const ang = Math.atan2(ey - my, ex - mx);
        const h = 11;
        const pts = [
          [ex + Math.cos(ang) * 3, ey + Math.sin(ang) * 3],
          [ex - Math.cos(ang - 0.5) * h, ey - Math.sin(ang - 0.5) * h],
          [ex - Math.cos(ang + 0.5) * h, ey - Math.sin(ang + 0.5) * h],
        ];
        el('path', { d: 'M' + pts.map((p) => p.map(r1).join(',')).join('L') + 'Z', class: 'arrow-head' }, g);
      }
    }

    // Kempe chain: glowing graph edges inside the chain, outlines on members.
    showChain(chain, { a, b } = {}) {
      this.gChain.replaceChildren();
      const set = new Set(chain);
      for (const i of chain)
        for (const j of this.graph.neighbors[i]) {
          if (j < i || !set.has(j)) continue;
          el('path', { d: this.edgePath(i, j), class: 'chain-edge', 'data-i': i, 'data-j': j }, this.gChain);
        }
      this.chainDots = {};
      for (const i of chain) {
        const [x, y] = this.map.regions[i].label;
        this.chainDots[i] = el('circle', { cx: x, cy: y, r: 6, class: `chain-dot c${this.colors[i]}` }, this.gChain);
      }
    }

    // Swap colors a and b inside a chain, as a wave spreading out from `start`.
    ripple(chain, a, b, start, done) {
      const set = new Set(chain);
      const dist = new Map([[start, 0]]);
      const q = [start];
      for (let k = 0; k < q.length; k++)
        for (const u of this.graph.neighbors[q[k]])
          if (set.has(u) && !dist.has(u)) {
            dist.set(u, dist.get(q[k]) + 1);
            q.push(u);
          }
      for (const v of chain) if (!dist.has(v)) dist.set(v, 0);
      const gen = this.gen;
      const stepMs = 260 * FX.scale;
      let maxD = 0;
      for (const v of chain) {
        const d = dist.get(v);
        maxD = Math.max(maxD, d);
        this.fxTimers.push(
          setTimeout(() => {
            if (gen !== this.gen) return;
            this.colors[v] = this.colors[v] === a ? b : a;
            this.setFill(v);
            this.flash(v, 'hit');
            const dot = this.chainDots && this.chainDots[v];
            if (dot) dot.setAttribute('class', `chain-dot c${this.colors[v]}`);
          }, d * stepMs)
        );
      }
      this.fxTimers.push(
        setTimeout(() => {
          if (gen !== this.gen) return;
          this.masks = Core.optionMasks(this.graph, this.colors);
          for (let v = 0; v < this.n; v++) if (!this.colors[v]) this.setFill(v);
          done && done();
        }, (maxD + 1) * stepMs + 100)
      );
    }

    // Highlight a set of graph edges (e.g. an odd ring).
    highlightEdges(pairs, cls = 'ring-edge') {
      this.gChain.replaceChildren();
      for (const [i, j] of pairs) el('path', { d: this.edgePath(i, j), class: cls, 'data-i': i, 'data-j': j }, this.gChain);
    }
  }

  window.MapView = MapView;
  window.MapFX = FX;
})();
