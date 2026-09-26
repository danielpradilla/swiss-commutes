import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadMobility, siteCount } from '../app/mobility/mobility-data.ts';

test('station counts do not duplicate listed vehicles; stale status uses only individually reported vehicles', async () => {
  const now = Math.floor(Date.now() / 1000);
  const fixtures: Record<string, unknown> = {
    'vehicle_types.json': { last_updated: now, data: { vehicle_types: [
      { vehicle_type_id: 'mix:bike', form_factor: 'bicycle' }, { vehicle_type_id: 'mix:scoot', form_factor: 'scooter' },
      { vehicle_type_id: 'bike-only:bike', form_factor: 'bicycle' },
    ] } },
    'free_bike_status.json': { last_updated: now, data: { bikes: [
      { bike_id: 'a', provider_id: 'mix', vehicle_type_id: 'mix:bike', lat: 47.37, lon: 8.54, is_reserved: false, is_disabled: false },
      { bike_id: 'b', provider_id: 'mix', vehicle_type_id: 'mix:scoot', lat: 47.3701, lon: 8.5401, is_reserved: false, is_disabled: false },
      { bike_id: 'c', provider_id: 'mix', vehicle_type_id: 'mix:bike', lat: 47.37, lon: 8.54, is_reserved: true, is_disabled: false },
      { bike_id: 'd', provider_id: 'mix', vehicle_type_id: 'mix:bike', lat: 47.38, lon: 8.53, is_reserved: false, is_disabled: false },
      { bike_id: 'e', provider_id: 'bike-only', vehicle_type_id: 'bike-only:bike', lat: 47.39, lon: 8.55, is_reserved: false, is_disabled: false },
    ] } },
    'station_information.json': { last_updated: now, data: { stations: [
      { station_id: 'mix:1', name: 'Central', lat: 47.38, lon: 8.53, provider_id: 'mix' },
      { station_id: 'bike-only:2', name: 'Old stop', lat: 47.39, lon: 8.55, provider_id: 'bike-only' },
    ] } },
    'station_status.json': { last_updated: now, data: { stations: [
      { station_id: 'mix:1', num_bikes_available: 8, is_installed: true, is_renting: true, last_reported: now },
      { station_id: 'bike-only:2', num_bikes_available: 5, is_installed: true, is_renting: true, last_reported: now - 700 },
    ] } },
    'v2/gbfs/mix/station_status': { last_updated: now, data: { stations: [
      { station_id: '1', is_renting: true, last_reported: now, vehicle_types_available: [
        { vehicle_type_id: 'bike', count: 3 }, { vehicle_type_id: 'scoot', count: 5 },
      ] },
    ] } },
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = new URL(String(input), 'https://example.test').searchParams.get('path')!;
    assert.ok(path in fixtures, path);
    return new Response(JSON.stringify(fixtures[path]), { status: 200 });
  };
  try {
    const feed = await loadMobility(new AbortController().signal);
    const central = feed.sites.find(site => site.name === 'Central')!;
    assert.deepEqual(central.counts, { bike: 3, scooter: 5, car: 0, moped: 0 });
    assert.equal(siteCount(central, ['bike']), 3);
    assert.equal(siteCount(central, ['bike', 'scooter']), 8);
    assert.equal(siteCount(feed.sites.find(site => site.name === 'Old stop')!, ['bike']), 1);
    const street = feed.sites.filter(site => site.kind === 'street');
    assert.equal(street.reduce((sum, site) => sum + siteCount(site, ['bike', 'scooter']), 0), 2);
    assert.deepEqual(street.map(site => [site.lat, site.lon]).sort((a, b) => a[0] - b[0]),
      [[47.37, 8.54], [47.3701, 8.5401]]);
  } finally { globalThis.fetch = original; }
});
