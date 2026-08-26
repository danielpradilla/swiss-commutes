import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CommuteDashboard from '../components/commute-dashboard';
import { cities, cityBySlug } from '../cities';

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
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function CityPage({ params }: CityPageProps) {
  const city = cityBySlug[(await params).city];
  if (!city) notFound();
  const cityOptions = cities.map(({ slug, displayName }) => ({ slug, displayName }));
  return <CommuteDashboard city={city} cityOptions={cityOptions} />;
}
