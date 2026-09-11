import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cities, cityBySlug } from '../../cities';
import LiveDashboard from '../live-dashboard';

type Props = { params: Promise<{ city: string }> };

export function generateStaticParams() {
  return cities.map(({ slug }) => ({ city: slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const city = cityBySlug[(await params).city];
  if (!city) return {};
  const title = `Live traffic in ${city.displayName} | Swiss Commutes`;
  const description = `Live road counter readings around ${city.displayName}: measured vehicle counts and speeds, updated every minute.`;
  return { title, description, alternates: { canonical: `/swiss-commutes/live/${city.slug}/` },
    openGraph: { title, description }, twitter: { title, description } };
}

export default async function LiveCityPage({ params }: Props) {
  const city = cityBySlug[(await params).city];
  if (!city) notFound();
  const locations = cities.map(({ slug, displayName, centre: { lat, lon } }) => ({ slug, displayName, centre: { lat, lon } }));
  return <LiveDashboard initialCity={city.slug} cities={locations} />;
}
