/*
 * Independent checker. It does not use core.js. Neighbors come from the list
 * the map generator wrote down from the Voronoi cells it built the map from,
 * not from the drawn borders, so a bug in the page's own neighbor detection
 * or in an algorithm cannot hide itself. Runs in the browser
 * (window.MapChecker) and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapChecker = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [['A', 'B'], ...] and the pairs that only touch at a point.
  function neighborPairs(data) {
    const id = (i) => data.regions[i].id;
    return {
      pairs: data.pairs.map(([a, b]) => [id(a), id(b)]),
      pointOnly: (data.pointContacts || []).map(([a, b]) => [id(a), id(b)]),
    };
  }

  // coloring: { A: 1, B: 3, ... }; 0 or missing means "not colored yet".
  function checkColoring(data, coloring, numColors = 4) {
    const ids = data.regions.map((r) => r.id);
    const badValues = [];
    const uncolored = [];
    for (const r of ids) {
      const c = coloring[r] || 0;
      if (c === 0) uncolored.push(r);
      else if (!Number.isInteger(c) || c < 1 || c > numColors) badValues.push(r);
    }
    const conflicts = [];
    for (const [a, b] of neighborPairs(data).pairs) {
      if (coloring[a] && coloring[a] === coloring[b]) conflicts.push([a, b, coloring[a]]);
    }
    const proper = conflicts.length === 0 && badValues.length === 0;
    const used = new Set(ids.map((r) => coloring[r]).filter((c) => c)).size;
    return { proper, complete: proper && uncolored.length === 0, conflicts, uncolored, badValues, used };
  }

  return { neighborPairs, checkColoring };
});
