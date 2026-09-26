import type { Metadata } from 'next';
import MobilityCityPage from './[city]/page';

export const metadata: Metadata = {
  title: 'Shared mobility | Swiss Commutes',
  description: 'Reported availability of shared bikes, scooters and cars in sixteen Swiss city views.',
  alternates: { canonical: '/swiss-commutes/mobility/' },
};
export default function MobilityPage() {
  return <MobilityCityPage params={Promise.resolve({ city: 'zurich' })} />;
}
