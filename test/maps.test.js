// Geometry of the prepared maps: shapes are valid, borders do not cross, and
// the neighbors found from the shapes match the generator's own record.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, Checker, built, byId } = require('./helpers.js');

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

const bbox = (poly) => {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

for (const { data, map, graph } of built) {
  test(`${data.id}: every region is a simple polygon`, () => {
    for (const r of map.regions) {
      const p = r.polygon;
      const n = p.length;
      for (let a = 0; a < n; a++) {
        for (let b = a + 2; b < n; b++) {
          if (a === 0 && b === n - 1) continue; // these two edges share a corner
          assert.ok(!segmentsCross(p[a], p[(a + 1) % n], p[b], p[(b + 1) % n]), `region ${r.id}: edges ${a} and ${b} cross`);
        }
      }
    }
  });

  test(`${data.id}: no two borders cross`, () => {
    const segs = [];
    map.arcs.forEach((arc, k) => {
      for (let i = 1; i < arc.pts.length; i++) segs.push([arc.pts[i - 1], arc.pts[i], k]);
    });
    const boxes = segs.map(([a, b]) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
    for (let s = 0; s < segs.length; s++) {
      for (let t = s + 1; t < segs.length; t++) {
        const [A, B] = [boxes[s], boxes[t]];
        if (A[0] > B[2] || B[0] > A[2] || A[1] > B[3] || B[1] > A[3]) continue;
        assert.ok(!segmentsCross(segs[s][0], segs[s][1], segs[t][0], segs[t][1]), `arcs ${segs[s][2]} and ${segs[t][2]} cross`);
      }
    }
  });

  test(`${data.id}: regions do not overlap`, () => {
    const boxes = map.regions.map((r) => bbox(r.polygon));
    for (const [ri, r] of map.regions.entries()) {
      const [x0, y0, x1, y1] = boxes[ri];
      for (let x = x0 + 0.5; x < x1; x += 9) {
        for (let y = y0 + 0.5; y < y1; y += 9) {
          if (!Core.pointInPolygon(x, y, r.polygon)) continue;
          map.regions.forEach((other, oi) => {
            if (oi === ri) return;
            const [a, b, c, d] = boxes[oi];
            if (x < a || x > c || y < b || y > d) return;
            assert.ok(!Core.pointInPolygon(x, y, other.polygon), `${r.id} and ${other.id} overlap at (${x}, ${y})`);
          });
        }
      }
    }
  });

  test(`${data.id}: each label sits inside its region`, () => {
    for (const r of map.regions) {
      const [x, y] = r.label;
      assert.ok(Core.pointInPolygon(x, y, r.polygon), `label of ${r.id} is outside`);
      assert.ok(Core.distToBoundary(x, y, r.polygon) >= 8, `label of ${r.id} is too close to the border`);
    }
  });

  test(`${data.id}: neighbors from the shapes match the generator's record`, () => {
    const fromShapes = [];
    graph.neighbors.forEach((list, i) => list.forEach((j) => i < j && fromShapes.push(`${graph.ids[i]}|${graph.ids[j]}`)));
    const recorded = Checker.neighborPairs(data).pairs.map(([a, b]) => `${a}|${b}`);
    assert.deepEqual(fromShapes.sort(), recorded.sort());
  });

  test(`${data.id}: point contacts from the shapes match the generator's record`, () => {
    const fromShapes = [];
    graph.pointContacts.forEach((list, i) => list.forEach((j) => i < j && fromShapes.push(`${graph.ids[i]}|${graph.ids[j]}`)));
    const recorded = Checker.neighborPairs(data).pointOnly.map(([a, b]) => `${a}|${b}`);
    assert.deepEqual(fromShapes.sort(), recorded.sort());
  });

  test(`${data.id}: each border arc belongs to one or two regions`, () => {
    for (const arc of map.arcs) {
      assert.ok(arc.users.length === 1 || arc.users.length === 2, `arc used by ${arc.users.length} regions`);
      if (arc.users.length === 2) {
        const [i, j] = arc.users;
        assert.ok(graph.neighbors[i].includes(j), `${graph.ids[i]} and ${graph.ids[j]} share an arc but are not neighbors`);
      }
    }
  });

  test(`${data.id}: each graph edge crosses its own shared border`, () => {
    for (const [key, [mx, my]] of Object.entries(graph.crossing)) {
      const near = graph.borders[key].some(([x1, y1, x2, y2]) => Core.distToBoundary(mx, my, [[x1, y1], [x2, y2]]) < 0.1);
      assert.ok(near, `crossing point of ${key} is not on the shared border`);
    }
  });
}

test('four corners: the note names the two pairs that only touch at a point', () => {
  const { data, graph } = byId('corners');
  assert.equal(graph.contactPoints.length, 1, 'one point where four regions meet');
  assert.equal(graph.contactPoints[0].regions.length, 4);
  for (const [a, b] of Checker.neighborPairs(data).pointOnly) {
    assert.ok(data.note.includes(`${a} and ${b}`), `note should mention ${a} and ${b}`);
  }
});

test('isthmus: one region is the only link between the two halves', () => {
  const { graph } = byId('isthmus');
  const splits = graph.ids.some((_, cut) => {
    const start = cut === 0 ? 1 : 0;
    const seen = new Set([cut, start]);
    const stack = [start];
    while (stack.length) {
      for (const u of graph.neighbors[stack.pop()]) {
        if (seen.has(u)) continue;
        seen.add(u);
        stack.push(u);
      }
    }
    return seen.size < graph.n;
  });
  assert.ok(splits);
});

test('archipelago: at least one region is an island with no neighbors', () => {
  const { graph } = byId('archipelago');
  assert.ok(graph.neighbors.some((l) => l.length === 0));
});
