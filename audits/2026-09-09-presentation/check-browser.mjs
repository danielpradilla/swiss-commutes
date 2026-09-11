/* eslint-disable @typescript-eslint/no-unused-expressions -- Playwright evaluates this file as a function. */
// Run with the existing Playwright browser tool; see README.md in this directory.
async (browserPage, baseUrl = 'http://127.0.0.1:8873/swiss-commutes') => {
  const browser = browserPage.context().browser();
  const assert = (condition, message = 'Browser check failed') => { if (!condition) throw new Error(message); };
  const results = [];
  const context = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const slider = page.getByRole('slider', { name: 'Time of day' });
  const pause = page.getByRole('button', { name: 'Pause the clock' });
  const fast = page.getByRole('button', { name: 'Fast-forward through the day' });
  let release;
  let gate = new Promise(resolve => { release = resolve; });
  await page.route('**/routes.json?*', async route => { await gate; await route.continue(); });
  try {
    await page.goto(`${baseUrl}/geneva/`);
    await pause.waitFor();
    await page.waitForTimeout(200);
    assert(await slider.inputValue() === '465', 'Morning must not advance while geometry is loading');
    release();
    await page.waitForFunction(() => Number(document.querySelector('.populationChartScrubber')?.value) > 465);
    assert(await fast.getAttribute('aria-pressed') === 'true', 'Autoplay starts after the map is ready');
    assert(await page.locator('.animationTuning, #dot-size, #playback-speed').count() === 0, 'Temporary controls are removed');
    const readClock = () => page.evaluate(() => ({ time: Number(document.querySelector('.populationChartScrubber').value), now: performance.now() }));
    const start = await readClock();
    await page.waitForTimeout(1000);
    const end = await readClock();
    const rate = (end.time - start.time) * 1000 / (end.now - start.now);
    assert(Math.abs(rate - 15) < 1, `Selected playback rate is 15 simulated minutes per second; measured ${rate}`);
    results.push({ simulatedMinutesPerSecond: rate, temporaryControls: 'removed' });
    await pause.click();
    const pausedTime = await slider.inputValue();
    await page.waitForTimeout(200);
    assert(await slider.inputValue() === pausedTime, 'Pause stops the animation');
    await slider.fill('465');
    assert((await page.locator('.statRail strong').allTextContents()).join('|') === '33’284|−5’313|+77’404');
    assert((await page.locator('.leaflet-tile').first().getAttribute('src')).includes('/alidade_smooth/'));
    await page.getByRole('button', { name: 'Use the current time in Switzerland' }).click();
    await page.waitForTimeout(100);
    const now = await page.evaluate(() => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number);
      return parts[0] * 60 + parts[1];
    });
    assert(Math.abs(Number(await slider.inputValue()) - now) < 2, 'Current time remains available');
    await pause.click();
    await slider.fill('465');
    await slider.press('ArrowRight');
    assert(await slider.getAttribute('aria-valuetext') === '07:46');
    assert(await pause.getAttribute('aria-pressed') === 'true', 'Scrubbing preserves paused playback');
    for (const mode of ['fast', 'realtime', 'paused']) {
      const button = mode === 'fast' ? fast : mode === 'paused' ? pause : page.getByRole('button', { name: 'Use the current time in Switzerland' });
      if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
      for (const input of ['pointer', 'keyboard']) {
        if (input === 'pointer') {
          const box = await slider.boundingBox();
          await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
          await page.mouse.down();
          // Release outside the slider to exercise pointer capture.
          await page.mouse.move(box.x + box.width * 0.7, box.y - 20);
        } else {
          await slider.focus();
          await page.keyboard.down('Home');
        }
        const held = Number(await slider.inputValue());
        await page.waitForTimeout(1100);
        assert(Number(await slider.inputValue()) === held, `${mode}: clock is suspended during ${input} scrubbing`);
        assert(await button.getAttribute('aria-pressed') === 'true', `${mode}: selected mode stays unchanged while scrubbing`);
        if (input === 'pointer') await page.mouse.up();
        else await page.keyboard.up('Home');
        await page.waitForTimeout(300);
        const resumed = Number(await slider.inputValue());
        if (mode === 'fast') {
          const advance = (resumed - held + 1440) % 1440;
          assert(advance > 2 && advance < 10, 'Fast-forward resumes from the scrubbed time without counting the drag duration');
        } else if (mode === 'realtime') {
          assert(Math.abs(resumed - now) < 2, 'Now returns to the current Swiss time on release');
        } else assert(resumed === held, 'Paused playback stays at the scrubbed time');
        assert(await button.getAttribute('aria-pressed') === 'true', `${mode}: releasing ${input} preserves playback mode`);
      }
    }
    await fast.click();
    await slider.focus();
    await page.keyboard.down('Home');
    await slider.evaluate(node => node.blur());
    await page.waitForTimeout(200);
    assert(Number(await slider.inputValue()) > 0, 'Losing focus ends keyboard scrubbing');
    await page.keyboard.up('Home');
    results.push('Pointer and keyboard scrubbing suspend updates while held, then restore fast-forward, current time or pause; release outside the slider and focus loss recover.');
    await page.getByRole('combobox', { name: 'City', exact: true }).selectOption('basel');
    await page.waitForFunction(() => document.title.startsWith('Basel') && Number(document.querySelector('.populationChartScrubber')?.value) > 465);
    assert(await fast.getAttribute('aria-pressed') === 'true', 'Each city starts its own morning animation');
    results.push('Autoplay waits for the map; pause, current time, keyboard scrubbing and city changes work; Geneva counts unchanged.');

    gate = new Promise(resolve => { release = resolve; });
    await page.goto(`${baseUrl}/geneva/`);
    await pause.click();
    release();
    await page.locator('.leaflet-container').waitFor();
    await page.waitForTimeout(200);
    assert(await slider.inputValue() === '465', 'A pause requested during loading must survive map readiness');
    results.push('Pausing during loading prevents autoplay.');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${baseUrl}/geneva/`);
    await page.locator('.leaflet-container').waitFor();
    await page.waitForTimeout(200);
    assert(await slider.inputValue() === '465');
    assert(await pause.getAttribute('aria-pressed') === 'true', 'Reduced motion starts paused');
    for (const [width, height, city] of [[390, 844, 'geneva'], [375, 667, 'geneva'], [320, 568, 'geneva'], [320, 568, 'la-chaux-de-fonds'], [1440, 1000, 'geneva']]) {
      await page.setViewportSize({ width, height });
      if (!page.url().endsWith(`/${city}/`)) {
        await page.getByRole('combobox', { name: 'City', exact: true }).selectOption(city);
        await page.waitForURL(`**/${city}/`);
        await page.locator('.leaflet-container').waitFor();
      }
      const bounds = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect();
        return { controlsBottom: box('.controls').bottom, mapHeight: box('.mapPanel').height,
          legendBottom: box('.flowLegend').bottom, noteTop: box('.mapNote').top,
          documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
      });
      assert(bounds.controlsBottom <= height, `Controls fit on the first screen at ${width}×${height}: ${bounds.controlsBottom}`);
      assert(bounds.documentWidth <= bounds.viewportWidth, 'No horizontal overflow');
      assert(bounds.mapHeight >= 240, 'The map retains usable height');
      if (width <= 680) assert(bounds.legendBottom <= bounds.noteTop, 'Map captions do not overlap');
      results.push({ city, width, height, ...bounds });
      if (city === 'la-chaux-de-fonds') {
        const buttons = page.locator('.modeFilters button');
        for (const mask of [3, 5, 6, 0, 7]) {
          for (let i = 0; i < 3; i++) {
            const button = buttons.nth(i);
            if ((await button.getAttribute('aria-pressed') === 'true') !== Boolean(mask & (1 << i))) await button.click();
          }
          assert(await page.locator('.controls').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight), 'Long mode labels must leave playback controls in view');
        }
      }
    }
    assert(await pause.getAttribute('aria-pressed') === 'true');
    await fast.click();
    await page.waitForFunction(() => Number(document.querySelector('.populationChartScrubber')?.value) > 465);
    results.push('Reduced motion stays paused until explicit playback; mobile and desktop layouts fit.');
    assert(errors.length === 0, errors.join('\n'));
    return results;
  } finally {
    release();
    await context.close();
  }
}
