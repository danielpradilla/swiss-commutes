import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.match(html, /rel="icon"[^>]*href="\/swiss-commutes\/favicon\.svg"/);
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
