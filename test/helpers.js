// Shared fixtures for the tests: every prepared map, built once.
const Core = require('../src/core.js');
const Checker = require('../src/checker.js');
const SPECS = require('../src/maps.js');

const built = SPECS.map((spec) => {
  const map = Core.buildMap(spec);
  return { spec, map, graph: Core.buildGraph(map) };
});

const byId = (id) => built.find((b) => b.spec.id === id);

// Colors array (indexed like graph.ids) -> { A: 1, ... } for the checker.
function asColoring(graph, colors) {
  const out = {};
  graph.ids.forEach((id, i) => (out[id] = colors[i]));
  return out;
}

// Neighbor lists taken from the checker's grid reading, not from core.js.
function gridNeighborLists(spec, graph) {
  const lists = graph.ids.map(() => []);
  for (const pair of Checker.gridNeighbors(spec.grid).pairs) {
    const [a, b] = pair.split('').map((id) => graph.ids.indexOf(id));
    lists[a].push(b);
    lists[b].push(a);
  }
  return lists;
}

module.exports = { Core, Checker, SPECS, built, byId, asColoring, gridNeighborLists };
