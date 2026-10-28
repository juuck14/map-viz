# Map coloring, step by step

An interactive, self-contained web page for people who have heard of the Four Color
Theorem but have little background in graph theory. It shows how different algorithms
choose colors for a map, and what happens when a coloring attempt gets stuck.

**Open `dist/index.html` in any browser.** It is one file with no dependencies and
no network access.

Proposal and course material: [`ref/`](ref/).

## What it does

- **Color it yourself.** Paint the prepared maps with four colors. Borders where both
  sides have the same color are marked. Hovering a region lists its neighbors and the
  regions it touches only at a point (which are not neighbors).
- **Show as graph.** Each region becomes a dot, and each pair of neighbors is joined by a
  line that crosses their shared border. Hovering a region or a dot highlights both.
- **Watch an algorithm.** Step through, play, or scrub through:
  - **Greedy**: a fixed order (alphabetical, left to right, most neighbors first,
    random, or your own picked by clicking); each region takes the lowest free color.
  - **DSATUR**: always colors the region whose neighbors show the most different colors.
  - **Backtracking**: greedy that goes back and changes earlier choices at a dead end.

  When a run gets stuck, the page outlines the neighbors that block every color and labels
  the step at which each of them got its color.

## Maps

| Map | Regions | What it shows |
|---|---|---|
| Four corners | 6 | Regions touching at a point are not neighbors. Alphabetical greedy uses 4 colors where 3 suffice. |
| Five around one | 6 | An odd ring around a center: four colors are necessary. |
| Greedy trap | 10 | Alphabetical greedy gets stuck at G; backtracking repairs it with 2 backtracks. |
| Continent | 15 | Some orders get stuck and others do not; an unlucky order costs backtracking hundreds of backtracks. |

Maps are drawn as letter grids in `src/maps.js` (one letter per region, `.` for sea).
`src/core.js` jitters the grid corners and smooths the borders so that the map looks hand
drawn, while neighboring regions still share exactly the same border points.

## Structure

```
src/core.js      geometry, neighbors from shapes, algorithm traces (no DOM; runs in Node too)
src/checker.js   independent checker: neighbors read straight from the grid
src/maps.js      the prepared maps
src/ui.js        page logic
src/style.css    styles (light and dark)
src/index.html   page template
build.js         inlines everything into dist/index.html
test/            node:test suites
tools/smoke.js   headless-browser smoke test and screenshots
docs/ai-log.md   log of AI use, errors found and fixes (for the report)
```

## Checking

```bash
npm run build
```

```bash
npm test
```

The tests cover:

- **Map geometry.** Every region is a simple polygon, regions do not overlap, and labels
  sit well inside their regions.
- **Neighbors.** The neighbors computed from the shapes match the neighbors the checker
  reads from the grid. Regions that meet only at a corner are not neighbors.
- **Every algorithm step.** Each step of every run (all maps, all order presets, 12 random
  orders) is re-checked against the checker's neighbors:
  - no conflict at any step;
  - the listed available colors are correct, and the lowest one is taken;
  - a "stuck" step really has no color left;
  - every finished coloring is complete and proper.
- **DSATUR's choices.** Each choice follows its rule: highest saturation, then most
  uncolored neighbors, then the earlier letter.
- **Claims made on the page.** Brute force confirms that "Five around one" is not
  3-colorable. The trap and continent behaviors described in the map notes are checked
  directly.
- **Hand-traced runs.** Small runs traced by hand are compared step by step.
- **Build.** `dist/index.html` must match the sources.

The smoke test clicks through the page in Chromium and fails on any page error. It needs
Playwright:

```bash
node tools/smoke.js screenshots
```
