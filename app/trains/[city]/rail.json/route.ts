import { cities } from '../../../cities';
import zurich from '../../../data/zurich-rail-routes.json';
import geneva from '../../../data/geneva-rail-routes.json';
import basel from '../../../data/basel-rail-routes.json';
import lausanne from '../../../data/lausanne-rail-routes.json';
import bern from '../../../data/bern-rail-routes.json';
import winterthur from '../../../data/winterthur-rail-routes.json';
import lucerne from '../../../data/lucerne-rail-routes.json';
import stGallen from '../../../data/st-gallen-rail-routes.json';
import lugano from '../../../data/lugano-rail-routes.json';
import bielBienne from '../../../data/biel-bienne-rail-routes.json';
import schaffhausen from '../../../data/schaffhausen-rail-routes.json';
import laChauxDeFonds from '../../../data/la-chaux-de-fonds-rail-routes.json';
import chiasso from '../../../data/chiasso-rail-routes.json';
import mendrisio from '../../../data/mendrisio-rail-routes.json';
import zug from '../../../data/zug-rail-routes.json';
import neuchatel from '../../../data/neuchatel-rail-routes.json';

const rail = { zurich, geneva, basel, lausanne, bern, winterthur, lucerne, 'st-gallen': stGallen, lugano,
  'biel-bienne': bielBienne, schaffhausen, 'la-chaux-de-fonds': laChauxDeFonds, chiasso, mendrisio, zug, neuchatel };

export const dynamic = 'force-static';

export function generateStaticParams() {
  return cities.map(({ slug }) => ({ city: slug }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ city: string }> }) {
  const data = rail[(await params).city as keyof typeof rail];
  if (!data) return new Response('Not found', { status: 404 });
  return Response.json({ segments: Object.values(data.segments) });
}
