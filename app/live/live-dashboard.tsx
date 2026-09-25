'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Map as LeafletMap, LayerGroup, CircleMarker } from 'leaflet';
import { isLiveFeed, measuredMinute, minuteReading, stationHasCount, stationStatus, stationVolume, volumeColor, markerOpacity, readingStatus, type LiveCity, type LiveFeed, type Station } from './live-data';
import styles from './live.module.css';

const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const time = (value: string) => timeFormat.format(new Date(value));
const label = (station: Station) => station.name || `Counter ${station.id}`;
type Bounds = { south: number; north: number; west: number; east: number };

export default function LiveDashboard({ initialCity, cities }: { initialCity: string; cities: LiveCity[] }) {
  const slug = initialCity;
  const router = useRouter();
  const city = cities.find(city => city.slug === slug)!;
  const [feed, setFeed] = useState<LiveFeed | null>(null);
  const [visibleTab, setVisibleTab] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [clock, setClock] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<LayerGroup | null>(null);
  const points = useRef(new Map<string, CircleMarker>());
  const volumes = useRef(new Map<string, number | null>());
  const opacities = useRef(new Map<string, number>());
  const elapsed = useRef<number | null>(null);
  const minute = useMemo(() => feed ? measuredMinute(feed.stations) : 0, [feed]);

  useEffect(() => {
    if (!visibleTab || document.hidden) return;
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 55_000);
    async function refresh() {
      setLoading(true);
      try {
        const response = await fetch('/swiss-commutes/live/feed.php', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Readings unavailable');
        const data: unknown = await response.json();
        if (!isLiveFeed(data)) throw new Error('Invalid readings');
        if (!disposed) { setFeed(data); setFailed(false); }
      } catch {
        // Keep the last received minute on screen; the status line reports the failed refresh.
        if (!disposed) setFailed(true);
      } finally { clearTimeout(timeout); if (!disposed) setLoading(false); }
    }
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => { disposed = true; controller.abort(); clearTimeout(timeout); clearInterval(interval); };
  }, [refreshVersion, visibleTab]);

  useEffect(() => {
    const tick = () => setClock(Date.now());
    tick();
    const interval = window.setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const resume = () => {
      setVisibleTab(!document.hidden);
      if (!document.hidden) setRefreshVersion(value => value + 1);
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
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
      const updateBounds = () => { if (disposed) return; const box = instance.getBounds(); setBounds({ south: box.getSouth(), north: box.getNorth(), west: box.getWest(), east: box.getEast() }); };
      instance.on('moveend', updateBounds);
      resize = new ResizeObserver(() => { if (!disposed) { instance.invalidateSize(); updateBounds(); } });
      resize.observe(container.current);
      updateBounds();
      setMapReady(true);
    }).catch(() => setMapError(true));
    const stationPoints = points.current;
    return () => { disposed = true; resize?.disconnect(); map.current?.remove(); map.current = null; markers.current = null; stationPoints.clear(); };
  // City changes move the existing map below; they do not recreate it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { map.current?.setView([city.centre.lat, city.centre.lon], 10); }, [city]);

  useEffect(() => {
    if (!feed || !mapReady) return;
    let disposed = false;
    import('leaflet').then(L => {
      if (disposed || !markers.current) return;
      const ids = new Set(feed.stations.map(station => station.id));
      for (const [id, point] of points.current) {
        if (!ids.has(id)) { markers.current.removeLayer(point); points.current.delete(id); volumes.current.delete(id); opacities.current.delete(id); }
      }
      for (const station of feed.stations) {
        const volume = stationVolume(station, minute);
        const opacity = Math.round(markerOpacity(volume, elapsed.current) * 64) / 64;
        volumes.current.set(station.id, volume);
        opacities.current.set(station.id, opacity);
        const chosen = station.id === selectedId;
        let point = points.current.get(station.id);
        if (!point) {
          point = L.circleMarker([station.lat, station.lon]).on('click', () => setSelectedId(station.id)).addTo(markers.current);
          points.current.set(station.id, point);
        }
        point.setLatLng([station.lat, station.lon]).setRadius(chosen ? 9 : 5).setStyle({ weight: chosen ? 2 : 1,
          color: chosen ? '#000' : '#fffdf9', fillColor: volumeColor(volume), fillOpacity: opacity });
        const tooltip = document.createElement('span');
        tooltip.textContent = `${label(station)} · ${volume === null ? stationStatus(station, minute) : `${volume} vehicles/min at busiest detector`}`;
        if (point.getTooltip()) point.setTooltipContent(tooltip); else point.bindTooltip(tooltip);
      }
    });
    return () => { disposed = true; };
  }, [feed, minute, mapReady, selectedId]);

  // Blink the markers in view at the rate of the vehicles counted, redrawing only when an opacity changes.
  useEffect(() => {
    if (!mapReady || !visibleTab) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = performance.now();
    let handle = 0;
    let painted = 0;
    const tick = (at: number) => {
      handle = requestAnimationFrame(tick);
      if (at - painted < 50 || !map.current) return;
      painted = at;
      elapsed.current = at - start;
      const view = map.current.getBounds();
      for (const [id, point] of points.current) {
        if (!view.contains(point.getLatLng())) continue;
        const opacity = Math.round(markerOpacity(volumes.current.get(id) ?? null, elapsed.current) * 64) / 64;
        if (opacities.current.get(id) === opacity) continue;
        opacities.current.set(id, opacity);
        point.setStyle({ fillOpacity: opacity });
      }
    };
    handle = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(handle); elapsed.current = null; };
  }, [mapReady, visibleTab]);

  const visible = useMemo(() => feed?.stations.filter(station => bounds && station.lat >= bounds.south && station.lat <= bounds.north &&
    station.lon >= bounds.west && station.lon <= bounds.east).sort((a, b) => label(a).localeCompare(label(b))) ?? [], [feed, bounds]);
  const current = visible.filter(station => stationHasCount(station, minute));
  const selected = feed?.stations.find(station => station.id === selectedId);
  // Healthy collection lags the clock by the source's publication minute; four minutes means it stalled.
  const behind = minute > 0 && clock > 0 && clock - minute > 240_000;

  function changeCity(value: string) {
    if (!cities.some(city => city.slug === value)) return;
    setSelectedId(null);
    router.push(`/live/${value}/`);
  }

  return <main className={styles.page}>
    <header>
      <div className="dp-navbar">
        <div className="dp-navbar-title">
          <Link className="dp-navbar-brand" href="/projects/">Daniel Pradilla</Link>
          <span className="dp-navbar-project">Swiss Commutes <span aria-hidden="true">🇨🇭</span></span>
        </div>
        <nav className="dp-navbar-links" aria-label="Site navigation">
          <Link href="/">Commuting</Link>
          <Link href="/live/">Traffic</Link>
          <Link href="/trains/">Trains</Link>
          <a href="#sources">Sources & method</a>
          <Link href="/blog/">Blog</Link>
          <a href="https://github.com/danielpradilla/swiss-commutes">GitHub</a>
        </nav>
        <details className="dp-navbar-menu">
          <summary aria-label="Menu">☰</summary>
          <nav aria-label="Site navigation (mobile)">
            <Link href="/">Commuting</Link>
            <Link href="/live/">Traffic</Link>
            <Link href="/trains/">Trains</Link>
            <a href="#sources">Sources & method</a>
            <Link href="/blog/">Blog</Link>
            <a href="https://github.com/danielpradilla/swiss-commutes">GitHub</a>
          </nav>
        </details>
      </div>
    </header>
    <section className={styles.heading}>
      <h1>Live traffic in <span className="cityChoice"><select className="citySelect" aria-label="City" value={slug} onChange={event => changeCity(event.target.value)}>
        {cities.map(city => <option key={city.slug} value={city.slug}>{city.displayName}</option>)}
      </select><span aria-hidden="true">⌄</span></span></h1>
      <p>Newest measured minute. Detectors without a count stay grey.</p>
    </section>
    <div className={styles.dashboard}>
      <section className={styles.mapPanel} aria-label={`Live traffic counters around ${city.displayName}`}>
        <div ref={container} className={styles.map} />
        {mapError && <p className={styles.mapMessage}>The map could not load. Readings are available in the station list.</p>}
        {!feed && <p className={styles.mapMessage} role="status">{failed ? 'Live readings are temporarily unavailable. Retrying in a minute.' : 'Connecting to road counters…'}</p>}
        {minute > 0 && <div className={styles.measured} role="status" aria-label="Measured minute">
          <div><span>Measured minute</span><time dateTime={new Date(minute).toISOString()} title={dateFormat.format(new Date(minute))}>{time(new Date(minute).toISOString())}–{time(new Date(minute + 60_000).toISOString())}</time></div>
          {loading && <small>Refreshing…</small>}
        </div>}
        <div className={styles.legend}>
          <span className={styles.legendTitle}>Vehicles/min · busiest detector</span>
          {[0, 10, 20, 30].map(value => <span key={value}><i style={{ background: volumeColor(value) }} />{value === 30 ? '30+' : `${value}–${value + 9}`}</span>)}
          <span><i style={{ background: volumeColor(null) }} /> No total</span>
          <span className={styles.legendTitle}>Markers dim once per vehicle counted per minute: 5/min is 5 dims a minute.</span>
        </div>
      </section>
      <aside className={styles.sidebar}>
        <div className={styles.status}>
          <span className={styles.kicker}>In this view</span>
          <strong>{feed ? current.length : '—'} <small>stations with data</small></strong>
          <p>{feed ? minute > 0 ? `${current.length} of ${visible.length} stations in this view report a count for this minute.`
            : 'No usable counts in the latest collection. Checking again in a minute.' : 'Waiting for the first readings.'}</p>
          {failed && <p role="status">The last refresh failed. Retrying in a minute. Showing the last collected minute.</p>}
          {!failed && behind && <p>Collection is behind. Showing the last collected minute.</p>}
        </div>
        {selected ? <section className={styles.detail} aria-label="Selected counter">
          <button className={styles.back} onClick={() => setSelectedId(null)}>← All stations</button>
          <h2>{label(selected)}</h2>
          <p className={styles.subtle}>{selected.road ? `${selected.road} · ` : ''}{selected.id}</p>
          {selected.detectors.map(detector => {
            const reading = minuteReading(detector.reading, minute);
            return <div className={styles.detector} key={detector.id}>
              <h3>Detector {detector.id.split(':').at(-1)}</h3>
              {reading ? <><p>60 seconds from <time dateTime={reading.at}>{time(reading.at)}</time></p>
                <table><thead><tr><th>Vehicles</th><th>Count</th><th>km/h</th></tr></thead>
                  <tbody><tr><th>Light</th><td>{reading.light ?? '—'}</td><td>{reading.lightSpeed ?? '—'}</td></tr>
                    <tr><th>Heavy goods</th><td>{reading.heavy ?? '—'}</td><td>{reading.heavySpeed ?? '—'}</td></tr></tbody></table>
                {(reading.light === null || reading.heavy === null) && <p>{readingStatus(detector.reading, minute)}</p>}
              </> : <p>{readingStatus(detector.reading, minute)}</p>}
            </div>;
          })}
        </section> : <section className={styles.stations} aria-label="Counting stations">
          <p className={styles.hint}>Select a station to see its counts and speeds.</p>
          {visible.length ? <ul>{visible.map(station => {
            const volume = stationVolume(station, minute);
            return <li key={station.id}><button onClick={() => setSelectedId(station.id)}>
            <span>{label(station)}{station.road && <small>{station.road}</small>}</span>
            <span className={stationHasCount(station, minute) ? styles.available : styles.unavailable}>
              {volume !== null ? `${volume}/min` : stationStatus(station, minute)}
            </span></button></li>;
          })}</ul> : feed && <p>There are no counters from this feed in the current view. Zoom out to see nearby stations.</p>}
        </section>}
        <details id="sources" className={styles.sources}><summary>About these readings</summary>
          <p>ASTRA / FEDRO and participating road authorities count vehicles at fixed sensors. The feed covers equipped roads, not every street or border approach.</p>
          <p>Counts cover a 60-second interval. Speeds are the measured average for that vehicle class. Light vehicles include cars, motorcycles, buses and small delivery vehicles.</p>
          <p>Map colours show the highest vehicle count from a station’s detectors, from green to red. Both vehicle classes must be reported. Grey means no complete count for the displayed minute. Colours show volume, not congestion.</p>
          <p>The map shows the newest measured minute in the feed, refreshed every minute. When the source has not published a newer minute, the map keeps the last minute it collected and the clock still shows that minute. Detectors that report no usable count for it stay grey. Readings are provisional. Zero means none counted.</p>
          <p>Markers dim once per vehicle counted in the displayed minute, so five vehicles a minute means five dims a minute. Dimming stops above 120 vehicles a minute, where markers stay lit, and reduced-motion settings keep every marker steady. The dimming shows the average rate over the minute, not individual vehicles.</p>
          <p>The same vehicle can pass several sensors. These counts cannot be added to calculate a city’s population or number of commuters.</p>
          <a href="https://opentransportdata.swiss/en/cookbook/road-traffic-cookbook/rt-road-traffic-counters/" target="_blank" rel="noreferrer">Source and definitions ↗</a>
        </details>
      </aside>
    </div>
    <footer className="projectFooter">
      <div className="dp-footer">
        <span>© 2026 Daniel Pradilla</span>
        <nav aria-label="Footer navigation">
          <Link href="/">Commuting</Link>
          <Link href="/live/">Traffic</Link>
          <Link href="/trains/">Trains</Link>
          <Link href="/projects/">Projects</Link>
          <Link href="/blog/">Blog</Link>
          <a href="https://github.com/danielpradilla/swiss-commutes">GitHub</a>
        </nav>
      </div>
    </footer>
  </main>;
}
