/*
 * Canvas charts for the "Under the hood" panel. Each chart draws one run;
 * the expensive part is drawn once per run into an offscreen canvas, and each
 * step only adds the cursor. Every chart returns a function that turns a
 * click position into a step number.
 */
(function (root) {
  'use strict';

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const palette = () => ({
    surface: cssVar('--surface'),
    land: cssVar('--land'),
    ink: cssVar('--ink'),
    ink2: cssVar('--ink-2'),
    ink3: cssVar('--ink-3'),
    line: cssVar('--line'),
    critical: cssVar('--critical'),
    colors: [cssVar('--land'), cssVar('--c1'), cssVar('--c2'), cssVar('--c3'), cssVar('--c4')],
  });

  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  // Offscreen layer cache, keyed by the run object and the canvas size.
  const cache = new WeakMap();
  function layer(run, key, w, h, dpr, draw) {
    let entry = cache.get(run);
    if (!entry) cache.set(run, (entry = {}));
    const id = `${key}:${w}x${h}@${dpr}:${document.documentElement.dataset.theme || ''}:${matchMedia('(prefers-color-scheme: dark)').matches}`;
    if (!entry[id]) {
      const c = document.createElement('canvas');
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx);
      entry[id] = c;
    }
    return entry[id];
  }

  function cursor(ctx, x, top, bottom, p) {
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }

  // Dim everything to the right of the cursor: that part has not happened yet.
  function future(ctx, x, top, right, bottom, p) {
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = p.surface;
    ctx.fillRect(x, top, right - x, bottom - top);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Timeline: one row per region, one column per step; each cell shows the
  // region's color at that step.
  // ---------------------------------------------------------------------------
  function timeline(canvas, run, rows, ids, step, active) {
    const { ctx, w, h, dpr } = fit(canvas);
    const p = palette();
    const n = rows.length;
    const N = run.steps.length;
    const gutter = n <= 40 ? 24 : 6;
    const top = 6;
    const bottom = h - 18;
    const left = gutter;
    const right = w - 6;
    const rowH = (bottom - top) / n;
    const xOf = (s) => left + (s / N) * (right - left);

    const base = layer(run, `timeline:${rows.join(',')}`, w, h, dpr, (c) => {
      c.fillStyle = p.surface;
      c.fillRect(0, 0, w, h);
      rows.forEach((v, r) => {
        const y = top + r * rowH;
        let start = 0;
        let color = run.steps[0].colors[v];
        const flush = (end) => {
          c.fillStyle = color ? p.colors[color] : p.land;
          c.fillRect(xOf(start), y, Math.max(0.6, xOf(end) - xOf(start)), Math.max(0.6, rowH - (rowH > 4 ? 1 : 0)));
        };
        for (let s = 1; s < N; s++) {
          const cs = run.steps[s].colors[v];
          if (cs !== color) {
            flush(s);
            start = s;
            color = cs;
          }
        }
        flush(N);
      });
      if (gutter > 10) {
        c.fillStyle = p.ink2;
        c.font = `${Math.min(10, rowH * 0.9)}px system-ui, sans-serif`;
        c.textAlign = 'right';
        c.textBaseline = 'middle';
        rows.forEach((v, r) => rowH >= 6 && c.fillText(ids[v], gutter - 4, top + (r + 0.5) * rowH));
      }
      c.fillStyle = p.ink3;
      c.font = '10px system-ui, sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillText('step 0', left, h - 5);
      c.textAlign = 'right';
      c.fillText(`step ${N - 1}`, right, h - 5);
    });
    ctx.drawImage(base, 0, 0, w, h);
    const x = xOf(step + 1);
    future(ctx, x, top, right, bottom, p);
    if (active >= 0) {
      const r = rows.indexOf(active);
      if (r >= 0) {
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + r * rowH + 0.5, right - left - 1, Math.max(1, rowH - 1));
      }
    }
    cursor(ctx, x, top, bottom, p);
    return (px) => Math.max(0, Math.min(N - 1, Math.floor(((px - left) / (right - left)) * N)));
  }

  // ---------------------------------------------------------------------------
  // Search tree: one node per color tried, one leaf per dead end. Depth goes
  // down; the current path is drawn in ink.
  // ---------------------------------------------------------------------------
  function treeLayout(nodes) {
    const kids = nodes.map(() => []);
    const roots = [];
    nodes.forEach((nd, i) => (nd.parent < 0 ? roots.push(i) : kids[nd.parent].push(i)));
    const x = new Float64Array(nodes.length);
    const depth = new Int32Array(nodes.length);
    let leaves = 0;
    let maxDepth = 1;
    const visit = (i, d) => {
      depth[i] = d;
      maxDepth = Math.max(maxDepth, d);
      if (!kids[i].length) {
        x[i] = leaves++;
        return;
      }
      for (const k of kids[i]) visit(k, d + 1);
      x[i] = (x[kids[i][0]] + x[kids[i][kids[i].length - 1]]) / 2;
    };
    // Iterative-safe for deep trees: depth is at most the number of regions.
    for (const r of roots) visit(r, 1);
    return { x, depth, leaves: Math.max(1, leaves), maxDepth };
  }

  function tree(canvas, run, step) {
    const { ctx, w, h } = fit(canvas);
    const p = palette();
    const nodes = run.nodes || [];
    if (!run._tree) run._tree = treeLayout(nodes);
    const L = run._tree;
    const pad = 12;
    const X = (i) => (L.leaves === 1 ? w / 2 : pad + (L.x[i] / (L.leaves - 1)) * (w - 2 * pad));
    const Y = (i) => pad + (L.depth[i] / L.maxDepth) * (h - 2 * pad - 4);
    const rootX = nodes.length ? X(0) : w / 2; // the top of the tree sits above the first choice
    const rootY = pad - 4;
    const now = run.steps[step];
    const px = (i) => (nodes[i].parent < 0 ? [rootX, rootY] : [X(nodes[i].parent), Y(nodes[i].parent)]);

    ctx.fillStyle = p.surface;
    ctx.fillRect(0, 0, w, h);
    const visible = [];
    for (let i = 0; i < nodes.length && nodes[i].step <= step; i++) visible.push(i);

    // Edges: live ones darker, abandoned ones faint.
    for (const live of [false, true]) {
      ctx.beginPath();
      for (const i of visible) {
        const gone = nodes[i].undone != null && nodes[i].undone <= step;
        if (gone === live || nodes[i].dead) continue;
        const [x0, y0] = px(i);
        ctx.moveTo(x0, y0);
        ctx.lineTo(X(i), Y(i));
      }
      ctx.strokeStyle = live ? p.ink2 : p.line;
      ctx.lineWidth = live ? 1 : 0.8;
      ctx.stroke();
    }
    const r = Math.max(1.2, Math.min(3.5, (w / L.leaves) * 0.4));
    for (const i of visible) {
      const nd = nodes[i];
      if (nd.dead) {
        const [x0, y0] = px(i);
        const x = X(i);
        const y = Y(i);
        ctx.strokeStyle = p.critical;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x, y);
        ctx.moveTo(x - r, y - r);
        ctx.lineTo(x + r, y + r);
        ctx.moveTo(x + r, y - r);
        ctx.lineTo(x - r, y + r);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = p.colors[nd.color];
      ctx.fillRect(X(i) - r, Y(i) - r, 2 * r, 2 * r);
    }
    // Current path from the root down to the deepest live node.
    if (now.cur != null && now.cur >= 0) {
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      let i = now.cur;
      ctx.moveTo(X(i), Y(i));
      while (i >= 0) {
        const [x0, y0] = px(i);
        ctx.lineTo(x0, y0);
        i = nodes[i].parent;
      }
      ctx.stroke();
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(X(now.cur), Y(now.cur), r + 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(rootX, rootY, 3, 0, Math.PI * 2);
    ctx.fill();
    // Clicking picks the nearest visible node and jumps to the step that made it.
    return (cx, cy) => {
      let best = -1;
      let bd = Infinity;
      for (const i of visible) {
        const d = Math.hypot(X(i) - cx, Y(i) - cy);
        if (d < bd) [best, bd] = [i, d];
      }
      return best >= 0 && bd < 24 ? nodes[best].step : null;
    };
  }

  // ---------------------------------------------------------------------------
  // Bars: one value per step (or null), e.g. free colors at each decision.
  // ---------------------------------------------------------------------------
  function bars(canvas, run, key, values, maxValue, step, opts = {}) {
    const { ctx, w, h, dpr } = fit(canvas);
    const p = palette();
    const N = values.length;
    const left = 26;
    const right = w - 8;
    const top = 10;
    const bottom = h - 18;
    const xOf = (s) => left + (s / N) * (right - left);
    const yOf = (v) => bottom - (v / maxValue) * (bottom - top);
    const base = layer(run, `bars:${key}`, w, h, dpr, (c) => {
      c.fillStyle = p.surface;
      c.fillRect(0, 0, w, h);
      c.strokeStyle = p.line;
      c.lineWidth = 1;
      c.fillStyle = p.ink3;
      c.font = '10px system-ui, sans-serif';
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      for (let v = 0; v <= maxValue; v++) {
        c.beginPath();
        c.moveTo(left, Math.round(yOf(v)) + 0.5);
        c.lineTo(right, Math.round(yOf(v)) + 0.5);
        c.stroke();
        c.fillText(String(v), left - 6, yOf(v));
      }
      const bw = Math.max(1, (right - left) / N - (N < 120 ? 2 : 0));
      values.forEach((item, s) => {
        if (!item) return;
        const x = xOf(s) + ((right - left) / N - bw) / 2;
        if (item.value === 0) {
          // A zero is a failure (red) unless the chart says zeros are normal.
          c.fillStyle = opts.zeroIsFine ? p.ink3 : p.critical;
          c.fillRect(x, bottom - (opts.zeroIsFine ? 2 : 4), bw, opts.zeroIsFine ? 2 : 4);
          return;
        }
        c.fillStyle = item.color || p.ink2;
        c.fillRect(x, yOf(item.value), bw, bottom - yOf(item.value));
      });
      if (opts.ref) {
        c.strokeStyle = p.critical;
        c.setLineDash([4, 3]);
        c.beginPath();
        c.moveTo(left, Math.round(yOf(opts.ref.value)) + 0.5);
        c.lineTo(right, Math.round(yOf(opts.ref.value)) + 0.5);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = p.critical;
        c.textAlign = 'left';
        c.textBaseline = 'bottom';
        c.fillText(opts.ref.label, left + 4, yOf(opts.ref.value) - 3);
      }
      c.fillStyle = p.ink3;
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillText('step 0', left, h - 5);
      c.textAlign = 'right';
      c.fillText(`step ${N - 1}`, right, h - 5);
    });
    ctx.drawImage(base, 0, 0, w, h);
    const x = xOf(step + 1);
    future(ctx, x, top - 4, right, bottom, p);
    cursor(ctx, x, top - 4, bottom, p);
    return (px) => Math.max(0, Math.min(N - 1, Math.floor(((px - left) / (right - left)) * N)));
  }

  // ---------------------------------------------------------------------------
  // Line: one number per step, e.g. clashing borders during local search.
  // ---------------------------------------------------------------------------
  function line(canvas, run, key, values, step) {
    const { ctx, w, h, dpr } = fit(canvas);
    const p = palette();
    const N = values.length;
    const maxValue = Math.max(1, ...values);
    const left = 28;
    const right = w - 8;
    const top = 10;
    const bottom = h - 18;
    const xOf = (s) => left + (N === 1 ? 0 : (s / (N - 1)) * (right - left));
    const yOf = (v) => bottom - (v / maxValue) * (bottom - top);
    const base = layer(run, `line:${key}`, w, h, dpr, (c) => {
      c.fillStyle = p.surface;
      c.fillRect(0, 0, w, h);
      c.fillStyle = p.ink3;
      c.font = '10px system-ui, sans-serif';
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      const ticks = maxValue <= 6 ? maxValue : 4;
      c.strokeStyle = p.line;
      for (let k = 0; k <= ticks; k++) {
        const v = Math.round((k * maxValue) / ticks);
        c.beginPath();
        c.moveTo(left, Math.round(yOf(v)) + 0.5);
        c.lineTo(right, Math.round(yOf(v)) + 0.5);
        c.stroke();
        c.fillText(String(v), left - 6, yOf(v));
      }
      c.beginPath();
      values.forEach((v, s) => (s ? c.lineTo(xOf(s), yOf(v)) : c.moveTo(xOf(s), yOf(v))));
      c.strokeStyle = p.critical;
      c.lineWidth = 2;
      c.lineJoin = 'round';
      c.stroke();
      c.lineTo(xOf(N - 1), bottom);
      c.lineTo(xOf(0), bottom);
      c.closePath();
      c.globalAlpha = 0.12;
      c.fillStyle = p.critical;
      c.fill();
      c.globalAlpha = 1;
      c.fillStyle = p.ink3;
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillText('step 0', left, h - 5);
      c.textAlign = 'right';
      c.fillText(`step ${N - 1}`, right, h - 5);
    });
    ctx.drawImage(base, 0, 0, w, h);
    const x = xOf(step);
    future(ctx, x + 1, top - 4, right + 4, bottom, p);
    cursor(ctx, x, top - 4, bottom, p);
    ctx.fillStyle = p.critical;
    ctx.beginPath();
    ctx.arc(x, yOf(values[step]), 3.5, 0, Math.PI * 2);
    ctx.fill();
    return (px) => Math.max(0, Math.min(N - 1, Math.round(((px - left) / (right - left)) * (N - 1))));
  }

  root.MapCharts = { timeline, tree, bars, line };
})(typeof self !== 'undefined' ? self : this);
