import CommuteDashboard from './components/commute-dashboard';
import { cities, cityBySlug } from './cities';

const cityOptions = cities.map(({ slug, displayName }) => ({ slug, displayName }));

export default function Home() {
  return <CommuteDashboard city={cityBySlug.geneva} cityOptions={cityOptions} />;
}
