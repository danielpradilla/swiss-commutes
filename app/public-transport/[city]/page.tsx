import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cities, cityBySlug } from '../../cities';
import TransitDashboard from '../../trains/train-dashboard';

type Props = { params: Promise<{ city: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return cities.map(({ slug }) => ({ city: slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const city = cityBySlug[(await params).city];
  if (!city) return {};
  const title = `Public transport around ${city.displayName} | Swiss Commutes`;
  const description = `Estimated train, tram and bus positions, current delays and selectable full trip routes around ${city.displayName}.`;
  return { title, description, alternates: { canonical: `/projects/swiss-commutes/public-transport/${city.slug}/` },
    openGraph: { title, description }, twitter: { title, description } };
}

export default async function PublicTransportCityPage({ params }: Props) {
  const city = cityBySlug[(await params).city];
  if (!city) notFound();
  return <TransitDashboard key={`public-transport:${city.slug}`} view="public-transport" initialCity={city.slug} cities={cities.map(({ slug, displayName, centre }) => ({ slug, displayName, centre }))} />;
}
