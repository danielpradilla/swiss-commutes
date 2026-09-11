import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = page => readFileSync(`out/${page}index.html`, 'utf8');
const home = read(''), zurich = read('zurich/'), geneva = read('geneva/');
const coverage = html => {
  const match = html.match(/<details class="routeCoverage">([\s\S]*?)<\/details>/);
  assert.ok(match, 'Export must contain route coverage');
  return match[1];
};
assert.equal(coverage(home), coverage(zurich), 'Home must load the same routes as Zürich');
assert.match(geneva, /<title>Geneva \/ 24h \| Swiss Commutes<\/title>/);
for (const html of [home, zurich, geneva]) {
  assert.match(html, /https:\/\/www\.danielpradilla\.info\/swiss-commutes\//);
  assert.doesNotMatch(html, /<link\b[^>]*\brel="(?:shortcut )?icon"/, 'Use the website’s default favicon');
  assert.match(html, /property="og:image"/);
  assert.ok(!html.includes('carRoutes'), 'Route geometry must stay out of the page HTML');
}
for (const [slug, html] of [['geneva', geneva], ['zurich', zurich]]) {
  const json = readFileSync(`out/${slug}/routes.json`, 'utf8');
  const { version, ...routes } = JSON.parse(json);
  assert.equal(version, createHash('sha256').update(JSON.stringify(routes)).digest('hex').slice(0, 16));
  assert.ok(html.includes(`/${slug}/routes.json?v=${version}`), 'Page must reference its exported route version');
  assert.ok(routes.carRoutes.shapes.length && Object.keys(routes.carRoutes.routes).length, 'Static geometry must contain routes');
}
console.log('Verified route coverage, metadata and separate versioned geometry exports');

const citySlugs = readdirSync('out').filter(slug => existsSync(`out/${slug}/routes.json`));
for (const slug of ['', ...citySlugs]) {
  const html = read(slug ? `${slug}/` : '');
  const image = `social/${slug || 'zurich'}.jpg`;
  const url = `https://www.danielpradilla.info/swiss-commutes/${image}`;
  assert.ok(html.includes(`property="og:image" content="${url}"`), 'Sharing preview must match the city');
  assert.ok(html.includes(`name="twitter:image" content="${url}"`), 'Twitter must use the same screenshot');
  assert.ok(readFileSync(`out/${image}`).length > 0, 'Sharing screenshot must be exported');
  assert.ok(!html.includes('/og.png'), 'The old poster must not appear in sharing metadata');
}
console.log('Verified city-specific sharing screenshots');

for (const slug of ['geneva', 'zurich', 'chiasso', 'mendrisio', 'zug', 'neuchatel']) {
  const html = read(`live/${slug}/`);
  assert.match(html, /Live traffic in/);
  assert.doesNotMatch(html, /routes\.json|journeyTimes|communeNodes|type="range"|Population vs daily average/);
  assert.ok(Buffer.byteLength(html) < 100_000, 'Live pages must not embed commuter datasets');
}
assert.match(read('live/'), /Live traffic in/);
assert.equal(readFileSync('out/live/.private/.htaccess', 'utf8').trim(), 'Require all denied');
console.log('Verified live pages contain no commuter model, scrubber or route data');
