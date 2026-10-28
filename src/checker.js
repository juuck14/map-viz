/*
 * Independent checker. It does not use core.js: it reads neighbors straight
 * from a map's letter grid (two regions are neighbors when two of their cells
 * share a side), so a bug in the polygon geometry or in an algorithm cannot
 * hide itself. Runs in the browser (window.MapChecker) and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapChecker = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEA = '.';

  function cellAt(grid, i, j) {
    if (i < 0 || i >= grid.length) return SEA;
    return grid[i][j] || SEA;
  }

  // Neighbor pairs from the grid, plus pairs that only meet diagonally
  // (at a corner point) and therefore are NOT neighbors.
  function gridNeighbors(grid) {
    const pairs = new Set();
    const diagonal = new Set();
    const key = (a, b) => (a < b ? a + b : b + a);
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < grid[i].length; j++) {
        const a = cellAt(grid, i, j);
        if (a === SEA) continue;
        for (const [di, dj] of [[0, 1], [1, 0]]) {
          const b = cellAt(grid, i + di, j + dj);
          if (b !== SEA && b !== a) pairs.add(key(a, b));
        }
        for (const [di, dj] of [[1, 1], [1, -1]]) {
          const b = cellAt(grid, i + di, j + dj);
          if (b !== SEA && b !== a) diagonal.add(key(a, b));
        }
      }
    }
    for (const p of pairs) diagonal.delete(p);
    return { pairs: [...pairs].sort(), cornerOnly: [...diagonal].sort() };
  }

  // coloring: { A: 1, B: 3, ... } with 0 or missing meaning "not colored yet".
  function checkColoring(grid, coloring, numColors = 4) {
    const regions = new Set();
    for (const row of grid) for (const ch of row) if (ch !== SEA) regions.add(ch);
    const badValues = [];
    const uncolored = [];
    for (const r of [...regions].sort()) {
      const c = coloring[r] || 0;
      if (c === 0) uncolored.push(r);
      else if (!Number.isInteger(c) || c < 1 || c > numColors) badValues.push(r);
    }
    const conflicts = [];
    for (const p of gridNeighbors(grid).pairs) {
      const [a, b] = p.split('');
      if (coloring[a] && coloring[a] === coloring[b]) conflicts.push([a, b, coloring[a]]);
    }
    const proper = conflicts.length === 0 && badValues.length === 0;
    const used = new Set([...regions].map((r) => coloring[r]).filter((c) => c)).size;
    return { proper, complete: proper && uncolored.length === 0, conflicts, uncolored, badValues, used };
  }

  return { gridNeighbors, checkColoring };
});
