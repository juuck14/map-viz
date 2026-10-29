// Every step of every algorithm run is re-checked against the neighbor list
// the generator recorded (via the checker), not against core.js's own lists.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, Checker, built, byId, asColoring, checkerNeighborLists } = require('./helpers.js');

const range = (n) => Array.from({ length: n }, (_, i) => i);
const FULL = 15;
const bit = (c) => 1 << (c - 1);

function ordersFor(map, graph) {
  const orders = ['alphabetical', 'leftToRight', 'mostNeighbors'].map((key) => [key, Core.ORDERS[key].make(map, graph)]);
  for (let seed = 1; seed <= 6; seed++) orders.push([`random#${seed}`, Core.ORDERS.random.make(map, graph, seed)]);
  return orders;
}

// Colors still open for v, worked out from scratch with the checker's neighbors.
function usedMask(nbrs, colors, v) {
  let m = 0;
  for (const u of nbrs[v]) if (colors[u]) m |= bit(colors[u]);
  return m;
}
function expectedAvailable(nbrs, colors, v, tried) {
  const m = usedMask(nbrs, colors, v) | (tried || 0);
  return [1, 2, 3, 4].filter((c) => !(m & bit(c)));
}
const changedAt = (a, b) => range(a.length).filter((i) => a[i] !== b[i]);
const proper = (data, graph, colors) => Checker.checkColoring(data, asColoring(graph, colors));

function countClashes(nbrs, colors) {
  let k = 0;
  nbrs.forEach((list, v) => list.forEach((u) => u > v && colors[u] === colors[v] && k++));
  return k;
}

// Checks shared by all algorithms that never create a clash.
function checkTrace(data, graph, run) {
  const nbrs = checkerNeighborLists(data, graph);
  const { steps } = run;
  assert.equal(steps[0].kind, 'start');
  assert.ok(steps[0].colors.every((c) => c === 0));
  for (let k = 0; k < steps.length; k++) {
    const st = steps[k];
    const verdict = proper(data, graph, st.colors);
    assert.ok(verdict.proper, `step ${k} (${st.kind}) has a clash: ${JSON.stringify(verdict.conflicts)}`);
    if (st.domains) {
      // Forward checking: an uncolored region's list is exactly the colors its
      // colored neighbors do not use.
      for (let u = 0; u < graph.n; u++) {
        if (!st.colors[u]) assert.equal(st.domains[u], FULL & ~usedMask(nbrs, st.colors, u), `step ${k}: list of ${graph.ids[u]}`);
      }
    }
    if (k === 0) continue;
    const prev = steps[k - 1].colors;
    const tried = st.tried ? st.tried[st.v] : 0;
    switch (st.kind) {
      case 'assign': {
        assert.deepEqual(changedAt(prev, st.colors), [st.v], `step ${k}: only the active region may change`);
        const avail = expectedAvailable(nbrs, prev, st.v, tried);
        assert.deepEqual(st.available, avail, `step ${k}: available colors`);
        assert.equal(st.color, avail[0], `step ${k}: takes the lowest available color`);
        break;
      }
      case 'stuck':
      case 'deadend':
        assert.deepEqual(changedAt(prev, st.colors), [], `step ${k}: nothing changes at a dead end`);
        assert.equal(prev[st.v], 0);
        assert.deepEqual(expectedAvailable(nbrs, prev, st.v, tried), [], `step ${k}: really no color left`);
        break;
      case 'undo':
        assert.deepEqual(changedAt(prev, st.colors), [st.v], `step ${k}: undo changes one region`);
        assert.equal(prev[st.v], st.color);
        assert.equal(st.colors[st.v], 0);
        assert.ok(st.tried[st.v] & bit(st.color), `step ${k}: undone color is marked as tried`);
        break;
      case 'wipeout':
        assert.deepEqual(changedAt(prev, st.colors), []);
        assert.equal(st.domains[st.u], 0, `step ${k}: the wiped-out list is empty`);
        assert.ok(nbrs[st.v].includes(st.u));
        break;
      case 'chain': {
        assert.deepEqual(changedAt(prev, st.colors), []);
        assert.deepEqual(expectedAvailable(nbrs, st.colors, st.v, 0), [], `step ${k}: a chain is only needed when stuck`);
        const inChain = new Set(st.chain);
        for (const u of st.chain) {
          assert.ok(st.colors[u] === st.a || st.colors[u] === st.b, `step ${k}: chain member ${graph.ids[u]} has another color`);
          for (const w of nbrs[u]) {
            if (st.colors[w] === st.a || st.colors[w] === st.b) assert.ok(inChain.has(w), `step ${k}: chain is not closed at ${graph.ids[w]}`);
          }
        }
        for (const u of st.starts) assert.ok(inChain.has(u) && nbrs[st.v].includes(u));
        break;
      }
      case 'swap': {
        const before = steps[k - 1];
        assert.equal(before.kind, 'chain');
        assert.deepEqual(changedAt(prev, st.colors).sort((a, b) => a - b), st.chain.slice().sort((a, b) => a - b));
        for (const u of st.chain) assert.equal(st.colors[u], prev[u] === st.a ? st.b : st.a);
        if (st.part === st.of) {
          assert.ok(expectedAvailable(nbrs, st.colors, st.v, 0).includes(st.a), `step ${k}: the swap frees color ${st.a}`);
        }
        break;
      }
      case 'peel':
        assert.deepEqual(changedAt(prev, st.colors), []);
        break;
      case 'done': {
        assert.equal(k, steps.length - 1);
        const final = proper(data, graph, st.colors);
        assert.ok(final.complete, 'finished coloring is complete and proper');
        assert.equal(final.used, st.used);
        break;
      }
      case 'limit':
        assert.equal(k, steps.length - 1);
        break;
      default:
        assert.fail(`unexpected step kind ${st.kind}`);
    }
  }
  const last = steps[steps.length - 1];
  assert.equal(run.success, last.kind === 'done');
}

for (const { data, map, graph } of built) {
  for (const [name, order] of ordersFor(map, graph)) {
    test(`${data.id}: greedy, Kempe, backtracking and forward checking, ${name} order`, () => {
      assert.deepEqual([...order].sort((a, b) => a - b), range(graph.n), 'order is a permutation');
      const greedy = Core.greedyTrace(graph, order);
      checkTrace(data, graph, greedy);
      const visited = greedy.steps.filter((s) => s.v != null).map((s) => s.v);
      assert.deepEqual(visited, order.slice(0, visited.length), 'greedy follows the order');

      const kempe = Core.kempeTrace(graph, order);
      checkTrace(data, graph, kempe);
      assert.ok(kempe.success, 'Kempe repairs finish on every prepared map');

      const bt = Core.backtrackTrace(graph, order);
      checkTrace(data, graph, bt);
      if (graph.n <= 12) assert.ok(bt.success, 'small maps finish within the step limit');

      checkTrace(data, graph, Core.forwardCheckTrace(graph, order));
    });
  }

  test(`${data.id}: forward checking with "most constrained first" finishes and follows its rule`, () => {
    const run = Core.forwardCheckTrace(graph);
    checkTrace(data, graph, run);
    assert.ok(run.success);
    const nbrs = checkerNeighborLists(data, graph);
    for (let k = 1; k < run.steps.length; k++) {
      const st = run.steps[k];
      const fresh = st.kind === 'assign' && ['start', 'assign'].includes(run.steps[k - 1].kind);
      if (!fresh) continue;
      const prev = run.steps[k - 1].colors;
      const score = (v) => [4 - Core.popcount(FULL & ~usedMask(nbrs, prev, v)), nbrs[v].filter((u) => !prev[u]).length, -v];
      const best = range(graph.n)
        .filter((v) => !prev[v])
        .sort((a, b) => {
          const [sa, sb] = [score(a), score(b)];
          return sb[0] - sa[0] || sb[1] - sa[1] || sb[2] - sa[2];
        })[0];
      assert.equal(st.v, best, `step ${k}: should pick ${graph.ids[best]}`);
    }
  });

  test(`${data.id}: DSATUR picks the most saturated region each time`, () => {
    const run = Core.dsaturTrace(graph);
    checkTrace(data, graph, run);
    const nbrs = checkerNeighborLists(data, graph);
    for (let k = 1; k < run.steps.length; k++) {
      const st = run.steps[k];
      if (st.kind !== 'assign' && st.kind !== 'stuck') continue;
      const prev = run.steps[k - 1].colors;
      const score = (v) => [Core.popcount(usedMask(nbrs, prev, v)), nbrs[v].filter((u) => !prev[u]).length, -v];
      const best = range(graph.n)
        .filter((v) => !prev[v])
        .sort((a, b) => {
          const [sa, sb] = [score(a), score(b)];
          return sb[0] - sa[0] || sb[1] - sa[1] || sb[2] - sa[2];
        })[0];
      assert.equal(st.v, best, `step ${k}: DSATUR should pick ${graph.ids[best]}`);
    }
  });

  test(`${data.id}: peeling removes a region with the fewest neighbors left, never more than 5`, () => {
    const run = Core.smallestLastTrace(graph);
    checkTrace(data, graph, run);
    const nbrs = checkerNeighborLists(data, graph);
    const gone = new Set();
    for (const st of run.steps.filter((s) => s.kind === 'peel')) {
      const left = (v) => nbrs[v].filter((u) => !gone.has(u)).length;
      assert.equal(st.degree, left(st.v));
      for (let v = 0; v < graph.n; v++) if (!gone.has(v)) assert.ok(left(v) >= st.degree);
      assert.ok(st.degree <= 5, "Euler's bound");
      gone.add(st.v);
    }
    assert.equal(gone.size, graph.n);
    const colored = run.steps.filter((s) => s.kind === 'assign').map((s) => s.v);
    assert.deepEqual(colored, run.order.slice().reverse().slice(0, colored.length), 'regions come back in reverse order');
  });

  test(`${data.id}: local search repairs until nothing clashes`, () => {
    const nbrs = checkerNeighborLists(data, graph);
    for (let seed = 1; seed <= 5; seed++) {
      const run = Core.minConflictsTrace(graph, seed);
      assert.ok(run.success, `seed ${seed} finishes`);
      run.steps.forEach((st, k) => {
        assert.ok(st.colors.every((c) => c >= 1 && c <= 4), 'every region always has a color');
        assert.equal(st.conflicts, countClashes(nbrs, st.colors), `step ${k}: clash count`);
        if (st.kind !== 'move') return;
        const prev = run.steps[k - 1].colors;
        assert.deepEqual(changedAt(prev, st.colors), [st.v]);
        assert.ok(nbrs[st.v].some((u) => prev[u] === prev[st.v]), `step ${k}: only a clashing region is recolored`);
        const counts = [1, 2, 3, 4].map((c) => nbrs[st.v].filter((u) => prev[u] === c).length);
        assert.deepEqual(st.counts, counts);
        if (!st.random) {
          const others = [1, 2, 3, 4].filter((c) => c !== st.from).map((c) => counts[c - 1]);
          assert.equal(counts[st.to - 1], Math.min(...others), `step ${k}: picks the color with the fewest clashes`);
          assert.ok(counts[st.to - 1] <= counts[st.from - 1]);
        }
      });
      const final = proper(data, graph, run.steps[run.steps.length - 1].colors);
      assert.ok(final.complete);
    }
  });
}

// Brute force: is there any proper coloring with this many colors?
function colorable(data, graph, numColors) {
  const nbrs = checkerNeighborLists(data, graph);
  const colors = new Array(graph.n).fill(0);
  for (let code = 0; code < numColors ** graph.n; code++) {
    let x = code;
    for (let v = 0; v < graph.n; v++) {
      colors[v] = (x % numColors) + 1;
      x = Math.floor(x / numColors);
    }
    if (nbrs.every((list, v) => list.every((u) => colors[u] !== colors[v]))) return true;
  }
  return false;
}

test('five around one: three colors are not enough, four are (brute force)', () => {
  const { data, graph } = byId('ring');
  assert.equal(colorable(data, graph, 3), false);
  assert.equal(colorable(data, graph, 4), true);
});

test('greedy trap: alphabetical greedy gets stuck; backtracking repairs it; another order does not get stuck', () => {
  const { map, graph } = byId('trap');
  const order = Core.ORDERS.alphabetical.make(map, graph);
  assert.equal(Core.greedyTrace(graph, order).success, false);
  const bt = Core.backtrackTrace(graph, order);
  assert.ok(bt.success);
  assert.ok(bt.steps[bt.steps.length - 1].backtracks >= 2);
  assert.ok(Core.greedyTrace(graph, Core.ORDERS.mostNeighbors.make(map, graph)).success);
});

// The map notes promise these behaviors; check that they really happen.
function someRandomOrder(id, predicate) {
  const { map, graph } = byId(id);
  return [1, 2, 3, 4, 5, 6].some((seed) => predicate(graph, Core.ORDERS.random.make(map, graph, seed)));
}
const backtracks = (run) => run.steps[run.steps.length - 1].backtracks;

test('continent: some orders get greedy stuck and others do not; an unlucky order costs hundreds of backtracks', () => {
  const { map, graph } = byId('continent');
  assert.equal(Core.greedyTrace(graph, Core.ORDERS.alphabetical.make(map, graph)).success, false);
  assert.ok(someRandomOrder('continent', (g, o) => Core.greedyTrace(g, o).success));
  assert.ok(someRandomOrder('continent', (g, o) => backtracks(Core.backtrackTrace(g, o)) >= 100));
});

test('archipelago: an unlucky order sends backtracking far back', () => {
  assert.ok(someRandomOrder('archipelago', (g, o) => backtracks(Core.backtrackTrace(g, o)) >= 100));
});

test('patchwork: plain backtracking can run out of steps where forward checking finishes', () => {
  assert.ok(someRandomOrder('patchwork', (g, o) => !Core.backtrackTrace(g, o).success));
  const { graph } = byId('patchwork');
  assert.ok(Core.forwardCheckTrace(graph).success);
});
