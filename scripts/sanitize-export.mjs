import { existsSync, readdirSync, rmSync } from 'node:fs';

// Next copies all of public/, including ignored local feed caches, into out/.
// Only the access rule belongs in the published private directories.
for (const directory of ['out/live/.private', 'out/trains/.private']) {
  if (!existsSync(`${directory}/.htaccess`)) throw new Error(`Missing access rule: ${directory}/.htaccess`);
  for (const entry of readdirSync(directory)) {
    if (entry !== '.htaccess') rmSync(`${directory}/${entry}`, { recursive: true, force: true });
  }
}

// The timetable updater owns its files on the host, not the static export.
rmSync('out/trains/timetable', { recursive: true, force: true });
console.log('Removed local feed state and timetable files from the static export');
