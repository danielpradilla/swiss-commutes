export type Mode = 'bike' | 'scooter' | 'car' | 'moped';
export type Counts = Record<Mode, number>;
export type Site = { id: string; name: string; provider: string; lat: number; lon: number; kind: 'station' | 'street'; counts: Counts };
export type MobilityFeed = { updatedAt: number; sites: Site[] };

const base = '/swiss-commutes/mobility/feed.php?path=';
const empty = (): Counts => ({ bike: 0, scooter: 0, car: 0, moped: 0 });
const mode = (form: string): Mode | null => {
  if (form === 'bicycle' || form === 'cargo_bicycle' || form === 'bike') return 'bike';
  if (form === 'scooter' || form === 'scooter_standing') return 'scooter';
  if (form === 'car') return 'car';
  if (form === 'moped') return 'moped';
  return null;
};

type Envelope<T> = { last_updated: number; data: T };
type Type = { vehicle_type_id: string; form_factor: string };
type Vehicle = { bike_id: string; lat: number; lon: number; provider_id: string; vehicle_type_id: string; is_reserved: boolean; is_disabled: boolean };
type Station = { station_id: string; name: string; lat: number; lon: number; provider_id: string };
type Status = { station_id: string; provider_id?: string; num_bikes_available: number; is_installed: boolean; is_renting: boolean; last_reported: number;
  vehicle_types_available?: { vehicle_type_id: string; count: number }[] };

async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Shared mobility returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function loadMobility(signal: AbortSignal): Promise<MobilityFeed> {
  const [typesFeed, vehicleFeed, stationFeed, statusFeed] = await Promise.all([
    json<Envelope<{ vehicle_types: Type[] }>>(`${base}vehicle_types.json`, signal),
    json<Envelope<{ bikes: Vehicle[] }>>(`${base}free_bike_status.json`, signal),
    json<Envelope<{ stations: Station[] }>>(`${base}station_information.json`, signal),
    json<Envelope<{ stations: Status[] }>>(`${base}station_status.json`, signal),
  ]);
  const updatedAt = Math.min(typesFeed.last_updated, vehicleFeed.last_updated, stationFeed.last_updated, statusFeed.last_updated);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || !Array.isArray(typesFeed.data.vehicle_types) ||
    !Array.isArray(vehicleFeed.data.bikes) || !Array.isArray(stationFeed.data.stations) || !Array.isArray(statusFeed.data.stations)) throw new Error('Invalid shared mobility feed');
  const types = new Map(typesFeed.data.vehicle_types.map(type => [type.vehicle_type_id, mode(type.form_factor)]));
  const providerModes = new Map<string, Set<Mode>>();
  for (const type of typesFeed.data.vehicle_types) {
    const provider = type.vehicle_type_id.split(':')[0];
    const kind = mode(type.form_factor);
    if (!kind) continue;
    if (!providerModes.has(provider)) providerModes.set(provider, new Set());
    providerModes.get(provider)!.add(kind);
  }
  const statuses = new Map(statusFeed.data.stations.map(status => [status.station_id, status]));
  const mixed = new Set(stationFeed.data.stations.filter(station => (providerModes.get(station.provider_id)?.size ?? 0) > 1 &&
    (statuses.get(station.station_id)?.num_bikes_available ?? 0) > 0).map(station => station.provider_id));
  const detailed = new Map<string, Map<string, Status>>();
  await Promise.all([...mixed].map(async provider => {
    // The combined 2.0 station count mixes vehicle kinds. The provider 2.3 feed gives counts by vehicle type.
    try {
      const feed = await json<Envelope<{ stations: Status[] }>>(`${base}v2/gbfs/${encodeURIComponent(provider)}/station_status`, signal);
      if (Array.isArray(feed.data.stations)) detailed.set(provider, new Map(feed.data.stations.map(status => [status.station_id, status])));
    } catch (error) { if (signal.aborted) throw error; } // Omit ambiguous stations instead of assigning the wrong vehicle kind.
  }));
  const sites: Site[] = [];
  const stationLocations = new Map<string, Station>();
  const stationSites = new Map<string, Site>();
  const countedStations = new Set<string>();
  for (const station of stationFeed.data.stations) {
    if (Number.isFinite(station.lat) && Number.isFinite(station.lon)) {
      stationLocations.set(`${station.provider_id}:${station.lat}:${station.lon}`, station);
    }
  }
  const now = Date.now() / 1000;
  for (const station of stationFeed.data.stations) {
    const status = statuses.get(station.station_id);
    if (!status || !Number.isFinite(station.lat) || !Number.isFinite(station.lon) || !status.is_installed || !status.is_renting ||
      !Number.isFinite(status.last_reported) || now - status.last_reported > 600 || status.last_reported > now + 60) continue;
    const counts = empty();
    const kinds = providerModes.get(station.provider_id);
    if (kinds?.size === 1) {
      counts[[...kinds][0]] = Math.max(0, status.num_bikes_available || 0);
    } else if (kinds && kinds.size > 1) {
      const detail = detailed.get(station.provider_id)?.get(station.station_id.replace(`${station.provider_id}:`, ''));
      if (!detail?.is_renting || !detail.vehicle_types_available || now - detail.last_reported > 600) continue;
      for (const item of detail.vehicle_types_available) {
        const kind = types.get(`${station.provider_id}:${item.vehicle_type_id}`);
        if (kind && Number.isInteger(item.count) && item.count > 0) counts[kind] += item.count;
      }
    }
    if (Object.values(counts).some(count => count > 0)) {
      const site = { id: station.station_id, name: station.name, provider: station.provider_id,
        lat: station.lat, lon: station.lon, kind: 'station' as const, counts };
      sites.push(site);
      stationSites.set(station.station_id, site);
      countedStations.add(station.station_id);
    }
  }
  const streets = new Map<string, Site>();
  for (const vehicle of vehicleFeed.data.bikes) {
    if (vehicle.is_disabled || vehicle.is_reserved || !Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) continue;
    const kind = types.get(vehicle.vehicle_type_id);
    if (!kind) continue;
    const station = stationLocations.get(`${vehicle.provider_id}:${vehicle.lat}:${vehicle.lon}`);
    if (station) {
      const status = statuses.get(station.station_id);
      if (status && now - status.last_reported <= 600 && (!status.is_installed || !status.is_renting)) continue;
      let site = stationSites.get(station.station_id);
      if (countedStations.has(station.station_id)) continue; // Station count already includes these individually listed vehicles.
      if (!site) {
        site = { id: station.station_id, name: station.name, provider: station.provider_id, lat: station.lat, lon: station.lon,
          kind: 'station', counts: empty() };
        sites.push(site);
        stationSites.set(station.station_id, site);
      }
      site.counts[kind]++;
      continue;
    }
    // Co-located vehicles share a marker; never move them to an artificial grid centre.
    const id = `street:${vehicle.provider_id}:${vehicle.lat}:${vehicle.lon}`;
    let site = streets.get(id);
    if (!site) {
      site = { id, name: `Street pickup · ${vehicle.lat.toFixed(4)}, ${vehicle.lon.toFixed(4)}`, provider: vehicle.provider_id, lat: vehicle.lat, lon: vehicle.lon,
        kind: 'street', counts: empty() };
      streets.set(id, site);
    }
    site.counts[kind]++;
  }
  sites.push(...streets.values());
  return { updatedAt, sites };
}

export function siteCount(site: Site, selected: Mode[]) {
  return selected.reduce((sum, kind) => sum + site.counts[kind], 0);
}
