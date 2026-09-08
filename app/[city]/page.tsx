import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CommuteDashboard from '../components/commute-dashboard';
import { cities, cityBySlug } from '../cities';
import { unpackCarRoutes } from '../road-flow';
import { prepareMapData, type MapSummary } from '../map-data';
import { loadRouteData } from '../route-data';

type CityPageProps = { params: Promise<{ city: string }> };

export function generateStaticParams() {
  return cities.map((city) => ({ city: city.slug }));
}

export async function generateMetadata({ params }: CityPageProps): Promise<Metadata> {
  const city = cityBySlug[(await params).city];
  if (!city) return {};
  const title = `${city.displayName} / 24h | Swiss Commutes`;
  const description = `A 24-hour map of commuting in ${city.displayName} and the surrounding region.`;
  return {
    title,
    description,
    alternates: { canonical: `/swiss-commutes/${city.slug}/` },
    openGraph: { title, description, type: 'website', images: ['/swiss-commutes/og.png'] },
    twitter: { card: 'summary_large_image', title, description, images: ['/swiss-commutes/og.png'] },
  };
}

export default async function CityPage({ params }: CityPageProps) {
  const city = cityBySlug[(await params).city];
  if (!city) notFound();
  const cityOptions = cities.map(({ slug, displayName }) => ({ slug, displayName }));
  const routes = await loadRouteData(city.slug);
  const corridors = city.data!.corridors;
  const map = prepareMapData(corridors, city.slug, unpackCarRoutes(routes.carRoutes), routes.railRoutes,
    routes.activeRoutes, routes.transitRoutes && unpackCarRoutes(routes.transitRoutes));
  const indices = new Map(corridors.map((corridor, index) => [corridor, index]));
  const summary: MapSummary = {
    communeNodes: map.communeNodes,
    journeyTimes: map.journeys.map(({ corridor, duration, returnDuration }) => [indices.get(corridor)!, duration, returnDuration]),
    hasRoadRoutes: !!map.roadFlow,
  };
  return <CommuteDashboard city={city} cityOptions={cityOptions} summary={summary}
    routesUrl={`/swiss-commutes/${city.slug}/routes.json?v=${routes.version}`} />;
}
