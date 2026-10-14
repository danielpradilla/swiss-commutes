import type { Metadata } from 'next';
import PublicTransportCityPage from './[city]/page';

export const metadata: Metadata = {
  title: 'Public transport | Swiss Commutes',
  description: 'Estimated train, tram and bus positions, current delays and selectable full trip routes for the project cities.',
  alternates: { canonical: '/projects/swiss-commutes/public-transport/' },
  openGraph: { title: 'Public transport | Swiss Commutes', description: 'Moving trains, trams and buses, trip routes and stop times.' },
  twitter: { title: 'Public transport | Swiss Commutes', description: 'Moving trains, trams and buses, trip routes and stop times.' },
};

export default function PublicTransportPage() {
  return <PublicTransportCityPage params={Promise.resolve({ city: 'zurich' })} />;
}
