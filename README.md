# Map coloring, step by step

An interactive, self-contained web page for people who have heard of the Four Color
Theorem but have little background in graph theory. It shows how different algorithms
choose colors for a map, what happens when a coloring attempt gets stuck, and what the
computation looks like as a whole.

**Open `dist/index.html` in any browser.** It is one file with no dependencies and no
network access.

Proposal and course material: [`ref/`](ref/).

## What it does

- **Color it yourself.** Paint a map with four colors.
  - Borders where both sides have the same color are marked.
  - Hovering a region lists its neighbors, and the regions it touches only at a point
    (which are not neighbors).
  - "Colors left" shows, for every uncolored region, which colors are still possible.
- **Graph view.** Each region becomes a dot, and each pair of neighbors is joined by a
  line that crosses their shared border. Hovering highlights the region and its dot
  together.
- **Watch an algorithm.** Step through a run, play it, or scrub. Every step is explained in
  words and shown on the map. Seven algorithms:

| Algorithm | Idea | Can it get stuck? |
|---|---|---|
| Greedy | Fixed order; lowest free color | Yes |
| DSATUR | Next: the region whose neighbors show the most different colors | Yes, in principle |
| Peeling | Remove the region with the fewest neighbors left, repeat; color in reverse | Not with 6 colors (Euler) |
| Kempe chains | Greedy, but when stuck, swap two colors along a Kempe chain | Rarely (Heawood, 1890) |
| Backtracking | Greedy that goes back and changes earlier choices | No, but can take very long |
| Forward checking | Backtracking that crosses colors off neighbors' lists and undoes early; optionally "most constrained first" | No |
| Local search | Random coloring, then repair clashes one region at a time | It can wander; random steps help |

- **Under the hood.** Charts of the whole run; click any of them to jump to that step.
  - A timeline of every region's color at every step, for every algorithm.
  - A search tree that grows as backtracking explores and abandons branches.
  - Free colors at each decision, for greedy-type algorithms.
  - Neighbors left at each removal, for peeling, with Euler's bound of 5.
  - Clashing borders over time, for local search.

## Maps

Eight generated maps, from 6 to 62 regions:

| Map | What it shows |
|---|---|
| Four corners | Four regions meet at a single point; touching at a point does not make regions neighbors. |
| Five around one | An odd ring around a center: four colors are necessary. |
| Greedy trap | Alphabetical greedy gets stuck; backtracking and Kempe chains repair it. |
| Continent | 32 regions. Some orders get greedy stuck, and an unlucky order costs backtracking hundreds of backtracks. |
| Archipelago | Several islands, including a region that is an island of its own. |
| Ragged coast | Long, thin coastal regions around a crowded middle. |
| Isthmus | Two lands joined by a single region. |
| Patchwork | 62 small regions, where plain backtracking can run out of steps. |

`tools/generate-maps.mjs` builds them:

1. Poisson-disc points become Voronoi cells.
2. Noise decides which cells are land.
3. Regions grow from seeds across the land, at uneven speeds and with noisy costs.
4. Enclaves and slivers are merged away. For the "Four corners" effect, a short border is
   squeezed to a single point.
5. Every border between two faces (a region or the sea) is one shared arc: smoothed,
   roughened and simplified once, so both neighbors use exactly the same line.
6. Seeds are searched until each map shows the behavior its note describes.

The output, `src/maps-data.js` (about 120 KB), is committed. Regenerating needs the dev
dependency `d3-delaunay`:

```bash
npm install
```

```bash
npm run generate
```

## Structure

```
src/core.js         map geometry, neighbors from shapes, algorithm traces (no DOM; runs in Node)
src/checker.js      independent checker: uses the generator's neighbor list
src/maps-data.js    the generated maps (arcs, regions, recorded neighbors)
src/charts.js       canvas charts for "Under the hood"
src/ui.js           page logic
src/style.css       styles (light and dark)
src/index.html      page template
build.js            inlines everything into dist/index.html
tools/generate-maps.mjs   the map generator
tools/smoke.js      headless-browser smoke test and screenshots
test/               node:test suites
docs/ai-log.md      log of AI use, errors found and fixes (for the report)
```

## Checking

```bash
npm run build
```

```bash
npm test
```

The tests cover:

- **Map geometry.** Every region is a simple polygon, no two borders cross, regions do not
  overlap, and labels sit inside their regions.
- **Neighbors.** The neighbors found from the drawn shapes match the neighbors the
  generator recorded from its Voronoi cells, point contacts included.
- **Every step of every run.** Runs cover every map, three fixed orders and six random
  orders. Each step is re-checked against the generator's neighbor list:
  - no clash ever appears, except in local search, where the clash count is recomputed
    at each step;
  - the listed free colors are right, and the lowest one is taken;
  - "stuck" really means stuck;
  - a Kempe chain is a closed two-colored group, and swapping it frees the promised color;
  - forward checking's lists are exactly the colors still allowed;
  - every finished coloring is complete and proper.
- **Selection rules.** Each algorithm's choice follows its rule: DSATUR's, "most
  constrained first", peeling's fewest-neighbors rule, and Euler's bound of 5.
- **Claims made on the page.** "Five around one" is not 3-colorable (brute force), and the
  behaviors promised in the map notes really happen.
- **Hand-traced runs.** Small runs traced by hand are compared step by step.
- **Build.** `dist/index.html` must match the sources.

The smoke test runs every algorithm on every map in Chromium and fails on any page error.
It needs Playwright:

```bash
node tools/smoke.js screenshots
```
