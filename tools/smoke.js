// Opens dist/index.html in Chromium, runs every algorithm on every map, fails
// on any page error, and saves screenshots to the folder given as argv[2].
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const outDir = process.argv[2] || path.join(__dirname, '..', 'screenshots');
const pageUrl = 'file://' + path.join(__dirname, '..', 'dist', 'index.html');
const ALGOS = ['greedy', 'dsatur', 'peeling', 'kempe', 'backtrack', 'forward', 'local'];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const shoot = async (page, name) => {
    await page.waitForTimeout(350); // let fill and switch transitions finish
    await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: true });
  };

  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: scheme });
    page.on('pageerror', (e) => errors.push(`${scheme}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${scheme}: ${m.text()}`));
    await page.goto(pageUrl);
    const region = (i) => page.locator(`path.region[data-i="${i}"]`);
    const mapTab = (title) => page.locator('#map-tabs button', { hasText: title });
    const algo = (key) => page.locator(`#algo-tabs button[data-algo="${key}"]`);

    // Manual coloring with a conflict, hovering a region that touches others at a point.
    await region(0).dispatchEvent('click');
    await region(1).dispatchEvent('click');
    await page.locator('.brush[data-brush="2"]').click();
    await region(2).dispatchEvent('click');
    await region(1).hover({ force: true });
    await shoot(page, `${scheme}-manual`);
    if (scheme === 'dark') {
      await page.locator('#mode-tabs button[data-mode="algo"]').click();
      await mapTab('Continent').click();
      await algo('forward').click();
      for (let k = 0; k < 12; k++) await page.locator('#step-fwd').click();
      await shoot(page, `${scheme}-forward`);
      await page.close();
      continue;
    }

    // Every algorithm on every map, run to the end.
    await page.locator('#mode-tabs button[data-mode="algo"]').click();
    const maps = await page.locator('#map-tabs button').count();
    for (let m = 0; m < maps; m++) {
      await page.locator('#map-tabs button').nth(m).click();
      for (const key of ALGOS) {
        await algo(key).click();
        await page.locator('#to-end').click();
        const text = await page.locator('#explain h3').textContent();
        if (!/Done|Stuck|Stopped/.test(text)) errors.push(`map ${m}, ${key}: last step says "${text}"`);
      }
    }

    await mapTab('Greedy trap').click();
    await algo('greedy').click();
    await page.locator('#to-end').click();
    await shoot(page, `${scheme}-greedy-stuck`);

    await algo('kempe').click();
    const steps = await page.evaluate(() => Number(document.getElementById('scrub').max));
    for (let s = 0; s <= steps; s++) {
      await page.locator('#scrub').fill(String(s));
      if (/Kempe chain/.test(await page.locator('#explain h3').textContent())) break;
    }
    await shoot(page, `${scheme}-kempe-chain`);

    await mapTab('Continent').click();
    await algo('backtrack').click();
    await page.locator('#order-select').selectOption('random');
    await page.locator('#scrub').fill('120');
    await page.locator('.switch', { hasText: 'Graph' }).click();
    await shoot(page, `${scheme}-backtrack-tree`);
    await page.locator('.switch', { hasText: 'Graph' }).click();

    await mapTab('Patchwork').click();
    await algo('local').click();
    await page.locator('#scrub').fill('30');
    await shoot(page, `${scheme}-local`);

    await mapTab('Archipelago').click();
    await algo('peeling').click();
    await page.locator('#scrub').fill('20');
    await shoot(page, `${scheme}-peeling`);

    // Pick your own order by clicking every region.
    await mapTab('Five around one').click();
    await algo('greedy').click();
    await page.locator('#order-select').selectOption('custom');
    const n = await page.locator('path.region').count();
    for (let i = n - 1; i >= 0; i--) await region(i).dispatchEvent('click');
    const count = await page.locator('#step-count').textContent();
    if (!/^Step 0 of \d+$/.test(count)) errors.push(`after picking an order: "${count}"`);

    await page.setViewportSize({ width: 390, height: 900 });
    await mapTab('Isthmus').click();
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
