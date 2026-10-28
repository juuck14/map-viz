// Small runs traced by hand, step by step, and written down before running
// the code. If the code ever disagrees, either the code or the trace is wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { Core, byId } = require('./helpers.js');
const { bundle, out } = require('../build.js');

// "A1" = region A gets color 1; "G!" = no color left at G; "-F" = undo F.
function summary(graph, run) {
  return run.steps
    .map((s) => {
      const id = graph.ids[s.v];
      if (s.kind === 'assign') return id + s.color;
      if (s.kind === 'stuck' || s.kind === 'deadend') return id + '!';
      if (s.kind === 'undo') return '-' + id;
      return null;
    })
    .filter((x) => x)
    .join(' ');
}

function alphabetical(id) {
  const { map, graph } = byId(id);
  return { graph, order: Core.ORDERS.alphabetical.make(map, graph) };
}

test('four corners, greedy, alphabetical: uses 4 colors although 3 would do', () => {
  // A: no colored neighbor -> 1. B: A=1 -> 2. C: B=2 -> 1. D: C=1 -> 2.
  // E: C=1, D=2 -> 3. F: A=1, B=2, E=3 -> 4.
  const { graph, order } = alphabetical('corners');
  assert.equal(summary(graph, Core.greedyTrace(graph, order)), 'A1 B2 C1 D2 E3 F4');
});

test('five around one, greedy, alphabetical', () => {
  // The ring A-B-C-D-E needs three colors; F touches all five, so it takes 4.
  const { graph, order } = alphabetical('ring');
  assert.equal(summary(graph, Core.greedyTrace(graph, order)), 'A1 B2 C1 D2 E3 F4');
});

test('greedy trap, greedy, alphabetical: stuck at G', () => {
  // C=1 lets D take 3; E=2 then forces F to 4, and G sees 1, 2, 3, 4.
  const { graph, order } = alphabetical('trap');
  assert.equal(summary(graph, Core.greedyTrace(graph, order)), 'A1 B2 C1 D3 E2 F4 G!');
});

test('greedy trap, backtracking, alphabetical', () => {
  // G has no color: undo F. F has nothing else (1 A, 2 E, 3 D, 4 tried): undo E.
  // E tries 4 (2 is tried, 1 C, 3 D). Then F gets 2, G gets 4, H 3, I 3, J 4.
  const { graph, order } = alphabetical('trap');
  assert.equal(
    summary(graph, Core.backtrackTrace(graph, order)),
    'A1 B2 C1 D3 E2 F4 G! -F F! -E E4 F2 G4 H3 I3 J4'
  );
});

test('greedy trap, DSATUR', () => {
  // All saturations 0 at first: B has the most neighbors (6) -> 1.
  // A (sat 1, 4 free) -> 2. G (sat 2) -> 3. D ties F on sat 2 and free 3 -> D, 2.
  // Then C (sat 2: B1 D2, 2 free) -> 3 ... checked by hand up to here.
  const { graph } = byId('trap');
  const run = Core.dsaturTrace(graph);
  assert.equal(summary(graph, run).split(' ').slice(0, 5).join(' '), 'B1 A2 G3 D2 C3');
});

test('dist/index.html is up to date with src/', () => {
  assert.equal(fs.readFileSync(out, 'utf8'), bundle(), 'run `npm run build`');
});
