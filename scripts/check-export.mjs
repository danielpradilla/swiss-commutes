import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cities } from '../app/cities.ts';

// Read expected routes from the source registry, never from the export being checked.
const citySlugs = cities.map(({ slug }) => slug);
assert.ok(citySlugs.length && new Set(citySlugs).size === citySlugs.length, 'City order must contain unique slugs');

const readPage = path => readFileSync(`out/${path}index.html`, 'utf8');
const home = readPage('');
const zurich = readPage('zurich/');

for (const slug of citySlugs) {
  const html = slug === 'zurich' ? zurich : readPage(`${slug}/`);
  const json = readFileSync(`out/${slug}/routes.json`, 'utf8');
  const { version, ...routes } = JSON.parse(json);
  assert.equal(version, createHash('sha256').update(JSON.stringify(routes)).digest('hex').slice(0, 16), `${slug}: route version must match geometry`);
  assert.ok(html.includes(`/${slug}/routes.json?v=${version}`), `${slug}: page must reference its exported route version`);
  if (slug === 'zurich') assert.ok(home.includes(`/zurich/routes.json?v=${version}`), 'Home must reference Zürich route version');
  assert.ok(routes.carRoutes.shapes.length && Object.keys(routes.carRoutes.routes).length, `${slug}: static geometry must contain routes`);
  assert.ok(!html.includes('carRoutes'), `${slug}: route geometry must stay out of page HTML`);

  const image = `social/${slug}.jpg`;
  const url = `https://www.danielpradilla.info/swiss-commutes/${image}`;
  assert.ok(html.includes(`property="og:image" content="${url}"`), `${slug}: sharing preview must match the city`);
  assert.ok(html.includes(`name="twitter:image" content="${url}"`), `${slug}: Twitter must use the same screenshot`);
  assert.ok(statSync(`out/${image}`).size > 0, `${slug}: sharing screenshot must be exported`);
}
const homeImage = 'https://www.danielpradilla.info/swiss-commutes/social/zurich.jpg';
assert.ok(home.includes(`property="og:image" content="${homeImage}"`), 'Home must share the Zürich screenshot');
assert.ok(!home.includes('carRoutes'), 'Home must not embed route geometry');
assert.ok(!existsSync('out/og.png'), 'Unused sharing poster must not be published');
console.log('Verified all city pages, sharing previews and versioned route geometry');

const noCommuterData = /routes\.json|journeyTimes|communeNodes/;
for (const family of ['live', 'trains', 'mobility']) {
  for (const slug of ['', ...citySlugs]) {
    const html = readPage(`${family}/${slug ? `${slug}/` : ''}`);
    assert.doesNotMatch(html, noCommuterData, `${family}/${slug || 'root'}: must not embed commuter data`);
    assert.ok(Buffer.byteLength(html) < 100_000, `${family}/${slug || 'root'}: must not embed commuter or timetable datasets`);
    if (family === 'trains' && slug) {
      const rail = JSON.parse(readFileSync(`out/trains/${slug}/rail.json`, 'utf8'));
      assert.ok(Array.isArray(rail.segments) && rail.segments.length, `${slug}: train map must export rail geometry`);
    }
  }
  assert.ok(statSync(`out/${family}/feed.php`).isFile(), `${family}: PHP feed must be exported`);
}
assert.ok(!existsSync('out/live/replay.php'), 'The live endpoint serves the current feed only');
for (const family of ['live', 'trains']) {
  const privateDir = `out/${family}/.private`;
  assert.equal(readFileSync(`${privateDir}/.htaccess`, 'utf8').trim(), 'Require all denied', `${family}: private directory must deny web requests`);
  assert.deepEqual(readdirSync(privateDir), ['.htaccess'], `${family}: private contents must not be published`);
}
assert.ok(!existsSync('out/trains/timetable'), 'Raw timetables must not be published');
assert.match(readFileSync('out/live/.htaccess', 'utf8'), /^SetEnv SWISS_LIVE_PRIVATE_DIR \/home\/depr001\/\.swiss-commutes\/live$/m,
  'Live keys and history must stay outside the published directory');
console.log('Verified live, train and mobility pages, feeds, rail geometry and private-directory protections');
