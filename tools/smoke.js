// Opens dist/index.html in Chromium, clicks through the main states, fails on
// any page error, and saves screenshots to the folder given as argv[2].
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const outDir = process.argv[2] || path.join(__dirname, '..', 'screenshots');
const pageUrl = 'file://' + path.join(__dirname, '..', 'dist', 'index.html');

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const shoot = async (page, name) => {
    await page.waitForTimeout(400); // let fill and switch transitions finish
    await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: true });
  };

  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    page.on('pageerror', (e) => errors.push(`${scheme}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${scheme}: ${m.text()}`));
    await page.goto(pageUrl);

    // Manual coloring with a conflict on the first map.
    const region = (i) => page.locator(`path.region[data-i="${i}"]`);
    await region(0).click();
    await region(1).click();
    await page.locator('.brush[data-brush="2"]').click();
    await region(2).click();
    await page.locator('.brush[data-brush="1"]').click();
    await region(4).click(); // E: shares color 1 with C -> conflict
    await region(1).hover();
    await shoot(page, `${scheme}-manual`);
    if (scheme === 'dark') { await page.close(); continue; }

    // Graph view.
    await page.locator('.switch').click();
    await shoot(page, `${scheme}-graph`);
    await page.locator('.switch').click();

    // Greedy gets stuck on the trap map.
    await page.locator('#map-tabs button', { hasText: 'Greedy trap' }).click();
    await page.locator('#mode-tabs button[data-mode="algo"]').click();
    await page.locator('#to-end').click();
    await page.mouse.move(0, 0);
    await shoot(page, `${scheme}-greedy-stuck`);

    // Backtracking on the same order, stopped at the first dead end.
    await page.locator('#algo-tabs button[data-algo="backtrack"]').click();
    for (let k = 0; k < 7; k++) await page.locator('#step-fwd').click();
    await shoot(page, `${scheme}-backtrack-deadend`);
    await page.locator('#to-end').click();
    await shoot(page, `${scheme}-backtrack-done`);

    // DSATUR mid-run with the graph on.
    await page.locator('#algo-tabs button[data-algo="dsatur"]').click();
    await page.locator('.switch').click();
    for (let k = 0; k < 4; k++) await page.locator('#step-fwd').click();
    await shoot(page, `${scheme}-dsatur`);

    // Pick your own order on the continent map, then a long backtracking run.
    await page.locator('#map-tabs button', { hasText: 'Continent' }).click();
    await page.locator('#algo-tabs button[data-algo="greedy"]').click();
    await page.locator('#order-select').selectOption('custom');
    const n = await page.locator('path.region').count();
    for (let i = n - 1; i >= 0; i--) {
      // Dispatch on the element itself: the center of a non-convex region's
      // bounding box can lie in a different region.
      await page.locator(`path.region[data-i="${i}"]`).dispatchEvent('click');
      if (i === 8) await shoot(page, `${scheme}-picking`);
    }
    const count = await page.locator('#step-count').textContent();
    if (!/^Step 0 of \d+$/.test(count)) errors.push(`after picking an order: "${count}"`);
    await page.locator('#order-select').selectOption('random');
    await page.locator('#algo-tabs button[data-algo="backtrack"]').click();
    await page.locator('#to-end').click();
    await shoot(page, `${scheme}-continent-backtrack`);

    // Narrow screen.
    await page.setViewportSize({ width: 390, height: 900 });
    await shoot(page, `${scheme}-mobile`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) errors.push('horizontal overflow at 390px');
    await page.close();
  }
  await browser.close();
  if (errors.length) {
    console.error('Smoke test found problems:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('Smoke test passed; screenshots in ' + outDir);
})();
