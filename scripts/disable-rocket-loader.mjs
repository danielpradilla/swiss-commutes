import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Cloudflare must leave Next's framework and inline data scripts in their original execution order.
// https://developers.cloudflare.com/speed/optimization/content/rocket-loader/ignore-javascripts/
export const disableRocketLoader = html => html.replace(/<script(?![^>]*\bdata-cfasync=)(?=[\s>])/g, '<script data-cfasync="false"');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = readdirSync('out', { recursive: true }).filter(file => file.endsWith('.html'));
  if (!files.length) throw new Error('No exported HTML to protect');
  for (const file of files) {
    const path = `out/${file}`;
    writeFileSync(path, disableRocketLoader(readFileSync(path, 'utf8')));
  }
  console.log(`Preserved script execution order in ${files.length} exported pages`);
}
