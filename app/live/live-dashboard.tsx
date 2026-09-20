'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Map as LeafletMap, LayerGroup, CircleMarker } from 'leaflet';
import { currentReading, stationIsCurrent, stationVolume, volumeColor, isReplayFeed, replayStations, availableFrameIndices, frameCollected, detectorStatus, stationStatus, type LiveCity, type ReplayFeed, type Station } from './live-data';
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
  const [replay, setReplay] = useState<ReplayFeed | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visibleTab, setVisibleTab] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<LayerGroup | null>(null);
  const points = useRef(new Map<string, CircleMarker>());
  const refreshAfter = useRef(0);
  const availableFrames = useMemo(() => {
    if (!replay) return [];
    const ids = new Set(replay.stations.filter(station => !bounds || (station.lat >= bounds.south && station.lat <= bounds.north &&
      station.lon >= bounds.west && station.lon <= bounds.east)).flatMap(station => station.detectors.map(detector => detector.id)));
    return availableFrameIndices(replay, ids);
  }, [replay, bounds]);
  const displayedIndex = availableFrames.find(index => index >= frameIndex) ?? availableFrames[0] ?? 29;
  const frame = replay?.frames[displayedIndex];
  const now = frame ? Date.parse(frame.at) : 0;
  const feed = useMemo(() => replay ? { stations: replayStations(replay, displayedIndex), maxAgeSeconds: 0 } : null, [replay, displayedIndex]);

  useEffect(() => {
    if (!visibleTab || document.hidden) return;
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 55_000);
    async function refresh() {
      setLoading(true);
      try {
        const response = await fetch('/swiss-commutes/live/replay.php', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('History unavailable');
        const data: unknown = await response.json();
        if (!isReplayFeed(data)) throw new Error('Invalid history');
        if (!disposed) { refreshAfter.current = Date.now() + 60_000; setReplay(data); setFrameIndex(0); setError(''); }
      } catch {
        if (!disposed) setError('Could not refresh the replay. Retrying in a minute.');
      } finally { clearTimeout(timeout); if (!disposed) setLoading(false); }
    }
    void refresh();
    return () => { disposed = true; controller.abort(); clearTimeout(timeout); };
  }, [refreshVersion, visibleTab]);

  useEffect(() => {
    if (!visibleTab || loading || (!error && (!replay || (!playing && availableFrames.length > 0)))) return;
    const next = availableFrames.find(index => index > displayedIndex);
    // A sparse window must not turn the end-of-loop refresh into rapid polling.
    const delay = error ? 60_000 : next !== undefined ? 2_000 : Math.max(2_000, refreshAfter.current - Date.now());
    const timer = window.setTimeout(() => {
      if (error || next === undefined) setRefreshVersion(value => value + 1);
      else setFrameIndex(next);
    }, delay);
    return () => clearTimeout(timer);
  }, [displayedIndex, availableFrames, playing, replay, loading, error, visibleTab]);

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
        if (!ids.has(id)) { markers.current.removeLayer(point); points.current.delete(id); }
      }
      for (const station of feed.stations) {
        const volume = error ? null : stationVolume(station, now, feed.maxAgeSeconds);
        const chosen = station.id === selectedId;
        let point = points.current.get(station.id);
        if (!point) {
          point = L.circleMarker([station.lat, station.lon]).on('click', () => setSelectedId(station.id)).addTo(markers.current);
          points.current.set(station.id, point);
        }
        point.setLatLng([station.lat, station.lon]).setRadius(chosen ? 9 : 5).setStyle({ weight: chosen ? 2 : 1,
          color: chosen ? '#000' : '#fffdf9', fillColor: volumeColor(volume), fillOpacity: volume !== null ? .95 : .55 });
        const tooltip = document.createElement('span');
        tooltip.textContent = `${label(station)} · ${error ? 'Replay unavailable' : volume === null ? stationStatus(station, frame!) : `${volume} vehicles/min at busiest detector`}`;
        if (point.getTooltip()) point.setTooltipContent(tooltip); else point.bindTooltip(tooltip);
      }
    });
    return () => { disposed = true; };
  }, [feed, frame, mapReady, now, selectedId, error]);

  const visible = useMemo(() => feed?.stations.filter(station => bounds && station.lat >= bounds.south && station.lat <= bounds.north &&
    station.lon >= bounds.west && station.lon <= bounds.east).sort((a, b) => label(a).localeCompare(label(b))) ?? [], [feed, bounds]);
  const current = error ? [] : visible.filter(station => stationIsCurrent(station, now, feed!.maxAgeSeconds));
  const selected = feed?.stations.find(station => station.id === selectedId);
  const delayed = replay && (!replay.collectedAt || Date.parse(replay.generatedAt) - Date.parse(replay.collectedAt) > 180_000);

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
      <h1>Live traffic in <span className="cityChoice"><select className="citySelect" aria-label="City" value={slug} onChange={event => changeCity(event.target.value)}>
        {cities.map(city => <option key={city.slug} value={city.slug}>{city.displayName}</option>)}
      </select><span aria-hidden="true">⌄</span></span></h1>
      <p>Last 30 minutes. Empty minutes skipped.</p>
    </section>
    <div className={styles.dashboard}>
      <section className={styles.mapPanel} aria-label={`Live traffic counters around ${city.displayName}`}>
        <div ref={container} className={styles.map} />
        {mapError && <p className={styles.mapMessage}>The map could not load. Readings are available in the station list.</p>}
        {!feed && <p className={styles.mapMessage} role="status">{error || 'Connecting to road counters…'}</p>}
        {frame && availableFrames.length > 0 && <div className={styles.playback} role="group" aria-label="Replay controls">
          <button aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => {
            if (!playing && Date.now() >= refreshAfter.current) setRefreshVersion(value => value + 1);
            setPlaying(value => !value);
          }}>{playing ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zm7 0h3v14h-3z" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>}</button>
          <div><span>Recorded minute</span><time dateTime={frame.at} title={dateFormat.format(new Date(frame.at))}>{time(frame.at)}–{time(new Date(now + 60_000).toISOString())}</time></div>
          <small>{loading ? 'Refreshing…' : `${availableFrames.indexOf(displayedIndex) + 1} / ${availableFrames.length}`}</small>
        </div>}
        <div className={styles.legend}>
          <span className={styles.legendTitle}>Vehicles/min · busiest detector</span>
          {[0, 10, 20, 30].map(value => <span key={value}><i style={{ background: volumeColor(value) }} />{value === 30 ? '30+' : `${value}–${value + 9}`}</span>)}
          <span><i style={{ background: volumeColor(null) }} /> No total</span>
        </div>
      </section>
      <aside className={styles.sidebar}>
        <div className={styles.status}>
          <span className={styles.kicker}>In this view</span>
          <strong>{feed ? current.length : '—'} <small>stations with data</small></strong>
          <p>{feed ? availableFrames.length ? `${availableFrames.length} of 30 minutes have usable counts in this view.`
            : 'No usable counts in the last 30 minutes. Checking again in a minute.' : 'Waiting for the first readings.'}</p>
          {frame && visible.length > 0 && !current.length && !error && <p>{frameCollected(frame)
            ? 'The source returned no usable counts in this view for this minute.' : 'This minute was not collected.'}</p>}
          {delayed && <p>Collection is delayed. Showing saved readings.</p>}
          {error && <p role="status">{error}</p>}
        </div>
        {selected ? <section className={styles.detail} aria-label="Selected counter">
          <button className={styles.back} onClick={() => setSelectedId(null)}>← All stations</button>
          <h2>{label(selected)}</h2>
          <p className={styles.subtle}>{selected.road ? `${selected.road} · ` : ''}{selected.id}</p>
          {selected.detectors.map(detector => {
            const reading = error ? null : currentReading(detector.reading, now, feed!.maxAgeSeconds);
            return <div className={styles.detector} key={detector.id}>
              <h3>Detector {detector.id.split(':').at(-1)}</h3>
              {reading ? <><p>60 seconds from <time dateTime={reading.at}>{time(reading.at)}</time></p>
                <table><thead><tr><th>Vehicles</th><th>Count</th><th>km/h</th></tr></thead>
                  <tbody><tr><th>Light</th><td>{reading.light ?? '—'}</td><td>{reading.lightSpeed ?? '—'}</td></tr>
                    <tr><th>Heavy goods</th><td>{reading.heavy ?? '—'}</td><td>{reading.heavySpeed ?? '—'}</td></tr></tbody></table>
                {(reading.light === null || reading.heavy === null) && <p>{detectorStatus(detector, frame!)}</p>}
              </> : <p>{error ? 'Replay unavailable' : detectorStatus(detector, frame!)}</p>}
            </div>;
          })}
        </section> : <section className={styles.stations} aria-label="Counting stations">
          <p className={styles.hint}>Select a station to see its counts and speeds.</p>
          {visible.length ? <ul>{visible.map(station => {
            const volume = error ? null : stationVolume(station, now, feed!.maxAgeSeconds);
            return <li key={station.id}><button onClick={() => setSelectedId(station.id)}>
            <span>{label(station)}{station.road && <small>{station.road}</small>}</span>
            <span className={!error && stationIsCurrent(station, now, feed!.maxAgeSeconds) ? styles.available : styles.unavailable}>
              {volume !== null ? `${volume}/min` : error ? 'Replay unavailable' : stationStatus(station, frame!)}
            </span></button></li>;
          })}</ul> : feed && <p>There are no counters from this feed in the current view. Zoom out to see nearby stations.</p>}
        </section>}
        <details id="sources" className={styles.sources}><summary>About these readings</summary>
          <p>ASTRA / FEDRO and participating road authorities count vehicles at fixed sensors. The feed covers equipped roads, not every street or border approach.</p>
          <p>Counts cover a 60-second interval. Speeds are the measured average for that vehicle class. Light vehicles include cars, motorcycles, buses and small delivery vehicles.</p>
          <p>Map colours show the highest vehicle count from a station’s detectors, from green to red. Both vehicle classes must be reported. Grey means no complete count for the displayed minute. Colours show volume, not congestion.</p>
          <p>The replay shows available minutes from the last 30 minutes, for two seconds each. It skips minutes without usable counts in this view; the clock shows the recorded time. After the last available minute, it waits for the next refresh. Readings are provisional. Zero means none counted.</p>
          <p>The same vehicle can pass several sensors. These counts cannot be added to calculate a city’s population or number of commuters.</p>
          <a href="https://opentransportdata.swiss/en/cookbook/road-traffic-cookbook/rt-road-traffic-counters/" target="_blank" rel="noreferrer">Source and definitions ↗</a>
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
