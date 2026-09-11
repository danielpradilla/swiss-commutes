import type { Metadata } from 'next';
import LiveCityPage from './[city]/page';

export const metadata: Metadata = {
  title: 'Live traffic | Swiss Commutes',
  description: 'Measured vehicle counts and speeds from Swiss road counters, updated every minute.',
  alternates: { canonical: '/swiss-commutes/live/' },
  openGraph: { title: 'Live traffic | Swiss Commutes', description: 'Measured vehicle counts and speeds from Swiss road counters.' },
  twitter: { title: 'Live traffic | Swiss Commutes', description: 'Measured vehicle counts and speeds from Swiss road counters.' },
};

export default function LivePage() {
  return <LiveCityPage params={Promise.resolve({ city: 'zurich' })} />;
}
