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

## 2026-11-14 — session 3: rebuilt around what the computation looks like

**Prompt (summary).** The page is poor overall, not just in a few places. You can't learn
anything from it. A visualization should show the inner mechanism so that it clicks at
a glance. Think it over and rebuild it almost from scratch.

**Diagnosis (by the AI, from screenshots of the old page).**

- It was a control panel: 8 maps × 7 algorithms × toggles, with no story. The reader had
  to know what to look for.
- The mechanism was in the text, not in the picture. For example, "Stuck at L" was a
  paragraph, and the map only showed L in beige.
- The "Under the hood" charts (a timeline per region, a bar chart of free colors) were
  generic and answered no question.

**What changed.**

- **One visual language for "what is still possible".**
  - A region stays bare while all four colors are open.
  - It is striped with its remaining colors once constrained.
  - It is dark with red hatching when dead.
  - Coloring a region sends its color across each border as a pulse, and the neighbor
    loses that stripe when the pulse arrives.
  - The constraint front, forced regions, and dead regions are visible across the whole
    map at once.
- **A story in ten sections**, each with one figure for one mechanism. The sections are
  listed in the README.
- **The search tree as the central picture.**
  - Branches grown while some region was already dead are red ("wasted").
  - Measured first: forward checking's tree is exactly backtracking's tree minus every
    branch below a doomed node. It was checked node for node on 63 runs, so the page can
    say "forward checking cuts every red branch at its root".
  - Section 7 races three searches with trees at the same scale: 9,254 tries (99% wasted),
    then 77, then 30.
- **Kempe chains by hand.** The reader picks the neighbor and the color pair, and sees
  whether the chain wraps around L.
- **Map to graph is a morph.** Each region shrinks into its dot, and its edges straighten.
- **Palette.** A new, brighter four-color set, checked with an OKLab/CVD script. The
  minimum ΔE is 23 for normal vision and at least 11.5 under protanopia, deuteranopia
  and tritanopia.
- **New code.** `view-map.js`, `view-tree.js`, `player.js` and `page.js` replace `ui.js`
  and `charts.js`. `core.js` gained `optionMasks`, `deadRegions` and `searchWaste`.

**Errors and wrong turns found in AI-generated work, and fixes.**

1. **Four-color stripes everywhere** made the first build look like candy and hid the
   information. Showing all-open regions bare fixed it, and made the constraint front
   visible. Found on the first screenshots.
2. **Hover dimming** turned non-neighbors grey. Because Playwright's mouse stays where it
   last clicked, every later screenshot showed random grey regions. Hover now draws
   outlines instead.
3. **Shrunk regions poked out from behind their dots** in graph view. The scale used the
   inscribed radius, not the farthest corner.
4. **The player called its step handler before the run existed.** The first frame crashed
   in two figures, and the timeline was redrawn with the old run's length when the
   method changed. Both were found by the smoke test.
5. **Playback speed leaked between figures.** Setting one player to "very fast" switched
   off the animations in all the others, because the effect speed was global. Each step
   now restores it.
6. **The peel list called `scrollIntoView`,** which would have scrolled the whole page
   during playback. It now scrolls only inside the list.
7. **Two planted bugs in `searchWaste` went uncaught**, and both turned out to be
   equivalent. Once a region is dead it stays dead in every descendant, so "inherit the
   wasted flag" and "a dead leaf counts as doomed" change nothing. Two real mutations
   were caught by 5 tests each: judging doom from the state before the choice, and
   counting a doomed node as wasted itself.
8. **Section 7's text** first said all three searches "start from the same order". The
   most-cornered-first search picks its own order.

**Verification.** 207 tests pass. The smoke test drives every figure in light mode, dark
mode and at 390 px, and runs all 7 methods on all 8 maps, with no page errors.

**Still to do by a human.**

- [ ] Watch someone from the target audience go through §3–§7. Do the stripes read as
      "still possible" without the legend?
- [ ] Re-trace the golden examples by hand (carried over).
