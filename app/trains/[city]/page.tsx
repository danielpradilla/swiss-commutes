import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cities, cityBySlug } from '../../cities';
import TrainDashboard from '../train-dashboard';

type Props = { params: Promise<{ city: string }> };

export function generateStaticParams() {
  return cities.map(({ slug }) => ({ city: slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const city = cityBySlug[(await params).city];
  if (!city) return {};
  const title = `Live trains in ${city.displayName} | Swiss Commutes`;
  const description = `Estimated live train positions, current delays and next stops around ${city.displayName}.`;
  return { title, description, alternates: { canonical: `/swiss-commutes/trains/${city.slug}/` },
    openGraph: { title, description }, twitter: { title, description } };
}

export default async function TrainCityPage({ params }: Props) {
  const city = cityBySlug[(await params).city];
  if (!city) notFound();
  return <TrainDashboard initialCity={city.slug} cities={cities.map(({ slug, displayName, centre }) => ({ slug, displayName, centre }))} />;
}
