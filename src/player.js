/*
 * Player: steps through a recorded run. Builds its own controls (back, play,
 * forward, speed) and a timeline strip that shows the whole run at a glance:
 * one thin column per step, colored by what happened there. Click or drag
 * the strip to jump.
 */
(function () {
  'use strict';

  const SPEEDS = [
    { key: 'slow', label: 'Slow', ms: 1300, fx: 1.5 },
    { key: 'normal', label: 'Normal', ms: 700, fx: 1 },
    { key: 'fast', label: 'Fast', ms: 160, fx: 0.35 },
    { key: 'turbo', label: 'Very fast', ms: 0, fx: 0 },
  ];

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    }
    for (const k of kids) if (k !== null && k !== undefined) e.append(k);
    return e;
  }

  const ICONS = {
    first: '<svg viewBox="0 0 16 16"><path d="M3 3h2v10H3zM13 3v10L6 8z"/></svg>',
    back: '<svg viewBox="0 0 16 16"><path d="M11 3v10L4 8z"/></svg>',
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11L13.5 8z"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z"/></svg>',
    fwd: '<svg viewBox="0 0 16 16"><path d="M5 3v10l7-5z"/></svg>',
    last: '<svg viewBox="0 0 16 16"><path d="M11 3h2v10h-2zM3 3v10l7-5z"/></svg>',
    replay: '<svg viewBox="0 0 16 16"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.6.6A3.8 3.8 0 1 0 8 4.2V6L4.8 3.4 8 .8z"/></svg>',
  };

  class Player {
    // opts: { host, length, onStep(i, prev), tick(i) -> { color, kind }, doomed(i) -> bool,
    //         speed: 'normal', autoplay: false, loop: false, label(i) -> string }
    constructor(opts) {
      this.o = opts;
      this.i = 0;
      this.length = opts.length;
      this.playing = false;
      this.speed = SPEEDS.find((s) => s.key === (opts.speed || 'normal'));
      this.build(opts.host);
      this.setLength(opts.length, 0);
    }

    build(host) {
      const opts = this.o;
      const btn = (key, title, fn) => {
        const b = h('button', { class: 'pbtn pbtn-' + key, type: 'button', title, 'aria-label': title, onclick: fn });
        b.innerHTML = ICONS[key];
        return b;
      };
      this.bPlay = btn('play', 'Play', () => this.toggle());
      this.bPlay.classList.add('pbtn-main');
      this.stepLabel = h('span', { class: 'pstep' });
      this.speedSel = h(
        'select',
        { class: 'pspeed', 'aria-label': 'Speed', onchange: () => this.setSpeed(this.speedSel.value) },
        ...SPEEDS.map((s) => h('option', { value: s.key }, s.label))
      );
      this.speedSel.value = this.speed.key;
      this.canvas = h('canvas', { class: 'ptimeline', height: 26, 'aria-hidden': 'true' });
      this.strip = h('div', { class: 'pstrip' }, this.canvas);
      this.root = h(
        'div',
        { class: 'player', tabindex: 0 },
        h(
          'div',
          { class: 'pbar' },
          btn('first', 'To the start', () => this.go(0)),
          btn('back', 'Step back', () => this.go(this.i - 1)),
          this.bPlay,
          btn('fwd', 'Step forward', () => this.go(this.i + 1, true)),
          btn('last', 'To the end', () => this.go(this.length - 1)),
          this.stepLabel,
          this.speedSel
        ),
        this.strip
      );
      if (opts.legend) {
        const key = h('div', { class: 'pkey' });
        key.innerHTML = opts.legend;
        this.root.append(key);
      }
      host.appendChild(this.root);

      this.root.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'SELECT') return;
        if (e.key === 'ArrowRight') this.go(this.i + 1, true);
        else if (e.key === 'ArrowLeft') this.go(this.i - 1);
        else if (e.key === ' ') this.toggle();
        else return;
        e.preventDefault();
      });

      let dragging = false;
      const seek = (e) => {
        const r = this.canvas.getBoundingClientRect();
        const k = Math.floor(((e.clientX - r.left) / r.width) * this.length);
        this.pause();
        this.go(Math.max(0, Math.min(this.length - 1, k)));
      };
      this.canvas.addEventListener('pointerdown', (e) => {
        dragging = true;
        this.canvas.setPointerCapture(e.pointerId);
        seek(e);
      });
      this.canvas.addEventListener('pointermove', (e) => dragging && seek(e));
      this.canvas.addEventListener('pointerup', () => (dragging = false));
      if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.drawStrip()).observe(this.strip);
    }

    setLength(length, at = 0) {
      this.pause();
      this.length = length;
      this.i = Math.max(0, Math.min(length - 1, at));
      this.stripCache = null;
      this.o.onStep(this.i, -1);
      this.update();
    }

    setSpeed(key) {
      this.speed = SPEEDS.find((s) => s.key === key) || SPEEDS[1];
      this.speedSel.value = this.speed.key;
    }

    go(k, animate = false) {
      k = Math.max(0, Math.min(this.length - 1, k));
      if (k === this.i && !animate) return;
      const prev = this.i;
      this.i = k;
      if (prev !== k) {
        // Effects started by this step use this player's speed; others keep the default.
        window.MapFX.scale = animate && k === prev + 1 ? this.speed.fx : 0;
        try {
          this.o.onStep(k, animate && k === prev + 1 ? prev : -1);
        } finally {
          window.MapFX.scale = 1;
        }
      }
      this.update();
    }

    toggle() {
      this.playing ? this.pause() : this.play();
    }

    play() {
      if (this.i >= this.length - 1) this.go(0);
      this.playing = true;
      this.bPlay.innerHTML = ICONS.pause;
      this.bPlay.title = 'Pause';
      let last = performance.now();
      const loop = (now) => {
        if (!this.playing) return;
        const ms = this.speed.ms;
        if (ms === 0) {
          // Very fast: cover the run in about six seconds, at least one step per frame.
          const per = Math.max(1, Math.ceil(this.length / 360));
          const target = Math.min(this.length - 1, this.i + per);
          if (target === this.i + 1) this.go(target, true);
          else this.go(target);
          last = now;
        } else if (now - last >= ms) {
          last = now;
          this.go(this.i + 1, true);
        }
        if (this.i >= this.length - 1) {
          if (this.o.loop) {
            this.loopTimer = setTimeout(() => this.playing && this.go(0), 2600);
            this.loopTimer2 = setTimeout(() => {
              if (!this.playing) return;
              last = performance.now();
              requestAnimationFrame(loop);
            }, 3000);
            return;
          }
          this.pause();
          return;
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      this.update();
    }

    pause() {
      this.playing = false;
      clearTimeout(this.loopTimer);
      clearTimeout(this.loopTimer2);
      if (this.bPlay) {
        this.bPlay.innerHTML = this.i >= this.length - 1 && this.length > 1 ? ICONS.replay : ICONS.play;
        this.bPlay.title = 'Play';
      }
    }

    update() {
      const label = this.o.label ? this.o.label(this.i) : `Step ${this.i} of ${this.length - 1}`;
      this.stepLabel.textContent = label;
      if (!this.playing) this.bPlay.innerHTML = this.i >= this.length - 1 && this.length > 1 ? ICONS.replay : ICONS.play;
      this.drawStrip();
    }

    // The timeline strip: precomputed columns, then the current position.
    drawStrip() {
      const c = this.canvas;
      const w = Math.max(10, this.strip.clientWidth);
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.style.width = w + 'px';
        this.stripCache = null;
      }
      const H = 26;
      c.height = H * dpr;
      c.style.height = H + 'px';
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!this.stripCache) this.stripCache = this.renderColumns(w, H);
      ctx.clearRect(0, 0, w, H);
      ctx.drawImage(this.stripCache, 0, 0, w, H);
      const css = getComputedStyle(this.root);
      const bw = w / Math.max(1, this.length);
      const x = (this.i + 0.5) * bw;
      ctx.fillStyle = css.getPropertyValue('--surface').trim() || '#fff';
      ctx.globalAlpha = 0.6;
      ctx.fillRect(Math.min(w, x + Math.max(1, bw / 2)), 0, w, H);
      ctx.globalAlpha = 1;
      ctx.fillStyle = css.getPropertyValue('--ink').trim() || '#000';
      ctx.fillRect(Math.max(0, x - 1), 0, 2, H);
    }

    renderColumns(w, H) {
      const dpr = window.devicePixelRatio || 1;
      const off = document.createElement('canvas');
      off.width = Math.round(w * dpr);
      off.height = Math.round(H * dpr);
      const ctx = off.getContext('2d');
      ctx.scale(dpr, dpr);
      const css = getComputedStyle(this.root);
      const v = (name) => css.getPropertyValue(name).trim();
      const pal = { 1: v('--c1'), 2: v('--c2'), 3: v('--c3'), 4: v('--c4'), bad: v('--alarm'), undo: v('--ink-3'), other: v('--ink-2'), done: v('--ink') };
      ctx.fillStyle = v('--surface-3');
      ctx.fillRect(0, 0, w, H);
      const n = this.length;
      if (!this.o.tick || n < 2) return off;
      // Each step is a column; when steps are narrower than a pixel, each pixel
      // shows the most important thing that happened in it.
      const rank = { bad: 4, done: 3, undo: 2, other: 1 };
      const bw = w / n;
      const cols = bw >= 1 ? n : Math.floor(w);
      const best = new Array(cols).fill(null);
      const doom = new Array(cols).fill(false);
      for (let i = 0; i < n; i++) {
        const x = bw >= 1 ? i : Math.min(cols - 1, Math.floor(i * bw));
        const t = this.o.tick(i);
        if (t) {
          const r = rank[t] || 0.5;
          if (!best[x] || r >= best[x].r) best[x] = { t, r };
        }
        if (this.o.doomed && this.o.doomed(i)) doom[x] = true;
      }
      const cw = bw >= 1 ? bw : 1;
      const gap = bw >= 4 ? 1 : 0;
      for (let x = 0; x < cols; x++) {
        const x0 = bw >= 1 ? x * bw : x;
        if (best[x]) {
          ctx.fillStyle = pal[best[x].t] || pal.other;
          ctx.fillRect(x0, 4, cw - gap, H - 12);
        }
        if (doom[x]) {
          ctx.fillStyle = pal.bad;
          ctx.fillRect(x0, H - 5, cw, 4);
        }
      }
      return off;
    }

    refresh() {
      this.stripCache = null;
      this.drawStrip();
    }
  }

  window.Player = Player;
  window.h = h;
})();
