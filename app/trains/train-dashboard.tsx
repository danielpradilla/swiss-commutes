'use client';

import { useRouter } from 'next/navigation';
import SiteNavigation from '../components/site-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CircleMarker, LayerGroup, Map as LeafletMap } from 'leaflet';
import { mercatorToLatLng, parseTrackContext, parseTransitFeed, parseTrip, vehicleColor, vehicleLabel, vehicleMatches, vehiclePosition, vehicleRadius, vehiclesForView } from './train-data';
import type { TransitFeed, TransitPoint, TransitView, Trip, Vehicle, VehicleMode } from './train-data';
import { createNetworkLayer } from './network-layer';
import type { NetworkLayer, NetworkStatus } from './network-layer';
import styles from './trains.module.css';

const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });
const fetched = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const modes: { mode: VehicleMode; label: string }[] = [{ mode: 'rail', label: 'Trains' }, { mode: 'tram', label: 'Trams' }, { mode: 'bus', label: 'Buses' }];
const modeName = { rail: 'Train', tram: 'Tram', bus: 'Bus' };
const endpoint = '/projects/swiss-commutes/trains/feed.php';
const trackStyle = { color: '#8c969b', weight: 1.5, opacity: .55 };
const tripStyle = { color: '#17384d', weight: 4, opacity: .9 };
type City = { slug: string; displayName: string; centre: { lat: number; lon: number } };
type Bounds = { south: number; north: number; west: number; east: number };

function delayLabel(delay: number | null) {
  if (delay === null) return 'Scheduled only';
  if (Math.abs(delay) < .1) return 'On time';
  return `${delay > 0 ? '+' : ''}${delay.toFixed(1)} min`;
}

export default function TransitDashboard({ initialCity, cities, view }: { initialCity: string; cities: City[]; view: TransitView }) {
  const router = useRouter();
  const city = cities.find(item => item.slug === initialCity)!;
  const railOnly = view === 'trains';
  const vehicleNoun = railOnly ? 'trains' : 'vehicles';
  const [feed, setFeed] = useState<TransitFeed | null>(null);
  const [error, setError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [zoom, setZoom] = useState(12);
  const [selection, setSelection] = useState<Vehicle | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [enabled, setEnabled] = useState<VehicleMode[]>(['rail', 'tram', 'bus']);
  const [now, setNow] = useState(0);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tripError, setTripError] = useState('');
  const [tracks, setTracks] = useState<TransitPoint[][]>([]);
  const [tracksError, setTracksError] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('loading');
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<LayerGroup | null>(null);
  const route = useRef<LayerGroup | null>(null);
  const context = useRef<LayerGroup | null>(null);
  const network = useRef<NetworkLayer | null>(null);
  const points = useRef(new Map<string, CircleMarker>());

  useEffect(() => {
    let disposed = false;
    let timeout: number | undefined;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch(`${endpoint}?city=${encodeURIComponent(initialCity)}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = parseTransitFeed(await response.json());
        if (data.city !== initialCity) throw new Error();
        if (!disposed) { setFeed(data); setError(''); }
      } catch {
        if (!disposed) setError('Transit updates are temporarily unavailable.');
      } finally {
        if (!disposed) timeout = window.setTimeout(refresh, 15_000);
      }
    }
    void refresh();
    return () => { disposed = true; controller.abort(); clearTimeout(timeout); };
  }, [initialCity]);

  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    const controller = new AbortController();
    import('leaflet').then(L => {
      if (disposed || !container.current) return;
      const instance = L.map(container.current, { preferCanvas: true, zoomControl: false, minZoom: 7, maxZoom: 17 });
      map.current = instance;
      instance.setView([city.centre.lat, city.centre.lon], 12);
      L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', {
        maxZoom: 20, attribution: '&copy; <a href="https://stadiamaps.com/attribution/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Transit: <a href="https://developer.geops.io/apis/realtime/">geOps</a> / SBB',
      }).addTo(instance);
      L.control.zoom({ position: 'topright' }).addTo(instance);
      L.control.scale({ position: 'bottomright', imperial: false }).addTo(instance);
      // Share the interactive canvas so vehicle rendering cannot mask route clicks.
      for (const [name, zIndex] of [['transit-context', 410], ['transit-vehicles', 430]] as const) {
        const pane = instance.createPane(name);
        pane.style.zIndex = String(zIndex);
        if (name === 'transit-context') pane.style.pointerEvents = 'none';
      }
      markers.current = L.layerGroup().addTo(instance);
      route.current = L.layerGroup().addTo(instance);
      context.current = L.layerGroup().addTo(instance);
      if (railOnly) {
        fetch(`/projects/swiss-commutes/trains/${encodeURIComponent(initialCity)}/tracks.json`, { signal: controller.signal })
          .then(response => { if (!response.ok) throw new Error(); return response.json(); })
          .then(data => { const lines = parseTrackContext(data); if (!disposed) setTracks(lines); })
          .catch(() => { if (!disposed) setTracksError(true); });
      } else {
        network.current = createNetworkLayer(L, initialCity, enabled, value => { if (!disposed) setNetworkStatus(value); }).addTo(instance);
      }
      const updateBounds = () => {
        const box = instance.getBounds();
        setBounds({ south: box.getSouth(), north: box.getNorth(), west: box.getWest(), east: box.getEast() });
        setZoom(instance.getZoom());
      };
      instance.on('moveend', updateBounds);
      instance.on('click', () => setSelection(null));
      resize = new ResizeObserver(() => { instance.invalidateSize(); updateBounds(); });
      resize.observe(container.current);
      updateBounds();
      setMapReady(true);
    }).catch(() => setMapError(true));
    const trainPoints = points.current;
    return () => { disposed = true; controller.abort(); resize?.disconnect(); map.current?.remove(); map.current = null; markers.current = null; route.current = null; context.current = null; network.current = null; trainPoints.clear(); };
  // The city page remounts this map when its city changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vehicles = useMemo(() => vehiclesForView(feed?.vehicles ?? [], view).filter(vehicle => railOnly || enabled.includes(vehicle.mode)), [feed, view, railOnly, enabled]);
  const selected = selection && (!railOnly || selection.mode === 'rail') ? vehicles.find(vehicle => vehicle.id === selection.id) ?? selection : null;
  const selectedId = selected?.id ?? null;
  const currentTrip = trip?.vehicleId === selectedId ? trip : null;

  useEffect(() => {
    if (!railOnly || !mapReady || !context.current) return;
    context.current.clearLayers();
    let disposed = false;
    import('leaflet').then(L => {
      if (disposed || !context.current) return;
      for (const line of tracks) L.polyline(line, { pane: 'transit-context', ...trackStyle, interactive: false }).addTo(context.current);
    });
    return () => { disposed = true; };
  }, [tracks, railOnly, mapReady]);

  useEffect(() => {
    if (railOnly || !mapReady || !network.current || !map.current) return;
    network.current.setModes(enabled);
    if (selectedId || !enabled.length) network.current.remove();
    else if (!map.current.hasLayer(network.current)) network.current.addTo(map.current);
  }, [enabled, selectedId, railOnly, mapReady]);

  const selectVehicle = useCallback((vehicle: Vehicle) => {
    if (!railOnly) network.current?.remove();
    setSelection(vehicle);
    setHoveredId(null);
  }, [railOnly]);

  useEffect(() => {
    if (!mapReady) return;
    let disposed = false;
    import('leaflet').then(L => {
      if (disposed || !markers.current) return;
      const ids = new Set(vehicles.map(vehicle => vehicle.id));
      for (const [id, point] of points.current) {
        if (!ids.has(id)) { markers.current.removeLayer(point); points.current.delete(id); }
      }
      for (const vehicle of vehicles) {
        const chosen = selectedId === vehicle.id || hoveredId === vehicle.id;
        const match = vehicleMatches(vehicle, query);
        let point = points.current.get(vehicle.id);
        if (!point) {
          point = L.circleMarker(vehiclePosition(vehicle, Date.now()), { pane: 'transit-vehicles', bubblingMouseEvents: false }).on('click', () => selectVehicle(vehicle)).addTo(markers.current);
          points.current.set(vehicle.id, point);
        }
        point.setRadius(vehicleRadius(vehicle.mode, zoom)).setStyle({ weight: chosen ? 2 : 1,
          color: chosen ? '#000' : '#fffdf9', fillColor: vehicleColor(vehicle.delayMinutes, vehicle.cancelled),
          fillOpacity: query && !match ? .15 : .95, dashArray: vehicle.realtime ? undefined : '2 2' });
        const label = document.createElement('span');
        label.textContent = zoom >= 14 || chosen ? vehicle.line || vehicle.number || modeName[vehicle.mode] : `${vehicleLabel(vehicle)} · ${delayLabel(vehicle.delayMinutes)}`;
        point.unbindTooltip().bindTooltip(label, { permanent: zoom >= 14 || chosen, direction: 'top', className: 'transit-line-label', opacity: query && !match ? .25 : 1 });
      }
    });
    return () => { disposed = true; };
  }, [vehicles, mapReady, selectedId, hoveredId, query, zoom, selectVehicle]);

  useEffect(() => {
    if (!mapReady || !vehicles.length) return;
    let frame = 0;
    let previous = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animate = (stamp: number) => {
      if (stamp - previous >= (reducedMotion.matches ? 1_000 : 33)) {
        previous = stamp;
        const clock = Date.now();
        for (const vehicle of vehicles) points.current.get(vehicle.id)?.setLatLng(vehiclePosition(vehicle, clock));
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [vehicles, mapReady]);

  useEffect(() => {
    if (!selectedId) return;
    let disposed = false;
    let timeout: number | undefined;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch(`${endpoint}?city=${encodeURIComponent(initialCity)}&vehicle=${encodeURIComponent(selectedId!)}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = parseTrip(await response.json());
        if (data.vehicleId !== selectedId) throw new Error();
        if (!disposed) { setTrip(data); setTripError(''); }
      } catch {
        if (!disposed) setTripError('This trip’s route and stops are temporarily unavailable.');
      } finally {
        if (!disposed) timeout = window.setTimeout(refresh, 15_000);
      }
    }
    const first = setTimeout(() => { setTripError(''); void refresh(); }, 0);
    return () => { disposed = true; controller.abort(); clearTimeout(first); clearTimeout(timeout); };
  }, [initialCity, selectedId]);

  useEffect(() => {
    if (!mapReady) return;
    route.current?.clearLayers();
    let disposed = false;
    import('leaflet').then(L => {
      if (disposed || !route.current) return;
      route.current.clearLayers();
      if (!currentTrip) return;
      for (const line of currentTrip.lines) L.polyline(line, { pane: 'transit-vehicles', ...tripStyle, bubblingMouseEvents: false })
        .on('click', event => L.DomEvent.stopPropagation(event.originalEvent)).addTo(route.current);
      for (const stop of currentTrip.stops) {
        if (!stop.coordinate) continue;
        const label = document.createElement('span');
        label.textContent = stop.name;
        L.circleMarker(stop.coordinate, { pane: 'transit-vehicles', radius: 3, weight: 1, color: tripStyle.color, fillColor: '#fffdf9', fillOpacity: 1, bubblingMouseEvents: false })
          .on('click', event => L.DomEvent.stopPropagation(event.originalEvent)).bindTooltip(label).addTo(route.current);
      }
      for (const point of points.current.values()) point.bringToFront();
    });
    return () => { disposed = true; };
  }, [currentTrip, mapReady]);

  const positions = useMemo(() => new Map(vehicles.map(vehicle => [vehicle.id, vehiclePosition(vehicle, now)])), [vehicles, now]);
  const visible = useMemo(() => vehicles.filter(vehicle => {
    const [lat, lon] = positions.get(vehicle.id)!;
    return !bounds || (lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east);
  }).sort((a, b) => a.line.localeCompare(b.line, undefined, { numeric: true }) || a.number.localeCompare(b.number, undefined, { numeric: true })), [vehicles, positions, bounds]);
  const filtered = visible.filter(vehicle => vehicleMatches(vehicle, query));
  const stale = !!feed && now - Date.parse(feed.fetchedAt) > 30_000;
  const coverage = feed ? [mercatorToLatLng([feed.coverage[0], feed.coverage[1]]), mercatorToLatLng([feed.coverage[2], feed.coverage[3]])] : null;
  const outsideCoverage = !!coverage && !!bounds && (bounds.south < coverage[0][0] || bounds.west < coverage[0][1] || bounds.north > coverage[1][0] || bounds.east > coverage[1][1]);
  const nextStopIndex = currentTrip?.stops.findIndex(stop => !stop.cancelled && Date.parse(stop.departureAt ?? stop.arrivalAt ?? '') >= now) ?? -1;

  function fitRoute() {
    if (!currentTrip || !map.current) return;
    const coordinates = currentTrip.lines.flat();
    if (coordinates.length) map.current.fitBounds(coordinates, { padding: [30, 30], maxZoom: 14 });
  }

  function vehicleRow(vehicle: Vehicle) {
    return <button onMouseEnter={() => setHoveredId(vehicle.id)} onMouseLeave={() => setHoveredId(null)}
      onFocus={() => setHoveredId(vehicle.id)} onBlur={() => setHoveredId(null)} onClick={() => selectVehicle(vehicle)}>
      <span><strong>{vehicleLabel(vehicle)}</strong><small>{modeName[vehicle.mode]} · {vehicle.realtime ? 'Timetable with live updates' : 'Scheduled timetable'}</small></span>
      <span className={vehicle.cancelled || (vehicle.delayMinutes ?? 0) > 1 ? styles.late : styles.onTime}>{vehicle.cancelled ? 'Cancelled' : delayLabel(vehicle.delayMinutes)}</span>
    </button>;
  }

  return <main className={styles.page}>
    <header>
      <div className="dp-navbar">
        <div className="dp-navbar-title">
          <a className="dp-navbar-brand" href="https://www.danielpradilla.info/projects/">Daniel Pradilla</a>
          <span className="dp-navbar-project">Swiss Commutes <span aria-hidden="true">🇨🇭</span></span>
        </div>
        <nav className="dp-navbar-links" aria-label="Site navigation">
          <SiteNavigation active={view} />
        </nav>
        <details className="dp-navbar-menu">
          <summary aria-label="Menu">☰</summary>
          <nav aria-label="Site navigation (mobile)">
            <SiteNavigation active={view} />
          </nav>
        </details>
      </div>
    </header>
    <section className={styles.heading}>
      <h1>{railOnly ? 'Trains' : 'Public transport'} around <span className="cityChoice"><select className="citySelect" aria-label="City" value={initialCity} onChange={event => router.push(`/${view}/${event.target.value}/`)}>
        {cities.map(item => <option key={item.slug} value={item.slug}>{item.displayName}</option>)}
      </select><span aria-hidden="true">⌄</span></span></h1>
      <p className={`${styles.freshness} ${stale ? styles.stale : ''}`} role="status">{feed ? <>{stale ? 'Stale update' : 'Updated'} · <time dateTime={feed.fetchedAt}>{fetched.format(new Date(feed.fetchedAt))}</time></> : error ? 'No current update' : 'Connecting to the timetable…'}{!railOnly && <> · {selectedId ? 'Network hidden for selected trip' : !enabled.length ? 'Network modes disabled' : networkStatus === 'ready' ? 'Mapped network loaded' : networkStatus === 'unavailable' ? 'Mapped network unavailable' : 'Loading mapped network…'}</>}</p>
    </section>
    <div className={styles.dashboard}>
      <section className={styles.mapPanel} aria-label={`Estimated ${railOnly ? 'train' : 'train, tram and bus'} positions around ${city.displayName}`}>
        <div ref={container} className={styles.map} />
        {mapError && <p className={styles.mapMessage}>The map could not load. {railOnly ? 'Trains' : 'Vehicles'} are available in the list.</p>}
        {!feed && <p className={styles.mapMessage} role="status">{error || `Connecting to ${railOnly ? 'trains' : 'trains, trams and buses'}…`}</p>}
        {outsideCoverage && <p className={styles.mapMessage}>Regional coverage only. Choose another city to explore further away.</p>}
        <div className={styles.legend}>
          <span className={styles.legendTitle}>Reported delay · positions are estimates</span>
          <span><i style={{ background: vehicleColor(0) }} /> 0–1 min</span>
          <span><i style={{ background: vehicleColor(3) }} /> 1–5 min</span>
          <span><i style={{ background: vehicleColor(6) }} /> 5+ min</span>
          <span><i style={{ background: vehicleColor(null) }} /> Scheduled only</span>
          <span><i style={{ background: vehicleColor(0, true) }} /> Cancelled</span>
          {!railOnly && <div className={styles.sizeLegend}>{modes.map(({ mode, label }) => <span key={mode}><i aria-hidden="true" style={{ width: vehicleRadius(mode, zoom) * 2, height: vehicleRadius(mode, zoom) * 2 }} />{label}</span>)}</div>}
          <div className={styles.routeContextLegend}>{(railOnly || !selectedId) && <span><i aria-hidden="true" style={{ background: trackStyle.color, opacity: trackStyle.opacity, height: trackStyle.weight }} />{railOnly ? 'Rail network (ARE 2023, partial)' : 'Mapped route network'}</span>}{!!currentTrip?.lines.length && <span><i aria-hidden="true" style={{ background: tripStyle.color, opacity: tripStyle.opacity, height: tripStyle.weight }} />Selected trip</span>}</div>
        </div>
      </section>
      <aside className={styles.sidebar}>
        {!railOnly && <div className={styles.filters} role="group" aria-label="Transport modes">
          {modes.map(({ mode, label }) => <button key={mode} aria-pressed={enabled.includes(mode)} onClick={() => {
            setEnabled(current => current.includes(mode) ? current.filter(value => value !== mode) : [...current, mode]);
            if (selection?.mode === mode && enabled.includes(mode)) setSelection(null);
          }}>{label}</button>)}
        </div>}
        <div className={styles.status}>
          <span className={styles.kicker}>In this view</span>
          <strong>{feed ? visible.length : '—'} <small>{vehicleNoun}</small></strong>
          <p>Estimated positions follow the supplied {railOnly ? 'rail' : 'road or rail'} route. Updates arrive every 15 seconds; movement is animated between updates.</p>
          {railOnly && tracksError && <p className={styles.hint} role="status">Rail track context is unavailable. Train positions remain available.</p>}
          {!railOnly && !selectedId && !!enabled.length && networkStatus !== 'ready' && <p className={styles.hint} role="status">{networkStatus === 'unavailable' ? 'Mapped route network is temporarily unavailable. Vehicle positions remain available.' : 'Loading mapped route network independently of vehicle updates…'}</p>}
          {error && <p role="status">{error}</p>}
        </div>
        <label className={styles.search}>Find a {railOnly ? 'train' : 'vehicle'}
          <input type="search" value={query} placeholder={railOnly ? 'Line or train number' : 'Line, train number or mode'} onChange={event => { setQuery(event.target.value); setSelection(null); }} />
        </label>
        {selected ? <section className={styles.detail} aria-label={`Selected ${railOnly ? 'train' : 'vehicle'}`}>
          <button className={styles.back} onClick={() => setSelection(null)}>← All {vehicleNoun}</button>
          <h2>{vehicleLabel(selected)}</h2>
          <p className={styles.modeLabel}>{modeName[selected.mode]} · {selected.cancelled ? 'Cancelled' : delayLabel(selected.delayMinutes)}</p>
          {currentTrip ? <>
            <p className={styles.subtle}>To {currentTrip.destination || 'the final stop'}{currentTrip.operator ? ` · ${currentTrip.operator}` : ''}</p>
            <p className={styles.freshness}>{now - Date.parse(currentTrip.fetchedAt) > 30_000 ? 'Stale trip update' : 'Trip updated'} · {fetched.format(new Date(currentTrip.fetchedAt))}</p>
            <button className={styles.routeAction} onClick={fitRoute} disabled={!currentTrip.lines.length}>Show whole route</button>
            {!currentTrip.lines.length && <p className={styles.hint}>Route geometry is unavailable for this trip.</p>}
            <ol className={styles.stopList} aria-label="Trip stops">
              {currentTrip.stops.map((stop, index) => {
                const estimated = stop.departureAt ?? stop.arrivalAt;
                const scheduled = stop.scheduledDepartureAt ?? stop.scheduledArrivalAt;
                const delay = estimated && scheduled ? (Date.parse(estimated) - Date.parse(scheduled)) / 60_000 : null;
                const past = estimated ? Date.parse(estimated) < now : false;
                return <li key={`${index}:${stop.name}`} className={index === nextStopIndex ? styles.selectedStop : past ? styles.pastStop : ''}>
                  <button disabled={!stop.coordinate} onClick={() => { if (stop.coordinate) map.current?.setView(stop.coordinate, Math.max(map.current.getZoom(), 14)); }} aria-current={index === nextStopIndex ? 'step' : undefined}>
                    <span className={styles.stopTime}>{estimated ? time.format(new Date(estimated)) : '—'}</span>
                    <span>{stop.name}<small>{stop.cancelled ? 'Cancelled stop' : selected.realtime ? delayLabel(delay) : 'Scheduled'}{stop.platform ? ` · Platform ${stop.platform}` : ''}</small></span>
                  </button>
                </li>;
              })}
            </ol>
            {!currentTrip.stops.length && <p className={styles.hint}>No stop sequence is available for this trip.</p>}
          </> : !tripError && <p role="status" className={styles.hint}>Loading {railOnly ? 'train ' : ''}route and stops…</p>}
          {tripError && <p role="status" className={styles.hint}>{tripError}</p>}
        </section> : <section className={styles.trains} aria-label={`${railOnly ? 'Trains' : 'Vehicles'} in this map view`}>
          <p className={styles.hint}>Select a {railOnly ? 'train' : 'vehicle'} to see its full route and stops. Zoom in for line labels.</p>
          {filtered.length ? <ul>{filtered.map(vehicle => <li key={vehicle.id}>{vehicleRow(vehicle)}</li>)}</ul>
            : feed && <p>{!railOnly && !enabled.length ? 'Enable a transport mode to show vehicles.' : query ? `No ${vehicleNoun} match this search in the current map view.` : `No current ${vehicleNoun} in this map view.`}</p>}
        </section>}
      </aside>
    </div>
    <section className="method" id="sources">
      <div className="methodIntro">
        <p className="eyebrow">Timetable updates · estimated positions</p>
        <h2>About the {railOnly ? 'train' : 'public transport'} data</h2>
        <p>geOps supplies {railOnly ? 'Swiss train' : 'Swiss train, tram and bus'} trajectories derived from timetables and available realtime updates. The moving markers are estimated positions, not a guarantee of measured GPS locations.</p>
      </div>
      <div className="sourceGrid">
        <a href="https://developer.geops.io/apis/realtime/" target="_blank" rel="noreferrer">
          <span>01 · Trajectories & trips</span><strong>geOps Realtime API</strong>
          <p>Timed route geometry, complete trip paths and ordered stop sequences. The server keeps its API key private and shares cached updates between visitors.</p>
        </a>
        <a href="https://opentransportdata.swiss/" target="_blank" rel="noreferrer">
          <span>02 · Swiss timetable</span><strong>Swiss public transport / SBB</strong>
          <p>Scheduled services and operator-reported timetable updates. Availability varies by operator and service.</p>
        </a>
        <a href={railOnly ? 'https://zenodo.org/records/18486217' : 'https://developer.geops.io/apis/maps/'} target="_blank" rel="noreferrer">
          <span>03 · Route context</span><strong>{railOnly ? 'ARE rail network · 2023' : 'geOps Maps / OpenStreetMap network'}</strong>
          <p>{railOnly ? 'Neutral tracks show the partial ARE 2023 network used by this project, not all Swiss rail tracks.' : 'Grey lines show mapped train, tram and bus routes from geOps Maps / OpenStreetMap, filtered by the enabled modes. OpenStreetMap route coverage is partial and varies by area and operator.'} The darker selected line shows only that vehicle’s complete trip.</p>
        </a>
      </div>
      <div className="methodNote">
        <strong>How to read the map</strong>
        <div>
          <p>Each city shares a fixed regional feed, extending 80 km in each direction in Web Mercator coordinates (roughly 55 km on the ground). Panning changes the visible count within that region; choose another city to explore further away.</p>
          <p>The browser moves each marker along the supplied path using its timed progress points. It holds the first or last known path position outside that time window, until the next update arrives. Grey markers have scheduled times without realtime journey updates.</p>
          {!railOnly && <p>The grey mapped network is independent of active vehicles and their current route segments; it is not a guarantee of the path used during a diversion. Selecting a vehicle hides that background and shows its complete journey from the supplied trip data.</p>}
          <p>The update time records a successful upstream fetch. A failed refresh retains the last valid data without changing that time; stale updates are labelled. Stop times are shown in Swiss local time. Data coverage is not proof that every vehicle running is represented.</p>
        </div>
      </div>
    </section>
    <footer className="projectFooter">
      <div className="dp-footer">
        <span>© 2026 Daniel Pradilla</span>
        <nav aria-label="Footer navigation">
          <SiteNavigation active={view} />
          <a href="https://www.danielpradilla.info/projects/">Projects</a>
        </nav>
      </div>
    </footer>
  </main>;
}
