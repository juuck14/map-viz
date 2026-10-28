// Every step of every algorithm run is re-checked against neighbors read by
// the independent checker, not against core.js's own neighbor lists.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, Checker, built, byId, asColoring, gridNeighborLists } = require('./helpers.js');

const range = (n) => Array.from({ length: n }, (_, i) => i);

function ordersFor(map, graph) {
  const orders = Object.entries(Core.ORDERS)
    .filter(([key]) => key !== 'random')
    .map(([key, o]) => [key, o.make(map, graph)]);
  for (let seed = 1; seed <= 12; seed++) orders.push([`random#${seed}`, Core.ORDERS.random.make(map, graph, seed)]);
  return orders;
}

// Colors still open for v, worked out from scratch with the grid neighbors.
function expectedAvailable(nbrs, colors, v, tried) {
  const used = new Set(nbrs[v].map((u) => colors[u]));
  return range(5).slice(1).filter((c) => !used.has(c) && !tried.includes(c));
}

function changedAt(a, b) {
  return range(a.length).filter((i) => a[i] !== b[i]);
}

function checkTrace(spec, graph, run) {
  const nbrs = gridNeighborLists(spec, graph);
  const { steps } = run;
  assert.equal(steps[0].kind, 'start');
  assert.ok(steps[0].colors.every((c) => c === 0));
  for (let k = 0; k < steps.length; k++) {
    const st = steps[k];
    const verdict = Checker.checkColoring(spec.grid, asColoring(graph, st.colors));
    assert.ok(verdict.proper, `step ${k} (${st.kind}) has a conflict: ${JSON.stringify(verdict.conflicts)}`);
    if (k === 0) continue;
    const prev = steps[k - 1].colors;
    const tried = st.tried ? st.tried[st.v] || [] : [];
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
        assert.ok(st.tried[st.v].includes(st.color), `step ${k}: undone color is marked as tried`);
        break;
      case 'done': {
        assert.equal(k, steps.length - 1);
        const final = Checker.checkColoring(spec.grid, asColoring(graph, st.colors));
        assert.ok(final.complete, 'finished coloring is complete and proper');
        assert.equal(final.used, st.used);
        break;
      }
      default:
        assert.fail(`unexpected step kind ${st.kind}`);
    }
  }
  const last = steps[steps.length - 1];
  assert.equal(run.success, last.kind === 'done');
}

for (const { spec, map, graph } of built) {
  for (const [name, order] of ordersFor(map, graph)) {
    test(`${spec.id}: greedy, ${name} order`, () => {
      assert.deepEqual([...order].sort((a, b) => a - b), range(graph.n), 'order is a permutation');
      const run = Core.greedyTrace(graph, order);
      checkTrace(spec, graph, run);
      // Greedy visits regions exactly in the given order.
      const visited = run.steps.filter((s) => s.v != null).map((s) => s.v);
      assert.deepEqual(visited, order.slice(0, visited.length));
    });

    test(`${spec.id}: backtracking, ${name} order, always finishes`, () => {
      const run = Core.backtrackTrace(graph, order, 100000);
      checkTrace(spec, graph, run);
      assert.equal(run.success, true);
    });
  }

  test(`${spec.id}: DSATUR picks the most saturated region each time`, () => {
    const run = Core.dsaturTrace(graph);
    checkTrace(spec, graph, run);
    const nbrs = gridNeighborLists(spec, graph);
    for (let k = 1; k < run.steps.length; k++) {
      const st = run.steps[k];
      if (st.kind !== 'assign' && st.kind !== 'stuck') continue;
      const prev = run.steps[k - 1].colors;
      const score = (v) => [
        new Set(nbrs[v].map((u) => prev[u]).filter((c) => c)).size,
        nbrs[v].filter((u) => !prev[u]).length,
        -v,
      ];
      const best = range(graph.n)
        .filter((v) => !prev[v])
        .sort((a, b) => {
          const [sa, sb] = [score(a), score(b)];
          return sb[0] - sa[0] || sb[1] - sa[1] || sb[2] - sa[2];
        })[0];
      assert.equal(st.v, best, `step ${k}: DSATUR should pick ${graph.ids[best]}`);
    }
  });
}

// Brute force: is there any proper coloring with this many colors?
function colorable(spec, graph, numColors) {
  const nbrs = gridNeighborLists(spec, graph);
  const colors = new Array(graph.n).fill(0);
  const total = numColors ** graph.n;
  for (let code = 0; code < total; code++) {
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
  const { spec, graph } = byId('ring');
  assert.equal(colorable(spec, graph, 3), false);
  assert.equal(colorable(spec, graph, 4), true);
});

test('four corners: three colors are enough (brute force)', () => {
  const { spec, graph } = byId('corners');
  assert.equal(colorable(spec, graph, 3), true);
});

test('greedy trap: alphabetical greedy gets stuck at G; backtracking needs 2 backtracks', () => {
  const { map, graph } = byId('trap');
  const order = Core.ORDERS.alphabetical.make(map, graph);
  const greedy = Core.greedyTrace(graph, order);
  const last = greedy.steps[greedy.steps.length - 1];
  assert.equal(last.kind, 'stuck');
  assert.equal(graph.ids[last.v], 'G');
  const bt = Core.backtrackTrace(graph, order);
  assert.equal(bt.success, true);
  assert.equal(bt.steps[bt.steps.length - 1].backtracks, 2);
});

test('continent: greedy gets stuck with some orders and not others; backtracking can need hundreds of backtracks', () => {
  const { map, graph } = byId('continent');
  const stuck = (key) => !Core.greedyTrace(graph, Core.ORDERS[key].make(map, graph, 1)).success;
  assert.equal(stuck('alphabetical'), true);
  assert.equal(stuck('mostNeighbors'), false);
  const bt = Core.backtrackTrace(graph, Core.ORDERS.random.make(map, graph, 1));
  assert.ok(bt.steps[bt.steps.length - 1].backtracks >= 100);
});
