import { cities } from '../../cities';
import { loadRouteData } from '../../route-data';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return cities.map(({ slug }) => ({ city: slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ city: string }> }) {
  const slug = (await params).city;
  const city = cities.find(city => city.slug === slug);
  if (!city) return new Response('Unknown city', { status: 404 });
  return Response.json(await loadRouteData(city.slug));
}
