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
