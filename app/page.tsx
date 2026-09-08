import CityPage, { generateMetadata as cityMetadata } from './[city]/page';

const params = Promise.resolve({ city: 'zurich' });

export function generateMetadata() {
  return cityMetadata({ params });
}

export default function Home() {
  return <CityPage params={params} />;
}
