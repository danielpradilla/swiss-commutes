import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cities, cityBySlug } from '../../cities';
import TransitDashboard from '../train-dashboard';

type Props = { params: Promise<{ city: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return cities.map(({ slug }) => ({ city: slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const city = cityBySlug[(await params).city];
  if (!city) return {};
  const title = `Trains around ${city.displayName} | Swiss Commutes`;
  const description = `Estimated train positions, current delays, rail track context and selectable full trip routes around ${city.displayName}.`;
  return { title, description, alternates: { canonical: `/projects/swiss-commutes/trains/${city.slug}/` },
    openGraph: { title, description }, twitter: { title, description } };
}

export default async function TrainCityPage({ params }: Props) {
  const city = cityBySlug[(await params).city];
  if (!city) notFound();
  return <TransitDashboard key={`trains:${city.slug}`} view="trains" initialCity={city.slug} cities={cities.map(({ slug, displayName, centre }) => ({ slug, displayName, centre }))} />;
}
