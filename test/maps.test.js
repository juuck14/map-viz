// Geometry of the prepared maps: shapes are valid, and the neighbors computed
// from the shapes match the neighbors read from the grid by the checker.
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

for (const { spec, map, graph } of built) {
  test(`${spec.id}: every region is a simple polygon`, () => {
    for (const r of map.regions) {
      const p = r.polygon;
      const n = p.length;
      for (let a = 0; a < n; a++) {
        for (let b = a + 2; b < n; b++) {
          if (a === 0 && b === n - 1) continue; // these two edges share a corner
          assert.ok(
            !segmentsCross(p[a], p[(a + 1) % n], p[b], p[(b + 1) % n]),
            `region ${r.id}: edges ${a} and ${b} cross`
          );
        }
      }
    }
  });

  test(`${spec.id}: regions do not overlap`, () => {
    const step = 7;
    for (const r of map.regions) {
      const xs = r.polygon.map((q) => q[0]);
      const ys = r.polygon.map((q) => q[1]);
      for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs); x += step) {
        for (let y = Math.min(...ys) + 0.5; y < Math.max(...ys); y += step) {
          if (!Core.pointInPolygon(x, y, r.polygon)) continue;
          for (const other of map.regions) {
            if (other === r) continue;
            assert.ok(!Core.pointInPolygon(x, y, other.polygon), `${r.id} and ${other.id} overlap at (${x}, ${y})`);
          }
        }
      }
    }
  });

  test(`${spec.id}: each label sits well inside its region`, () => {
    for (const r of map.regions) {
      const [x, y] = r.label;
      assert.ok(Core.pointInPolygon(x, y, r.polygon), `label of ${r.id} is outside`);
      assert.ok(Core.distToBoundary(x, y, r.polygon) >= 12, `label of ${r.id} is too close to the border`);
    }
  });

  test(`${spec.id}: neighbors from the shapes match neighbors from the grid`, () => {
    const fromShapes = [];
    graph.neighbors.forEach((list, i) =>
      list.forEach((j) => i < j && fromShapes.push(graph.ids[i] + graph.ids[j]))
    );
    assert.deepEqual(fromShapes.sort(), Checker.gridNeighbors(spec.grid).pairs);
  });

  test(`${spec.id}: corner-only contacts are not neighbors`, () => {
    const fromShapes = [];
    graph.pointContacts.forEach((list, i) =>
      list.forEach((j) => i < j && fromShapes.push(graph.ids[i] + graph.ids[j]))
    );
    assert.deepEqual(fromShapes.sort(), Checker.gridNeighbors(spec.grid).cornerOnly);
  });

  test(`${spec.id}: each graph edge crosses its own shared border`, () => {
    for (const [key, [mx, my]] of Object.entries(graph.crossing)) {
      const near = graph.borders[key].some(
        ([x1, y1, x2, y2]) => Core.distToBoundary(mx, my, [[x1, y1], [x2, y2]]) < 0.01
      );
      assert.ok(near, `crossing point of ${key} is not on the shared border`);
    }
  });
}

test('four corners: B-E and C-F touch only at a point, as the map note says', () => {
  const { graph } = byId('corners');
  const idx = (id) => graph.ids.indexOf(id);
  for (const [a, b] of [['B', 'E'], ['C', 'F']]) {
    assert.ok(!graph.neighbors[idx(a)].includes(idx(b)), `${a} and ${b} must not be neighbors`);
    assert.ok(graph.pointContacts[idx(a)].includes(idx(b)), `${a} and ${b} must touch at a point`);
  }
});

test('a region that touches itself at a corner is rejected', () => {
  assert.throws(() => Core.buildMap({ id: 'bad', grid: ['....', '.A..', '..A.', '....'] }), /touches itself/);
});

test('a region with a hole is rejected', () => {
  assert.throws(
    () => Core.buildMap({ id: 'hole', grid: ['.....', '.AAA.', '.ABA.', '.AAA.', '.....'] }),
    /not one piece without holes/
  );
});
