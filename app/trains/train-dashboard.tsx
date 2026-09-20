'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CircleMarker, LayerGroup, Map as LeafletMap } from 'leaflet';
import { decodePolyline } from '../route-geometry';
import { buildRailIndex, isTrainFeed, trainColor, trainMatches, trainPosition, type RailIndex, type Train, type TrainFeed } from './train-data';
import styles from './trains.module.css';

const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });
const fetched = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
type City = { slug: string; displayName: string; centre: { lat: number; lon: number } };
type Bounds = { south: number; north: number; west: number; east: number };

function delayLabel(delay: number) {
  if (delay === 0) return 'On time';
  return delay > 0 ? `+${delay.toFixed(1)} min` : `${delay.toFixed(1)} min`;
}

export default function TrainDashboard({ initialCity, cities }: { initialCity: string; cities: City[] }) {
  const router = useRouter();
  const city = cities.find(item => item.slug === initialCity)!;
  const [feed, setFeed] = useState<TrainFeed | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(0);
  const [rail, setRail] = useState<{ city: string; index: RailIndex | null }>({ city: '', index: null });
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<LayerGroup | null>(null);
  const points = useRef(new Map<string, CircleMarker>());
  const ripple = useRef<CircleMarker | null>(null);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch(`/swiss-commutes/trains/feed.php?city=${encodeURIComponent(initialCity)}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error();
        const data: unknown = await response.json();
        if (!isTrainFeed(data)) throw new Error();
        if (!disposed) { setFeed(data); setError(''); setLoading(false); }
      } catch {
        if (!disposed) { setError('Live train updates are temporarily unavailable.'); setLoading(false); }
      }
    }
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => { disposed = true; controller.abort(); clearInterval(interval); };
  }, [initialCity]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/swiss-commutes/trains/${encodeURIComponent(initialCity)}/rail.json`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then((data: { segments?: unknown }) => {
        if (!Array.isArray(data.segments) || !data.segments.every(value => typeof value === 'string')) throw new Error();
        setRail({ city: initialCity, index: buildRailIndex(data.segments.map(value => decodePolyline(value))) });
      }).catch(() => { if (!controller.signal.aborted) setRail({ city: initialCity, index: null }); });
    return () => controller.abort();
  }, [initialCity]);

  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    import('leaflet').then(L => {
      if (disposed || !container.current) return;
      const instance = L.map(container.current, { preferCanvas: true, zoomControl: false, scrollWheelZoom: false, minZoom: 7, maxZoom: 17 });
      map.current = instance;
      instance.setView([city.centre.lat, city.centre.lon], 10);
      L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', {
        maxZoom: 20, attribution: '&copy; <a href="https://stadiamaps.com/attribution/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(instance);
      L.control.zoom({ position: 'topright' }).addTo(instance);
      L.control.scale({ position: 'bottomright', imperial: false }).addTo(instance);
      markers.current = L.layerGroup().addTo(instance);
      const updateBounds = () => { const box = instance.getBounds(); setBounds({ south: box.getSouth(), north: box.getNorth(), west: box.getWest(), east: box.getEast() }); };
      instance.on('moveend', updateBounds);
      resize = new ResizeObserver(() => { instance.invalidateSize(); updateBounds(); });
      resize.observe(container.current);
      updateBounds();
      setMapReady(true);
    }).catch(() => setMapError(true));
    const trainPoints = points.current;
    return () => { disposed = true; resize?.disconnect(); map.current?.remove(); map.current = null; markers.current = null; ripple.current = null; trainPoints.clear(); };
  // City changes move the existing map below; they do not recreate it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { map.current?.setView([city.centre.lat, city.centre.lon], 10); }, [city]);

  const railIndex = rail.city === initialCity ? rail.index : null;
  const positions = useMemo(() => new Map(feed?.trains.map(train => [train.tripId, trainPosition(train, now, railIndex)]) ?? []), [feed, now, railIndex]);

  useEffect(() => {
    if (!feed || !mapReady) return;
    let disposed = false;
    import('leaflet').then(L => {
      if (disposed || !markers.current) return;
      const ids = new Set(feed.trains.map(train => train.tripId));
      for (const [id, point] of points.current) {
        if (!ids.has(id)) { markers.current.removeLayer(point); points.current.delete(id); }
      }
      for (const train of feed.trains) {
        const position = positions.get(train.tripId)!;
        const chosen = selectedId === train.tripId;
        const match = trainMatches(train, query);
        let point = points.current.get(train.tripId);
        if (!point) {
          point = L.circleMarker(position).on('click', () => setSelectedId(train.tripId)).addTo(markers.current);
          points.current.set(train.tripId, point);
        }
        point.setLatLng(position).setRadius(chosen ? 10 : query && match ? 8 : 5).setStyle({ weight: chosen || (query && match) ? 2 : 1,
          color: chosen || (query && match) ? '#000' : '#fffdf9', fillColor: trainColor(train.nextStation.delayMinutes, train.cancelled),
          fillOpacity: query && !match ? .15 : .95 });
        const tooltip = document.createElement('span');
        tooltip.textContent = `${train.line || 'Train'} ${train.trainNumber} → ${train.nextStation.name} · ${train.cancelled ? 'Cancelled' : delayLabel(train.nextStation.delayMinutes)}`;
        if (point.getTooltip()) point.setTooltipContent(tooltip); else point.bindTooltip(tooltip);
      }
    });
    return () => { disposed = true; };
  }, [feed, mapReady, positions, selectedId, query]);

  useEffect(() => {
    if (!mapReady || !map.current) return;
    const train = feed?.trains.find(item => item.tripId === hoveredId);
    const position = hoveredId ? positions.get(hoveredId) : null;
    if (!train || !position) {
      if (ripple.current) map.current.removeLayer(ripple.current);
      ripple.current = null;
      return;
    }
    let disposed = false;
    import('leaflet').then(L => {
      if (disposed || !map.current) return;
      if (!ripple.current) ripple.current = L.circleMarker(position, { renderer: L.svg(), radius: 8, weight: 2, fill: false, interactive: false,
        color: trainColor(train.nextStation.delayMinutes, train.cancelled), className: 'train-ripple' }).addTo(map.current);
      else ripple.current.setLatLng(position).setStyle({ color: trainColor(train.nextStation.delayMinutes, train.cancelled) });
    });
    return () => { disposed = true; };
  }, [feed, hoveredId, mapReady, positions]);

  const visible = useMemo(() => feed?.trains.filter(train => {
    const [lat, lon] = positions.get(train.tripId)!;
    return bounds && lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
  }).sort((a, b) => a.nextStation.estimatedAt.localeCompare(b.nextStation.estimatedAt)) ?? [], [feed, positions, bounds]);
  const selected = feed?.trains.find(train => train.tripId === selectedId);
  const filtered = visible.filter(train => trainMatches(train, query));

  function changeCity(slug: string) {
    if (!cities.some(item => item.slug === slug)) return;
    setSelectedId(null);
    setQuery('');
    router.push(`/trains/${slug}/`);
  }

  function trainRow(train: Train) {
    return <button onMouseEnter={() => setHoveredId(train.tripId)} onMouseLeave={() => setHoveredId(null)}
      onFocus={() => setHoveredId(train.tripId)} onBlur={() => setHoveredId(null)} onClick={() => { setHoveredId(null); setSelectedId(train.tripId); }}>
      <span><strong>{train.line || 'Train'} {train.trainNumber}</strong><small>Next: {train.nextStation.name} at {time.format(new Date(train.nextStation.estimatedAt))}</small></span>
      <span className={train.cancelled || train.nextStation.delayMinutes > 1 ? styles.late : styles.onTime}>{train.cancelled ? 'Cancelled' : delayLabel(train.nextStation.delayMinutes)}</span>
    </button>;
  }

  return <main className={styles.page}>
    <header>
      <div className="dp-navbar">
        <div className="dp-navbar-title">
          <Link className="dp-navbar-brand" href="/projects/">Daniel Pradilla</Link>
          <span className="dp-navbar-project">Swiss Commutes <span aria-hidden="true">🇨🇭</span></span>
        </div>
        <nav className="dp-navbar-links" aria-label="Site navigation">
          <a href="#sources">Sources & method</a>
          <a href="/blog/">Blog</a>
          <a href="https://github.com/danielpradilla/swiss-commutes">GitHub</a>
        </nav>
        <details className="dp-navbar-menu">
          <summary aria-label="Menu">☰</summary>
          <nav aria-label="Site navigation (mobile)">
            <a href="#sources">Sources & method</a>
            <a href="/blog/">Blog</a>
            <a href="https://github.com/danielpradilla/swiss-commutes">GitHub</a>
          </nav>
        </details>
      </div>
    </header>
    <section className={styles.heading}>
      <h1>Live trains around <span className="cityChoice"><select className="citySelect" aria-label="City" value={initialCity} onChange={event => changeCity(event.target.value)}>
        {cities.map(item => <option key={item.slug} value={item.slug}>{item.displayName}</option>)}
      </select><span aria-hidden="true">⌄</span></span></h1>
      <p>{feed ? <>Updated <time dateTime={feed.fetchedAt}>{fetched.format(new Date(feed.fetchedAt))}</time></> : loading ? 'Connecting to the live timetable…' : 'No current update'}</p>
    </section>
    <div className={styles.dashboard}>
      <section className={styles.mapPanel} aria-label={`Estimated live train positions around ${city.displayName}`}>
        <div ref={container} className={styles.map} />
        {mapError && <p className={styles.mapMessage}>The map could not load. Trains are available in the list.</p>}
        {!feed && <p className={styles.mapMessage} role="status">{error || 'Connecting to live trains…'}</p>}
        <div className={styles.legend}>
          <span className={styles.legendTitle}>Delay at next stop</span>
          <span><i style={{ background: trainColor(0) }} /> 0–1 min</span>
          <span><i style={{ background: trainColor(3) }} /> 1–5 min</span>
          <span><i style={{ background: trainColor(6) }} /> 5+ min</span>
          <span><i style={{ background: trainColor(0, true) }} /> Cancelled</span>
        </div>
      </section>
      <aside className={styles.sidebar}>
        <div className={styles.status}>
          <span className={styles.kicker}>In this view</span>
          <strong>{feed ? visible.length : '—'} <small>trains</small></strong>
          <p>Dots move on the project’s rail geometry between the last and next stop, adjusted with the latest reported delay.</p>
          {error && <p role="status">{error}</p>}
        </div>
        <label className={styles.search}>Find a train
          <input type="search" value={query} placeholder="Line, train or next stop" onChange={event => { setQuery(event.target.value); setSelectedId(null); }} />
        </label>
        {selected ? <section className={styles.detail} aria-label="Selected train">
          <button className={styles.back} onClick={() => setSelectedId(null)}>← All trains</button>
          <h2>{selected.line || 'Train'} {selected.trainNumber}</h2>
          <p className={styles.subtle}>Train {selected.trainNumber}</p>
          <dl>
            <div><dt>Next stop</dt><dd>{selected.nextStation.name}</dd></div>
            <div><dt>Estimated</dt><dd>{time.format(new Date(selected.nextStation.estimatedAt))}</dd></div>
            <div><dt>Delay</dt><dd>{selected.cancelled ? 'Cancelled' : delayLabel(selected.nextStation.delayMinutes)}</dd></div>
          </dl>
        </section> : <section className={styles.trains} aria-label="Trains in this map view">
          <p className={styles.hint}>Select a train to see its next stop.</p>
          {filtered.length ? <ul>{filtered.map(train => <li key={train.tripId}>{trainRow(train)}</li>)}</ul>
            : feed && <p>{query ? 'No trains match this search in the current map view.' : 'No current trains in this map view. Zoom out to see more.'}</p>}
        </section>}
        <details id="sources" className={styles.sources}><summary>About these positions</summary>
          <p>The live source provides timetable updates and delays, not train GPS or track shapes. Positions are estimated from delay-adjusted times and snapped to the project’s ARE NPVM 2023 rail geometry. Where that network has no nearby track, the dot stays at the nearer timetable stop.</p>
          <p>Coverage depends on each operator. Trips without a realtime update for their next stop are not shown.</p>
          <a href="https://opentransportdata.swiss/en/cookbook/realtime-prediction-cookbook/gtfs-rt/" target="_blank" rel="noreferrer">Source and definitions ↗</a>
        </details>
      </aside>
    </div>
    <footer className="projectFooter">
      <div className="dp-footer">
        <span>© 2026 Daniel Pradilla</span>
        <nav aria-label="Footer navigation">
          <a href="/projects/">Projects</a>
          <a href="/blog/">Blog</a>
          <a href="https://github.com/danielpradilla/swiss-commutes">GitHub</a>
        </nav>
      </div>
    </footer>
  </main>;
}
