// Small runs traced by hand from the neighbor lists, step by step, and written
// down before running the code. If the code ever disagrees, either the code or
// the trace is wrong.
//
// Neighbor lists (from the generator's record):
//   corners  A:BE  B:ACF  C:BDF  D:CFG  E:AFG  F:BCDEG  G:DEF  (A-F, B-E touch at a point)
//   ring     A:BDE  B:ACE  C:BEF  D:AEF  E:ABCDF  F:CDE
//   trap     A:BDF  B:ACFG  C:BGH  D:AEF  E:DFJ  F:ABDEGJL  G:BCFHIL  H:CGI  I:GHL
//            J:EFKL  K:JL  L:FGIJK
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { Core, byId } = require('./helpers.js');
const { bundle, out } = require('../build.js');

// "A1" = region A gets color 1; "L!" = no color left at L; "-K" = undo K;
// "B^2" = peel B with 2 neighbors left; "J:2-4" = swap colors 2 and 4 in the
// Kempe chain containing J.
function summary(graph, run) {
  return run.steps
    .map((s) => {
      const id = graph.ids[s.v];
      if (s.kind === 'assign') return id + s.color;
      if (s.kind === 'stuck' || s.kind === 'deadend') return id + '!';
      if (s.kind === 'undo') return '-' + id;
      if (s.kind === 'peel') return `${id}^${s.degree}`;
      if (s.kind === 'swap') return `${s.chain.map((u) => graph.ids[u]).join('')}:${s.a}-${s.b}`;
      return null;
    })
    .filter((x) => x)
    .join(' ');
}

function alphabetical(id) {
  const { map, graph } = byId(id);
  return { graph, order: Core.ORDERS.alphabetical.make(map, graph) };
}

test('four corners, greedy, alphabetical', () => {
  // F sees B2 C1 D2 E2 and takes 3; G sees D2 E2 F3 and takes 1.
  const { graph, order } = alphabetical('corners');
  assert.equal(summary(graph, Core.greedyTrace(graph, order)), 'A1 B2 C1 D2 E2 F3 G1');
});

test('four corners, peeling', () => {
  // Fewest neighbors left, ties to the earlier letter: A(2) B(2) C(2) D(2) E(2) F(1) G(0).
  // Back in reverse: G1, F2 (G1), E3 (F2 G1), D3 (F2 G1), C1 (D3 F2), B3 (C1 F2), A1 (B3 E3).
  const { graph } = byId('corners');
  assert.equal(
    summary(graph, Core.smallestLastTrace(graph)),
    'A^2 B^2 C^2 D^2 E^2 F^1 G^0 G1 F2 E3 D3 C1 B3 A1'
  );
});

test('five around one, greedy, alphabetical', () => {
  // The ring is A-B-C-F-D-A around E. A1, B2 (A1), C1 (B2), D2 (A1); the center E sees
  // 1 and 2 -> 3; F sees C1 D2 E3 -> 4.
  const { graph, order } = alphabetical('ring');
  assert.equal(summary(graph, Core.greedyTrace(graph, order)), 'A1 B2 C1 D2 E3 F4');
});

test('five around one, DSATUR', () => {
  // E has the most neighbors -> 1. Then all saturations are 1 and all have 2 uncolored
  // neighbors -> A gets 2. B and D tie (saturation 2, 1 free) -> B gets 3. C and D tie
  // (saturation 2, 1 free) -> C gets 2. D (E1 A2) -> 3. F (E1 C2 D3) -> 4.
  const { graph } = byId('ring');
  assert.equal(summary(graph, Core.dsaturTrace(graph)), 'E1 A2 B3 C2 D3 F4');
});

test('greedy trap, greedy, alphabetical: stuck at L', () => {
  // L's neighbors end up with F3 G4 I1 J2 K1: all four colors.
  const { graph, order } = alphabetical('trap');
  assert.equal(summary(graph, Core.greedyTrace(graph, order)), 'A1 B2 C1 D2 E1 F3 G4 H2 I1 J2 K1 L!');
});

test('greedy trap, backtracking, alphabetical', () => {
  // L stuck: K tries 3, then 4 (L still stuck each time), then has nothing left;
  // go back to J, which takes 4. Then K1 and L2.
  const { graph, order } = alphabetical('trap');
  assert.equal(
    summary(graph, Core.backtrackTrace(graph, order)),
    'A1 B2 C1 D2 E1 F3 G4 H2 I1 J2 K1 L! -K K3 L! -K K4 L! -K K! -J J4 K1 L2'
  );
});

test('greedy trap, Kempe chains, alphabetical', () => {
  // At L, the 2-4 chain through J is J alone (J touches no 4), and G (the 4 next to L)
  // is not in it. Swapping makes J 4 and frees 2 for L.
  const { graph, order } = alphabetical('trap');
  assert.equal(
    summary(graph, Core.kempeTrace(graph, order)),
    'A1 B2 C1 D2 E1 F3 G4 H2 I1 J2 K1 J:2-4 L2'
  );
});

test('dist/index.html is up to date with src/', () => {
  assert.equal(fs.readFileSync(out, 'utf8'), bundle(), 'run `npm run build`');
});
