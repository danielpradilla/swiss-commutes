/* eslint-disable @typescript-eslint/no-unused-expressions -- Playwright evaluates this file as a function. */
async (browserPage, baseUrl = 'http://127.0.0.1:8873/swiss-commutes') => {
  const context = await browserPage.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.mapFrames = [];
    window.dotRadii = [];
    const prototype = CanvasRenderingContext2D.prototype;
    const clear = prototype.clearRect, arc = prototype.arc, fill = prototype.fill;
    prototype.clearRect = function (...args) {
      if (this.canvas.classList.contains('commuterOverlay')) { window.mapFrames.push(performance.now()); window.dotRadii = []; }
      return clear.apply(this, args);
    };
    prototype.arc = function (...args) { this.lastRadius = args[2]; return arc.apply(this, args); };
    prototype.fill = function (...args) {
      if (this.canvas.classList.contains('commuterOverlay') && ['#c2413f', '#2f5f7f'].includes(this.fillStyle)) window.dotRadii.push(this.lastRadius);
      return fill.apply(this, args);
    };
  });
  try {
    await page.goto(`${baseUrl}/geneva/`);
    await page.locator('.leaflet-container').waitFor();
    const time = page.getByRole('slider', { name: 'Time of day' });
    const size = page.locator('#dot-size');
    const speed = page.locator('#playback-speed');
    const pause = page.getByRole('button', { name: 'Pause the clock' });
    assert(await time.inputValue() === '465', 'Reduced motion must start paused');
    assert(await size.inputValue() === '2.7' && await speed.inputValue() === '30', 'Start with the larger dots and slower playback');
    await page.waitForFunction(() => window.dotRadii.includes(2.7) && window.dotRadii.includes(2.2));
    const previousCount = await page.evaluate(() => window.dotRadii.length);
    await page.getByRole('button', { name: 'Current: 1.40' }).click();
    await page.waitForFunction(() => window.dotRadii.includes(1.4) && window.dotRadii.includes(1.5) && window.dotRadii.includes(1.2));
    assert(await page.evaluate(() => window.dotRadii.length) === previousCount, 'Sizing must not change the commuter cohort');
    await page.getByRole('button', { name: 'Previous: 2.70' }).click();
    await page.waitForFunction(() => window.dotRadii.includes(2.7) && window.dotRadii.includes(2.2));
    await size.fill('2.35');
    await size.press('ArrowRight');
    assert(await size.getAttribute('aria-valuetext') === '2.40 pixels', 'Report an exact keyboard-adjustable size');
    assert((await page.locator('.statRail strong').allTextContents()).join('|') === '33’284|−5’313|+77’404', 'Counts must stay unchanged');

    const speeds = [];
    for (const value of [10, 50]) {
      await time.fill('465');
      await speed.fill(String(value));
      const read = () => page.evaluate(() => ({ time: Number(document.querySelector('.populationChartScrubber').value), now: performance.now() }));
      const start = await read();
      await page.waitForTimeout(1000);
      const end = await read();
      const rate = (end.time - start.time) * 1000 / (end.now - start.now);
      assert(Math.abs(rate - value) < 2, `Speed ${value} must use elapsed time: measured ${rate}`);
      speeds.push({ requested: value, measured: rate });
    }
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const hiddenTime = await time.inputValue();
    await page.waitForTimeout(300);
    assert(await time.inputValue() === hiddenTime, 'Hidden pages must not advance');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(100);
    assert(Number(await time.inputValue()) - Number(hiddenTime) < 10, 'Returning to the page must not catch up hidden time');
    await pause.click();
    const pausedTime = await time.inputValue();
    await page.waitForTimeout(100);
    assert(await time.inputValue() === pausedTime, 'Pause cancels animation');

    await time.fill('465');
    await page.getByRole('button', { name: 'Before: 71.4' }).click();
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.mapFrames = []; });
    await page.waitForTimeout(3000);
    const frames = await page.evaluate(() => {
      const f = window.mapFrames;
      const gaps = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
      return { frames: f.length, fps: (f.length - 1) * 1000 / (f.at(-1) - f[0]), medianGapMs: gaps[Math.floor(gaps.length / 2)], p95GapMs: gaps[Math.floor(gaps.length * .95)] };
    });
    await pause.click();
    await time.fill('465');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const mobile = await page.evaluate(() => ({ controlsBottom: document.querySelector('.animationTuning').getBoundingClientRect().bottom,
      timelineBottom: document.querySelector('.controls').getBoundingClientRect().bottom, width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert(mobile.timelineBottom <= 844 && mobile.width <= mobile.viewport, 'Mobile map and controls must fit');
    await time.fill('1439');
    await speed.fill('50');
    await page.waitForTimeout(100);
    assert(Number(await time.inputValue()) < 20, 'The clock wraps through midnight');
    await page.getByRole('combobox', { name: 'City', exact: true }).selectOption('basel');
    await page.waitForURL('**/basel/');
    await page.locator('.leaflet-container').waitFor();
    await page.waitForTimeout(200);
    assert(await time.inputValue() === '465', 'City navigation cancels the previous animation');
    assert(errors.length === 0, errors.join('\n'));
    return { presets: 'Exact previous and current radii verified on the canvas', speeds, frames, mobile, errors };
  } finally {
    await context.close();
  }
}
