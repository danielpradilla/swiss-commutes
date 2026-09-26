import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cities, cityBySlug } from '../../cities';
import MobilityDashboard from '../mobility-dashboard';

type Props = { params: Promise<{ city: string }> };
export function generateStaticParams() { return cities.map(({ slug }) => ({ city: slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const city = cityBySlug[(await params).city];
  if (!city) return {};
  const title = `Shared mobility in ${city.displayName} | Swiss Commutes`;
  const description = `Reported availability of shared bikes, scooters and cars around ${city.displayName}.`;
  return { title, description, alternates: { canonical: `/swiss-commutes/mobility/${city.slug}/` },
    openGraph: { title, description }, twitter: { title, description } };
}
export default async function MobilityCityPage({ params }: Props) {
  const city = cityBySlug[(await params).city];
  if (!city) notFound();
  return <MobilityDashboard initialCity={city.slug} cities={cities.map(({ slug, displayName, centre }) => ({ slug, displayName, centre }))} />;
}
