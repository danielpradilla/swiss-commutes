import type { Metadata } from 'next';
import TrainCityPage from './[city]/page';

export const metadata: Metadata = {
  title: 'Live trains | Swiss Commutes',
  description: 'Estimated live train positions, current delays and next stops for the project cities.',
  alternates: { canonical: '/swiss-commutes/trains/' },
  openGraph: { title: 'Live trains | Swiss Commutes', description: 'Estimated live train positions, current delays and next stops.' },
  twitter: { title: 'Live trains | Swiss Commutes', description: 'Estimated live train positions, current delays and next stops.' },
};

export default function TrainsPage() {
  return <TrainCityPage params={Promise.resolve({ city: 'zurich' })} />;
}
