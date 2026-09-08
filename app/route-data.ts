import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { packCarRoutes, type ActiveRouteCache, type CarRouteCache } from './road-flow.ts';
import type { RailRouteCache } from './route-geometry.ts';

// Used only at export time (and by the development server).
export async function loadRouteData(slug: string) {
  const read = async (mode: string) => JSON.parse(await readFile(join(process.cwd(), 'app', 'data', `${slug}-${mode}-routes.json`), 'utf8'));
  const [car, rail, active, transit] = await Promise.all([
    read('car'), read('rail'), read('active'), slug === 'geneva' ? read('transit') : undefined,
  ]);
  const data = {
    carRoutes: packCarRoutes(car.routes as CarRouteCache),
    railRoutes: rail as RailRouteCache,
    transitRoutes: transit ? packCarRoutes(transit.routes) : undefined,
    activeRoutes: Object.fromEntries(Object.entries(active.routes).filter(([key, route]) => {
      const pair = route as ActiveRouteCache[string];
      return pair.toWork && pair.toHome && !active.skipped[key];
    })) as ActiveRouteCache,
  };
  const version = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
  return { ...data, version };
}

export type RouteData = Awaited<ReturnType<typeof loadRouteData>>;
