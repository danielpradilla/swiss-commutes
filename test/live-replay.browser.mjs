const check = (condition, message) => { if (!condition) throw new Error(message); };

// Run against the local preview with a Playwright Page; fixtures never reach the server.
export async function checkReplay(page, origin = 'http://127.0.0.1:3004') {
  const base = Date.now();
  let queries = 0;
  let unavailable = false;
  let empty = false;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/live/replay.php', route => {
    queries++;
    if (unavailable) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable"}' });
    const generated = base + (queries - 1) * 60_000;
    return route.fulfill({ json: {
      generatedAt: new Date(generated).toISOString(), collectedAt: new Date(generated).toISOString(), intervalSeconds: 60,
      stations: [{ id: 'test', name: 'Test counter', lat: 47.3769, lon: 8.5417,
        detectors: [{ id: 'test.1', lane: 'lane1', direction: 'positive', reading: null }] },
        { id: 'offline', name: 'Offline counter', lat: 47.38, lon: 8.54,
          detectors: [{ id: 'offline.1', lane: '', direction: '', reading: null }] },
        { id: 'far', name: 'Other city', lat: 46.2, lon: 6.14,
          detectors: [{ id: 'far.1', lane: '', direction: '', reading: null }] }],
      frames: Array.from({ length: 30 }, (_, i) => ({
        at: new Date(Math.floor(generated / 60_000) * 60_000 - (30 - i) * 60_000).toISOString(),
        readings: empty || [0, 2, 3].includes(i) ? {} : i === 4 ? { 'far.1': [10, 0, null, null] } : { 'test.1': [i === 1 ? 0 : i + 7, 0, null, null] },
        collected: i !== 0 && i !== 2,
        errors: i === 3 ? { 'test.1': 'VD_OFFLINE', 'offline.1': 'VD_OFFLINE' } : { 'offline.1': 'VD_OFFLINE' },
      })),
    } });
  });
  await page.goto(`${origin}/swiss-commutes/live/zurich/`);
  const controls = page.getByRole('group', { name: 'Replay controls' });
  await controls.waitFor();
  const minute = () => controls.locator('time').getAttribute('datetime');
  const first = await minute();
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  await controls.locator('small').filter({ hasText: /^1 \/ 26$/ }).waitFor();
  check(Date.parse(first) === Math.floor(base / 60_000) * 60_000 - 29 * 60_000, 'Skip the initial empty minute');
  check(/0\/min/.test(await page.getByRole('region', { name: 'Counting stations' }).innerText()), 'Keep measured zero');
  check(/Detector offline/.test(await page.getByRole('region', { name: 'Counting stations' }).innerText()), 'Keep offline labels on available frames');
  await page.waitForTimeout(2500);
  check(await minute() === first, 'Pause must freeze the recorded minute');
  check(queries === 1, 'Pause must not issue queries');
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  for (let i = 1; i < 26; i++) {
    await controls.locator('small').filter({ hasText: new RegExp(`^${i + 1} / 26$`) }).waitFor({ timeout: 5000 });
    check(Date.parse(await minute()) === Date.parse(first) + (i + 3) * 60_000, 'Jump over missing, offline-only and other-city minutes while preserving timestamps');
  }
  check(queries === 1, 'The window must stay fixed throughout the loop');
  await controls.locator('small').filter({ hasText: /^1 \/ 26$/ }).waitFor({ timeout: 12_000 });
  check(queries === 2, 'Requery after available frames have played, no sooner than a minute');
  check(Date.parse(await minute()) === Date.parse(first) + 60_000, 'The refreshed window moves forward a minute');

  unavailable = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.getByText('Could not refresh the replay. Retrying in a minute.', { exact: true }).waitFor();
  const failedAt = await minute();
  const failedQueries = queries;
  await page.waitForTimeout(58_000);
  check(await minute() === failedAt, 'A failed refresh must stop playback');
  check(queries === failedQueries, 'Do not hammer a failed endpoint');
  unavailable = false;
  await page.getByText('Could not refresh the replay. Retrying in a minute.', { exact: true }).waitFor({ state: 'hidden', timeout: 5000 });
  check(queries === failedQueries + 1, 'Retry once after a minute');
  empty = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.getByText('No usable counts in the last 30 minutes. Checking again in a minute.', { exact: true }).waitFor();
  const emptyQueries = queries;
  await page.waitForTimeout(5000);
  check(queries === emptyQueries && await controls.count() === 0, 'An entirely empty window must not loop or poll rapidly');
  check(await page.locator('input[type="range"]').count() === 0, 'No scrubber');
  check(errors.length === 0, errors.join('; '));
  return { queries, availableFrames: 26, pause: true, skippedGaps: true, recovery: true, emptyWindow: true };
}
