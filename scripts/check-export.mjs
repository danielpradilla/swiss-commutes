import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cities } from '../app/cities.ts';
import { decodePolyline } from '../app/route-geometry.ts';

// Read expected routes from the source registry, never from the export being checked.
const citySlugs = cities.map(({ slug }) => slug);
assert.ok(citySlugs.length && new Set(citySlugs).size === citySlugs.length, 'City order must contain unique slugs');

const readPage = path => {
  const html = readFileSync(`out/${path}index.html`, 'utf8');
  assert.match(html, /class="dp-navbar-brand" href="https:\/\/www\.danielpradilla\.info\/projects\/"/,
    `${path || 'home'}: brand must lead to the parent site's projects`);
  assert.match(html, /href="https:\/\/www\.danielpradilla\.info\/blog\/">Blog<\/a>/,
    `${path || 'home'}: blog must lead to the parent site`);
  assert.match(html, /href="\/projects\/swiss-commutes\/live\/"[^>]*>Traffic<\/a>/,
    `${path || 'home'}: internal navigation must retain the base path`);
  const navigation = [...html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)];
  assert.ok(navigation.length >= 3, `${path || 'home'}: desktop, mobile and footer navigation must be present`);
  for (const [, links] of navigation) {
    for (const route of ['trains', 'public-transport']) {
      assert.ok(links.includes(`href="/projects/swiss-commutes/${route}/"`), `${path || 'home'}: every menu must link to ${route} with the base path`);
    }
  }
  return html;
};
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
  const url = `https://www.danielpradilla.info/projects/swiss-commutes/${image}`;
  assert.ok(html.includes(`property="og:image" content="${url}"`), `${slug}: sharing preview must match the city`);
  assert.ok(html.includes(`name="twitter:image" content="${url}"`), `${slug}: Twitter must use the same screenshot`);
  assert.ok(statSync(`out/${image}`).size > 0, `${slug}: sharing screenshot must be exported`);
}
const homeImage = 'https://www.danielpradilla.info/projects/swiss-commutes/social/zurich.jpg';
assert.ok(home.includes(`property="og:image" content="${homeImage}"`), 'Home must share the Zürich screenshot');
assert.ok(!home.includes('carRoutes'), 'Home must not embed route geometry');
assert.ok(!existsSync('out/og.png'), 'Unused sharing poster must not be published');
console.log('Verified all city pages, sharing previews and versioned route geometry');

const noCommuterData = /routes\.json|journeyTimes|communeNodes|(?:\\?")(?:segments|stations|carRoutes|activeRoutes)(?:\\?")\s*:/;
const transportTitles = new Map();
for (const family of ['live', 'trains', 'public-transport', 'mobility']) {
  for (const slug of ['', ...citySlugs]) {
    const html = readPage(`${family}/${slug ? `${slug}/` : ''}`);
    assert.doesNotMatch(html, noCommuterData, `${family}/${slug || 'root'}: must not embed commuter data`);
    assert.ok(Buffer.byteLength(html) < 100_000, `${family}/${slug || 'root'}: must not embed commuter or timetable datasets`);
    if (family === 'trains' || family === 'public-transport') {
      const path = `/projects/swiss-commutes/${family}/${slug ? `${slug}/` : ''}`;
      const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*>/)?.[0];
      assert.ok(canonical?.includes(`href="https://www.danielpradilla.info${path}"`), `${family}/${slug || 'root'}: canonical must identify its own view and city`);
      const title = html.match(/<title>(.*?)<\/title>/)?.[1];
      assert.ok(title, `${family}/${slug || 'root'}: page must have a title`);
      if (family === 'trains') transportTitles.set(slug, title);
      else assert.notEqual(title, transportTitles.get(slug), `${slug || 'root'}: rail and mixed transport views must have distinct titles`);
    }
  }
  if (family !== 'public-transport') assert.ok(statSync(`out/${family}/feed.php`).isFile(), `${family}: PHP feed must be exported`);
}
assert.ok(statSync('out/trains/network.php').isFile(), 'Mapped transit network tile endpoint must be exported');
assert.ok(!existsSync('out/public-transport/feed.php'), 'Public transport must reuse the trains feed, not publish a duplicate');
assert.ok(!existsSync('out/public-transport/cities.json'), 'Public transport must reuse the trains city registry');
for (const slug of citySlugs) {
  const tracks = JSON.parse(readFileSync(`out/trains/${slug}/tracks.json`, 'utf8'));
  assert.deepEqual(Object.keys(tracks).sort(), ['networkYear', 'segments', 'source'], `${slug}: track endpoint must contain only context geometry and provenance`);
  const source = JSON.parse(readFileSync(`app/data/${slug}-rail-routes.json`, 'utf8'));
  assert.equal(tracks.source, source.source, `${slug}: track provenance must match the source`);
  assert.ok(typeof tracks.source === 'string' && URL.canParse(tracks.source), `${slug}: track source must be a URL`);
  assert.equal(tracks.networkYear, source.networkYear, `${slug}: track year must match the source`);
  assert.ok(Number.isInteger(tracks.networkYear), `${slug}: track year must be an integer`);
  assert.deepEqual(tracks.segments, source.segments, `${slug}: all project track segments must be exported`);
  assert.ok(tracks.segments && typeof tracks.segments === 'object' && !Array.isArray(tracks.segments) && Object.keys(tracks.segments).length, `${slug}: track segments must be a nonempty record`);
  for (const [id, encoded] of Object.entries(tracks.segments)) {
    assert.ok(id && typeof encoded === 'string' && encoded.length && /^[?-~]+$/.test(encoded), `${slug}/${id}: track segment must be an encoded polyline`);
    const points = decodePolyline(encoded);
    assert.ok(points.length >= 2 && points.every(([lat, lon]) => Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180), `${slug}/${id}: track segment must decode to valid coordinates`);
  }
}
const transitCities = JSON.parse(readFileSync('out/trains/cities.json', 'utf8'));
assert.deepEqual(Object.keys(transitCities).sort(), [...citySlugs].sort(), 'Transit proxy must support every city');
for (const centre of Object.values(transitCities)) {
  assert.ok(Number.isFinite(centre.lat) && Number.isFinite(centre.lon), 'Transit proxy city centres must be coordinates');
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
console.log('Verified live, transit and mobility pages, feeds and private-directory protections');
