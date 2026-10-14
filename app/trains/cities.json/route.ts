import { cities } from '../../cities';

export const dynamic = 'force-static';

export function GET() {
  return Response.json(Object.fromEntries(cities.map(({ slug, centre }) => [slug, centre])));
}
