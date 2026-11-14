# Four colors, one at a time

An interactive, self-contained web page for people who have heard of the Four Color
Theorem but have little background in graph theory. It does not just replay algorithms:
it draws *why* they succeed or fail.

**Open `dist/index.html` in any browser.** It is one file with no dependencies and no
network access.

Proposal and course material: [`ref/`](ref/).

## The idea

Every figure uses one visual language:

- An uncolored region stays **bare** while all four colors are open.
- Once a neighbor takes a color, the region is **striped** with the colors it can still take.
- When a region is colored, its color **flies across each border**, and each neighbor that
  loses the color drops that stripe.
- A region with no stripes left is **dead**: dark, hatched red, with arrows from the
  neighbors that block each color.

With this, the trap greedy walks into, DSATUR's rule, and the waste in backtracking are
visible on the map before any text explains them.

## What it shows

The page is a story in ten sections. Each has one figure for one mechanism.

| § | Section | What the figure shows |
|---|---|---|
| 1 | The rule | Paint a map. Clashing borders light up. A slider morphs the map into its graph: regions shrink into dots, and borders become edges. |
| 2 | Why three colors are not enough | Five around one with three colors. “Show why” draws the odd ring and the forced alternation. |
| 3 | Every choice takes options away | Paint with stripes and pulses on. Regions die, with blame arrows. |
| 4 | Greedy | Step through greedy and watch L lose its stripes. At the dead end, arrows show the step each blocking color was set. The timeline marks the steps where L was already dead. |
| 5 | Most cornered first | Greedy and DSATUR side by side on the same 32-region map. Greedy dies; DSATUR finishes. |
| 6 | Backtracking | The map and a growing search tree, in sync. Branches grown while some region was already dead are red. Click a branch to jump there. |
| 7 | Most of the search was wasted | Three searches race on one map, with trees drawn at the same scale: plain backtracking (9,254 tries, 9,177 wasted), forward checking (77), and most-cornered-first forward checking (30). |
| 8 | Kempe's trick | At greedy's dead end, pick a neighbor and a second color. Its Kempe chain lights up. Swap it, and see whether a color is freed and why. |
| 9 | Peel the map | Remove the region with the fewest neighbors, again and again, then rebuild. This is the idea behind the six- and five-color proofs. |
| 10 | Playground | Seven methods on eight maps, with orders, the search tree, and step explanations. |

Section 7 rests on a fact the tests check node for node: forward checking's search tree
is exactly backtracking's tree with every branch below a doomed choice removed.

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
src/core.js         map geometry, neighbors from shapes, algorithm traces, options/dead/waste analysis (no DOM; runs in Node)
src/checker.js      independent checker: uses the generator's neighbor list
src/maps-data.js    the generated maps (arcs, regions, recorded neighbors)
src/view-map.js     MapView: SVG map with stripes, pulses, arrows, chains, map-to-graph morph
src/view-tree.js    TreeView: canvas search tree, with wasted branches in red
src/player.js       step player with a timeline strip of the whole run
src/page.js         the ten sections, wired from the pieces above
src/style.css       styles (light and dark)
src/index.html      page text and template
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
- **What the page claims.** Option sets and dead regions match the checker's neighbors.
  Forward checking's tree equals backtracking's tree minus the wasted branches, node for
  node, on 63 runs. Each section's example does what its text says: L dies two steps
  after it is doomed, greedy fails and DSATUR finishes on Continent, more than 95% of the
  §7 backtracking run is wasted, and the Kempe chains in §8 succeed or fail for the
  stated reasons.
- **Build.** `dist/index.html` must match the sources.

The smoke test drives every figure in light mode, dark mode and at phone width. It runs
every method on every map in the playground and fails on any page error.
It needs Playwright:

```bash
node tools/smoke.js screenshots
```
