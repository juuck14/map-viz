// Shared fixtures for the tests: every prepared map, built once.
const Core = require('../src/core.js');
const Checker = require('../src/checker.js');
const DATA = require('../src/maps-data.js');

const built = DATA.map((data) => {
  const map = Core.buildMap(data);
  return { data, map, graph: Core.buildGraph(map) };
});

const byId = (id) => built.find((b) => b.data.id === id);

// Colors array (indexed like graph.ids) -> { A: 1, ... } for the checker.
function asColoring(graph, colors) {
  const out = {};
  graph.ids.forEach((id, i) => (out[id] = colors[i]));
  return out;
}

// Neighbor lists from the generator's record (via the checker), not from core.js.
function checkerNeighborLists(data, graph) {
  const lists = graph.ids.map(() => []);
  for (const [a, b] of Checker.neighborPairs(data).pairs) {
    const i = graph.ids.indexOf(a);
    const j = graph.ids.indexOf(b);
    lists[i].push(j);
    lists[j].push(i);
  }
  return lists;
}

module.exports = { Core, Checker, DATA, built, byId, asColoring, checkerNeighborLists };
