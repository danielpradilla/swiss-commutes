import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cities } from '../../../cities';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return cities.map(({ slug }) => ({ city: slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ city: string }> }) {
  const slug = (await params).city;
  const city = cities.find(city => city.slug === slug);
  if (!city) return new Response('Unknown city', { status: 404 });
  const { source, networkYear, segments } = JSON.parse(await readFile(join(process.cwd(), 'app', 'data', `${city.slug}-rail-routes.json`), 'utf8'));
  return Response.json({ source, networkYear, segments });
}
