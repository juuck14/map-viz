/*
 * TreeView: the search tree of a backtracking run, drawn on a canvas.
 *
 * One node per color tried, one level down per region colored. Leaves are laid
 * out left to right in the order the search reached them, so the tree grows
 * left to right as the run goes on. Branches grown after some region was
 * already left with no color at all ("wasted") are drawn in the alarm color:
 * nothing below them could ever succeed.
 */
(function () {
  'use strict';

  const Core = window.MapCore;

  class TreeView {
    // opts: { trace, graph, sx (px per leaf; default: fit), onPick(step), onHover(step|null), center }
    constructor(host, opts) {
      this.o = opts;
      this.host = host;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'treeview';
      host.appendChild(this.canvas);
      this.step = 0;
      this.setTrace(opts.trace);
      this.canvas.addEventListener('pointermove', (e) => this.hover(e));
      this.canvas.addEventListener('pointerleave', () => {
        this.hoverNode = -1;
        this.draw();
        this.o.onHover && this.o.onHover(null);
      });
      this.canvas.addEventListener('click', (e) => {
        const k = this.nearest(e);
        if (k >= 0 && this.o.onPick) this.o.onPick(this.trace.nodes[k].step);
      });
      if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.draw()).observe(host);
    }

    setTrace(trace) {
      this.trace = trace;
      this.step = 0;
      const nodes = trace.nodes;
      const N = nodes.length;
      const kids = Array.from({ length: N }, () => []);
      const rootKids = [];
      nodes.forEach((nd, i) => (nd.parent >= 0 ? kids[nd.parent] : rootKids).push(i));
      const depth = new Int16Array(N);
      nodes.forEach((nd, i) => (depth[i] = nd.parent >= 0 ? depth[nd.parent] + 1 : 1));
      const x = new Float64Array(N);
      let leaf = 0;
      // Nodes are created in depth-first order, so leaves come out left to right.
      nodes.forEach((nd, i) => {
        if (!kids[i].length) x[i] = leaf++;
      });
      for (let i = N - 1; i >= 0; i--) if (kids[i].length) x[i] = (x[kids[i][0]] + x[kids[i][kids[i].length - 1]]) / 2;
      this.rootX = rootKids.length ? (x[rootKids[0]] + x[rootKids[rootKids.length - 1]]) / 2 : 0;
      this.x = x;
      this.depth = depth;
      this.leaves = Math.max(1, leaf);
      this.maxDepth = Math.max(1, ...depth, this.o.graph.n);
      const w = Core.searchWaste(this.o.graph, trace);
      this.wasted = w.wasted;
      this.doomed = w.doomed;
      this.hoverNode = -1;
      this.draw();
    }

    show(step) {
      this.step = step;
      this.draw();
    }

    // Count of nodes placed up to this step, and how many of them were wasted.
    stats(step = this.step) {
      let all = 0;
      let wasted = 0;
      for (const [i, nd] of this.trace.nodes.entries()) {
        if (nd.step > step) break;
        all++;
        if (this.wasted[i]) wasted++;
      }
      return { all, wasted };
    }

    geometry() {
      const W = Math.max(40, this.host.clientWidth);
      const H = Math.max(40, this.host.clientHeight);
      const pad = 10;
      const sx = this.o.sx ? this.o.sx(W) : (W - 2 * pad) / Math.max(1, this.leaves - 1);
      const used = sx * (this.leaves - 1);
      const ox = this.o.center === false || !this.o.sx ? pad + (this.o.sx ? 0 : Math.max(0, (W - 2 * pad - used) / 2)) : (W - used) / 2;
      const sy = (H - 2 * pad - 6) / this.maxDepth;
      return { W, H, pad, sx, sy, ox, oy: pad + 2 };
    }

    pos(i, g) {
      return [g.ox + this.x[i] * g.sx, g.oy + this.depth[i] * g.sy];
    }

    draw() {
      const g = (this.g = this.geometry());
      const dpr = window.devicePixelRatio || 1;
      const c = this.canvas;
      if (c.width !== Math.round(g.W * dpr) || c.height !== Math.round(g.H * dpr)) {
        c.width = Math.round(g.W * dpr);
        c.height = Math.round(g.H * dpr);
        c.style.width = g.W + 'px';
        c.style.height = g.H + 'px';
      }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, g.W, g.H);
      const css = getComputedStyle(this.host);
      const v = (n) => css.getPropertyValue(n).trim();
      const pal = ['', v('--c1'), v('--c2'), v('--c3'), v('--c4')];
      const alarm = v('--alarm');
      const ink = v('--ink');
      const faint = v('--ink-3');

      const nodes = this.trace.nodes;
      const step = this.step;
      const root = [g.ox + this.rootX * g.sx, g.oy];
      const big = nodes.length > 600;
      const lw = big ? 0.8 : 1.6;

      // Faint level guides.
      ctx.fillStyle = v('--surface-3');
      for (let d = 1; d <= this.maxDepth; d += 1) {
        if (this.maxDepth > 40 && d % 2) continue;
        ctx.fillRect(0, g.oy + d * g.sy, g.W, 0.5);
      }

      const parentPos = (nd) => (nd.parent >= 0 ? this.pos(nd.parent, g) : root);
      // Pass 1: everything placed so far. Abandoned branches fade.
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < nodes.length; i++) {
          const nd = nodes[i];
          if (nd.step > step) break;
          const gone = nd.undone !== undefined && nd.undone <= step;
          const isWaste = this.wasted[i];
          if ((pass === 0) !== gone && !nd.dead) continue;
          if (nd.dead && pass === 0) continue;
          const [x0, y0] = parentPos(nd);
          const [x1, y1] = this.pos(i, g);
          if (nd.dead) {
            ctx.strokeStyle = alarm;
            ctx.lineWidth = big ? 0.8 : 1.4;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
            if (!big) {
              const s = 3.2;
              ctx.lineWidth = 1.6;
              ctx.beginPath();
              ctx.moveTo(x1 - s, y1 - s);
              ctx.lineTo(x1 + s, y1 + s);
              ctx.moveTo(x1 + s, y1 - s);
              ctx.lineTo(x1 - s, y1 + s);
              ctx.stroke();
            }
            continue;
          }
          ctx.globalAlpha = gone ? (isWaste ? 0.55 : 0.45) : 1;
          ctx.strokeStyle = isWaste ? alarm : pal[nd.color];
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          if (!big && !isWaste) {
            ctx.fillStyle = pal[nd.color];
            ctx.beginPath();
            ctx.arc(x1, y1, gone ? 1.8 : 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;

      // The current path, from the root down to the region being decided.
      const cur = this.trace.steps[step].cur;
      if (cur !== undefined && cur >= 0) {
        const path = [];
        for (let k = cur; k >= 0; k = nodes[k].parent) path.push(k);
        path.reverse();
        ctx.strokeStyle = ink;
        ctx.lineWidth = big ? 2 : 2.6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(root[0], root[1]);
        for (const k of path) ctx.lineTo(...this.pos(k, g));
        ctx.stroke();
        const [cx, cy] = this.pos(cur, g);
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pal[nodes[cur].color] || faint;
        ctx.beginPath();
        ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      // Root.
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(root[0], root[1], 3.2, 0, Math.PI * 2);
      ctx.fill();

      if (this.hoverNode >= 0) {
        const [hx, hy] = this.pos(this.hoverNode, g);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(hx, hy, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    nearest(e) {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const g = this.g || this.geometry();
      let best = -1;
      let bd = 12 * 12;
      const nodes = this.trace.nodes;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].step > this.step) break;
        const [x, y] = this.pos(i, g);
        const d = (x - mx) ** 2 + (y - my) ** 2;
        if (d < bd) [bd, best] = [d, i];
      }
      return best;
    }

    hover(e) {
      const k = this.nearest(e);
      if (k === this.hoverNode) return;
      this.hoverNode = k;
      this.canvas.style.cursor = k >= 0 && this.o.onPick ? 'pointer' : 'default';
      this.draw();
      this.o.onHover && this.o.onHover(k >= 0 ? this.trace.nodes[k] : null);
    }
  }

  window.TreeView = TreeView;
})();
