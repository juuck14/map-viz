// The "what is still possible" helpers, the waste analysis behind the red
// branches, and every claim the page makes about the runs it shows. Neighbors
// for the expected values come from the generator's record (via the checker).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, built, byId, checkerNeighborLists } = require('./helpers.js');

const bit = (c) => 1 << (c - 1);

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const { data, map, graph } of built) {
  test(`${data.id}: option masks and dead regions match the checker's neighbors`, () => {
    const nbrs = checkerNeighborLists(data, graph);
    const rand = mulberry(data.regions.length * 31 + 7);
    for (let trial = 0; trial < 60; trial++) {
      const colors = Uint8Array.from({ length: graph.n }, () => (rand() < 0.55 ? 1 + Math.floor(rand() * 4) : 0));
      const masks = Core.optionMasks(graph, colors);
      const dead = Core.deadRegions(graph, colors);
      for (let v = 0; v < graph.n; v++) {
        if (colors[v]) {
          assert.equal(masks[v], 0, `colored ${graph.ids[v]} has no options listed`);
          continue;
        }
        let used = 0;
        for (const u of nbrs[v]) if (colors[u]) used |= bit(colors[u]);
        assert.equal(masks[v], 15 & ~used, `options of ${graph.ids[v]}`);
        assert.equal(dead.includes(v), used === 15, `dead flag of ${graph.ids[v]}`);
      }
    }
  });

  // Section 7: forward checking explores exactly the backtracking tree with
  // every branch below a doomed node removed, node for node.
  test(`${data.id}: forward checking's tree is backtracking's tree without the wasted branches`, () => {
    const orders = ['alphabetical', 'leftToRight', 'mostNeighbors'].map((k) => Core.ORDERS[k].make(map, graph));
    for (let seed = 1; seed <= 6; seed++) orders.push(Core.ORDERS.random.make(map, graph, seed));
    for (const order of orders) {
      const bt = Core.backtrackTrace(graph, order, 40000);
      const fc = Core.forwardCheckTrace(graph, order, 40000);
      if (!bt.success || !fc.success) continue; // cut off by the step limit: not comparable
      const { wasted, doomed } = Core.searchWaste(graph, bt);
      const kept = bt.nodes.filter((_, i) => !wasted[i]);
      assert.equal(kept.length, fc.nodes.length);
      kept.forEach((nd, i) => {
        const f = fc.nodes[i];
        assert.equal(nd.v, f.v, `node ${i}: region`);
        // A doomed node is where forward checking sees the wipeout and undoes.
        if (!nd.dead) assert.equal(nd.color, f.color, `node ${i}: color`);
        assert.equal(!!nd.dead, !!f.dead, `node ${i}: dead end`);
      });
      // Nothing under a doomed node ever reaches a full coloring.
      const lastNode = bt.nodes.length - 1;
      assert.ok(!wasted[lastNode] && !doomed[lastNode], 'the final path is never wasted');
      // Forward checking itself never places a node while a region is dead.
      const w = Core.searchWaste(graph, fc);
      assert.ok(w.wasted.every((x) => !x), 'forward checking grows no wasted branch');
    }
  });
}

test('section 3-4: alphabetical greedy on the greedy trap dies at L, which was dead two steps earlier', () => {
  const { map, graph } = byId('trap');
  const run = Core.greedyTrace(graph, Core.ORDERS.alphabetical.make(map, graph));
  const last = run.steps.at(-1);
  assert.equal(last.kind, 'stuck');
  assert.equal(graph.ids[last.v], 'L');
  const deadAt = run.steps.findIndex((s) => Core.deadRegions(graph, s.colors).includes(last.v));
  assert.equal(deadAt, run.steps.length - 3);
});

test('section 5: on Continent, alphabetical greedy gets stuck and DSATUR finishes', () => {
  const { map, graph } = byId('continent');
  assert.equal(graph.n, 32);
  assert.equal(Core.greedyTrace(graph, Core.ORDERS.alphabetical.make(map, graph)).success, false);
  assert.equal(Core.dsaturTrace(graph).success, true);
});

test('section 6: backtracking on Continent (left to right) backtracks and wastes work while a region is dead', () => {
  const { map, graph } = byId('continent');
  const bt = Core.backtrackTrace(graph, Core.ORDERS.leftToRight.make(map, graph));
  assert.ok(bt.success);
  assert.ok(bt.steps.at(-1).backtracks > 10);
  const { wasted } = Core.searchWaste(graph, bt);
  assert.ok(wasted.filter(Boolean).length > bt.nodes.length / 3);
  assert.ok(bt.steps.length < 400, 'short enough to watch');
});

test('section 7: on Ragged coast with an unlucky order, nearly all of plain backtracking is wasted', () => {
  const { map, graph } = byId('ragged');
  assert.equal(graph.n, 30);
  const order = Core.ORDERS.random.make(map, graph, 1);
  const bt = Core.backtrackTrace(graph, order);
  const fc = Core.forwardCheckTrace(graph, order);
  const mc = Core.forwardCheckTrace(graph, null);
  assert.ok(bt.success && fc.success && mc.success);
  const wasted = Core.searchWaste(graph, bt).wasted.filter(Boolean).length;
  assert.ok(wasted / bt.nodes.length > 0.95);
  assert.ok(bt.nodes.length > 50 * fc.nodes.length);
  assert.ok(mc.nodes.length < fc.nodes.length);
});

test('section 8: Kempe chains at L, as the page explains them', () => {
  const { map, graph } = byId('trap');
  const stuck = Core.greedyTrace(graph, Core.ORDERS.alphabetical.make(map, graph)).steps.at(-1);
  const L = stuck.v;
  const id = (s) => graph.ids.indexOf(s);
  const swapFrees = (start, b) => {
    const colors = stuck.colors.slice();
    const a = colors[start];
    const chain = Core.kempeChain(graph, colors, start, a, b);
    for (const u of chain) colors[u] = colors[u] === a ? b : a;
    // The swap never creates a clash.
    for (let v = 0; v < graph.n; v++) for (const u of graph.neighbors[v]) if (colors[u] && colors[u] === colors[v]) return 'clash';
    return Core.colorOptions(graph, colors, L, 0).available;
  };
  // J alone in yellow/green: the swap frees yellow.
  assert.deepEqual(swapFrees(id('J'), 4), [2]);
  // I's blue/yellow chain runs around L and reaches J: nothing freed.
  assert.ok(Core.kempeChain(graph, stuck.colors, id('I'), 1, 2).includes(id('J')));
  assert.deepEqual(swapFrees(id('I'), 2), []);
  // I alone in blue/pink: K is also blue and outside the chain, so blue stays blocked.
  assert.deepEqual(Core.kempeChain(graph, stuck.colors, id('I'), 1, 3), [id('I')]);
  assert.deepEqual(swapFrees(id('I'), 3), []);
});

test('section 2: in Five around one, the center touches the other five, which form a ring of five', () => {
  const { graph } = byId('ring');
  const center = graph.neighbors.findIndex((l) => l.length === graph.n - 1);
  assert.ok(center >= 0);
  for (let v = 0; v < graph.n; v++) if (v !== center) assert.equal(graph.neighbors[v].filter((u) => u !== center).length, 2);
});

test('the tree comparison is not vacuous: many runs have wasted branches to cut', () => {
  let compared = 0;
  let withWaste = 0;
  for (const { map, graph } of built) {
    const orders = ['alphabetical', 'leftToRight', 'mostNeighbors'].map((k) => Core.ORDERS[k].make(map, graph));
    for (let seed = 1; seed <= 6; seed++) orders.push(Core.ORDERS.random.make(map, graph, seed));
    for (const order of orders) {
      const bt = Core.backtrackTrace(graph, order, 40000);
      if (!bt.success || !Core.forwardCheckTrace(graph, order, 40000).success) continue;
      compared++;
      if (Core.searchWaste(graph, bt).wasted.some(Boolean)) withWaste++;
    }
  }
  assert.ok(compared >= 50, `compared ${compared}`);
  assert.ok(withWaste >= 20, `with waste ${withWaste}`);
});
