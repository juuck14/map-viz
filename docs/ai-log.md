# AI use log

Notes for the final report (due Dec 10): prompt summary, structure of the AI interaction,
errors found in AI output and how they were fixed. Newest entries at the bottom.

## 2026-10-28 — session 1: plan and first demo build

**Tool:** Claude Code (cloud session) working in this repository.

**Prompts (summary, not verbatim).**

1. Move the four course files into `ref/`, read them, and think about how to proceed.
   The AI summarized the proposal, the syllabus, the lecture slides, and the TA notice.
   It proposed a plan: single-file HTML, algorithms recorded as step traces, maps with
   automatic neighbor detection, an independent checker, and this log.
2. "Go ahead." The AI built the Nov 1 demo scope: manual coloring, graph view, greedy and
   backtracking step by step. It also built DSATUR, which the proposal had planned for
   after the demo.

**Design decisions made in this session.**

- **Maps are authored as letter grids.**
  - Corners are jittered and borders smoothed with Chaikin's corner cutting. Each border
    chain between junctions is smoothed on its own, so both sides of a border stay
    identical.
  - Neighbors come from the polygons: borders must overlap along a segment of positive
    length.
  - The checker reads neighbors from the grid instead, so the two methods check each other.
- **Algorithms output full traces.** Each step stores a complete snapshot, so the page can
  step backwards for free.
- **Palette.** Four colors from the reference palette, chosen by running the dataviz
  palette validator on every 4-color subset.
  - All pairs are tested, not just adjacent ones, because any two colors can touch on a
    map.
  - Blue, yellow, pink and green is one of only two subsets that pass every check in both
    light and dark mode.
  - Numbers inside regions give a second cue besides color.

**Errors found in AI-generated work and how they were fixed.**

1. **Graph edges bulged outside the map** on "Greedy trap" (H–F, I–J). Each edge was one
   quadratic curve forced through the border midpoint, which overshoots. It was replaced
   by two cubic pieces (Catmull-Rom style). Found by looking at screenshots.
2. **Small map on phones.** The SVG framed the whole grid, including the sea margin. The
   frame was cropped to the land. Found on the 390 px screenshot.
3. **Badge widths were estimated** from the character count, which breaks when fonts grow
   on small screens. Widths are now measured from the rendered text.
4. **The first palette guess** (blue, orange, aqua, pink) failed the normal-vision
   separation check: orange vs pink had ΔE 12.9, below the floor of 15. It was replaced as
   described above.
5. **The test command** `node --test test/` fails on Node 22, because a directory is not
   accepted. It was replaced by a glob.
6. **A weak mutation check.** To make sure the tests can fail, bugs were planted in a copy
   of `core.js`. "Make the minimum shared length negative" was *not* caught. On inspection
   this was not a hole in the tests: point contacts are rejected by the collinearity test,
   not by the length threshold. A sharper mutation ("any shared corner makes two regions
   neighbors") was caught. Four other planted bugs were caught as well: greedy taking the
   highest color, backtracking forgetting tried colors, a wrong DSATUR tie-break, and
   ignoring one neighbor.

**Still to do by a human.**

- [ ] Re-trace the golden examples in `test/golden.test.js` **by hand on paper**. The
      proposal promises this, and so far only the AI has traced them.
- [ ] Try the page with one or two people from the target audience. Note where they get
      confused.
- [ ] Decide what to submit on Nov 1: the `dist/index.html` file, a link, or both.

## 2026-10-29 — session 2: generated maps, seven algorithms, process views

**Prompt (summary).** The maps should be far more complex and varied; the current maps are
ugly; can the computation itself be visualized; can more algorithms be added?

**What changed.**

- **Generated maps.**
  - The hand-drawn letter-grid maps were replaced by a generator (`tools/generate-maps.mjs`).
    It works from Voronoi cells of Poisson-disc points, with noise-based land and regions
    grown at uneven speeds.
  - There are eight maps, from 6 to 62 regions: one island, an archipelago, a ragged coast,
    two lands joined by an isthmus, and a dense patchwork.
  - The lesson maps are found by seed search. "Five around one" must form a wheel. The
    "Greedy trap" must get alphabetical greedy stuck and be repaired by backtracking.
- **New look.**
  - Atlas style: ocean gradient with shallow-water bands, land shadow, paper grain,
    smoothed shared borders (thin inside, stronger at the coast), and labels sized to
    each region.
  - The palette is a muted 4-color set chosen with the dataviz validator, separately for
    light and dark mode.
- **Seven algorithms:** Greedy, DSATUR, Peeling (smallest-last), Kempe chains (greedy with
  Kempe-chain repairs), Backtracking, Forward checking (fixed order or "most constrained
  first"), and Local search (min-conflicts).
- **"Under the hood".**
  - A timeline of every region's color at every step.
  - A growing search tree for the backtracking variants.
  - Free colors per decision, neighbors left per removal (with Euler's bound), and
    clashes over time.
  - On the map: Kempe chains, forward-checking eliminations, "colors left" squares,
    peeled-off regions, and markers where regions touch at a point.
- **Checker.** The checker now uses the neighbor list the generator records from the
  Voronoi cells, independent of the page's shape-based neighbor detection.

**Errors and wrong turns found in AI-generated work, and fixes.**

1. **Kempe chains never fired.** The first design was "peel, then color back with Kempe
   swaps when stuck". Measuring showed that on every map peeling never removes a region
   with more than 3 neighbors left. So coloring back never gets stuck, and the Kempe code
   never ran. It was redesigned as greedy in a chosen order with Kempe repairs. That
   design needs 1–6 swaps on the maps where greedy fails.
2. **Forward checking never backtracked.** With "most constrained first" it solved every
   map with zero backtracks, so its look-ahead was invisible. It now also accepts the
   fixed orders. With the same order as backtracking, it cuts thousands of backtracks to
   tens.
3. **No seed was accepted for "Four corners".** The acceptance rule expected one
   point-contact pair, but squeezing a border to a point always creates two: both
   diagonal pairs. The rule and the map note were fixed.
4. **Scalloped coastlines.** Smoothing Voronoi corners left a regular bump at every cell.
   Now each chain is relaxed toward its neighbors' midpoints first, and fractal detail is
   added afterwards.
5. **The face on the other side of a border was guessed** from the corner's face sets,
   which is ambiguous for one-edge borders. The tracer now records the face across every
   edge.
6. **Enclave cleanup could flood the sea.** When a region had an inner ring, the code
   merged everything on the other side of that ring into the region. If the other side
   was sea (−1), every sea cell would have joined it. Sea is now skipped, and such seeds
   are rejected.
7. **Dark palette.** Darkening the light palette made green and ochre indistinguishable
   for protanopia (ΔE 2.8). A grid search over OKLCH lightness, run through the
   validator, found a passing set (worst ΔE 10.0).
8. **Chart and overlay fixes.**
   - The peeling chart drew regions removed with 0 neighbors left in red, as if they
     were failures.
   - "Colors left" squares were shown on peeled-off regions.
   - The search tree's root sat at the top center instead of above the first choice.
   - All three were found on screenshots and fixed.

**Verification.**

- 184 tests pass.
- Six bugs were planted in a copy of `core.js`, and each was caught by 6 to 61 failing
  tests:
  - a Kempe swap that misses a region;
  - forward checking that forgets to restore lists;
  - local search that prefers worse moves;
  - peeling that removes the most connected region;
  - a wrong DSATUR tie-break;
  - point contacts counted as neighbors.
- The headless-browser smoke test runs all 7 algorithms on all 8 maps without errors.

**Still to do by a human.**

- [ ] Re-trace the new golden examples in `test/golden.test.js` by hand. The neighbor
      lists are at the top of that file. The AI traced them before running the code, and
      they matched, but the proposal promises human traces.
- [ ] Decide whether 8 maps and 7 algorithms is too much for a 4-minute demo. A possible
      route: "Four corners" (rules) → "Greedy trap" (Greedy → Kempe → Backtracking) →
      "Patchwork" (Backtracking vs Forward checking, search tree).
