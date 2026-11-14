// Opens dist/index.html in Chromium, drives every figure (and every method on
// every map in the playground), fails on any page error, and saves screenshots
// to the folder given as argv[2].
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const outDir = process.argv[2] || path.join(__dirname, '..', 'screenshots');
const pageUrl = 'file://' + path.join(__dirname, '..', 'dist', 'index.html');

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];

  for (const [scheme, width] of [['light', 1360], ['dark', 1360], ['light', 390]]) {
    const tag = `${scheme}-${width}`;
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message} ${(e.stack || '').split('\n').slice(1, 4).join(' <')}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${tag}: ${m.text()}`));
    await page.goto(pageUrl);
    await page.waitForTimeout(600);
    const region = (fig, i) => page.locator(`#${fig} path.region[data-i="${i}"]`);
    const shoot = async (sel, name) => {
      await page.mouse.move(0, 0);
      const el = await page.$(sel);
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await el.screenshot({ path: path.join(outDir, `${tag}-${name}.png`) });
    };
    const text = (sel) => page.locator(sel).innerText();
    const expect = (cond, msg) => cond || errors.push(`${tag}: ${msg}`);

    await page.screenshot({ path: path.join(outDir, `${tag}-hero.png`) });

    // 1: paint a clash, morph to the graph.
    await region('f1-map', 0).click({ force: true });
    await region('f1-map', 1).click({ force: true });
    expect(/1\s*clash/.test(await text('#f1-readout')), 'section 1: a clash is reported');
    await page.locator('#f1-morph').fill('1000');
    await shoot('#rules', 's1-graph');
    await page.locator('#f1-morph').fill('0');

    // 2: the odd ring.
    await page.locator('#f2-why').click();
    await page.waitForTimeout(1200);
    expect(/odd/.test(await text('#f2-readout')), 'section 2: explanation shown');
    await shoot('#three', 's2-why');

    // 3: paint until something dies.
    const paint = [[0, 1], [1, 2], [2, 1], [5, 3], [6, 4], [8, 1], [9, 2], [10, 1]];
    for (const [i, c] of paint) {
      await page.locator('#f3-brushes .brush').nth(c - 1).click();
      await region('f3-map', i).click({ force: true });
    }
    await page.waitForTimeout(700);
    expect(/is dead/.test(await text('#f3-readout')), 'section 3: dead region reported');
    await shoot('#options', 's3-dead');

    // 4: every order, run to the end.
    for (const key of ['alphabetical', 'leftToRight', 'mostNeighbors', 'random']) {
      await page.locator('#f4-order-sel').selectOption(key);
      await page.locator('#f4-player .pbtn-last').click();
      expect(/Stuck|Done/.test(await text('#f4-readout')), `section 4 (${key}): run ends in Stuck or Done`);
    }
    await page.locator('#f4-order-sel').selectOption('alphabetical');
    await page.locator('#f4-player .pbtn-last').click();
    await shoot('#greedy', 's4-stuck');

    // 5: race to the end.
    await page.locator('#f5-player .pbtn-last').click();
    expect(/Stuck/.test(await text('#f5-status-a')) && /Done/.test(await text('#f5-status-b')), 'section 5: greedy stuck, DSATUR done');
    await shoot('#dsatur', 's5-race');

    // 6: step into the run, then to the end.
    for (let k = 0; k < 70; k++) await page.locator('#f6-player .pbtn-fwd').click();
    await shoot('#backtrack', 's6-middle');
    await page.locator('#f6-player .pbtn-last').click();
    expect(/Done/.test(await text('#f6-readout')), 'section 6: backtracking finishes');

    // 7: run the three searches.
    await page.locator('#f7-run').click();
    await page.waitForTimeout(15000);
    expect((await page.locator('.trio-stat .ok').count()) === 3, 'section 7: all three searches finish');
    await shoot('#lookahead', 's7-trio');

    // 8: a working swap.
    await region('f8-map', 9).click({ force: true });
    await page.locator('#f8-tools .pair').nth(2).click();
    await page.locator('#f8-tools .btn-main').click();
    await page.waitForTimeout(1500);
    expect(/takes/.test(await text('#f8-readout')), 'section 8: L gets a color after the swap');
    await shoot('#kempe', 's8-swapped');

    // 9: peel and rebuild.
    await page.locator('#f9-player .pbtn-last').click();
    expect(/Done/.test(await text('#f9-readout')), 'section 9: rebuild finishes');

    // 10: every method on every map (desktop light only; it is slow).
    if (tag === 'light-1360') {
      const maps = await page.locator('#lab-maps .tab').count();
      const algos = await page.locator('#lab-algos .tab').count();
      for (let m = 0; m < maps; m++) {
        await page.locator('#lab-maps .tab').nth(m).click();
        for (let a = 0; a < algos; a++) {
          await page.locator('#lab-algos .tab').nth(a).click();
          await page.locator('#lab-player .pbtn-last').click();
          const t = await text('#lab-readout');
          if (!/Done|Stuck|Gave up/.test(t)) errors.push(`${tag}: playground map ${m} method ${a} ends with "${t.slice(0, 60)}"`);
        }
      }
      await page.locator('#lab-maps .tab').nth(7).click();
      await page.locator('#lab-algos .tab').nth(3).click();
      for (let k = 0; k < 40; k++) await page.locator('#lab-player .pbtn-fwd').click();
      await shoot('#lab', 's10-playground');
    }
    await page.close();
  }
  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`Smoke test passed; screenshots in ${outDir}`);
})();
