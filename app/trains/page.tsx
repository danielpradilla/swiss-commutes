import type { Metadata } from 'next';
import TrainCityPage from './[city]/page';

export const metadata: Metadata = {
  title: 'Trains | Swiss Commutes',
  description: 'Estimated train positions, current delays, rail track context and selectable full trip routes for the project cities.',
  alternates: { canonical: '/projects/swiss-commutes/trains/' },
  openGraph: { title: 'Trains | Swiss Commutes', description: 'Moving trains, rail track context, trip routes and stop times.' },
  twitter: { title: 'Trains | Swiss Commutes', description: 'Moving trains, rail track context, trip routes and stop times.' },
};

export default function TrainsPage() {
  return <TrainCityPage params={Promise.resolve({ city: 'zurich' })} />;
}
