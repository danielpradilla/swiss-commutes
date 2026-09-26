'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CircleMarker, LayerGroup, Map as LeafletMap } from 'leaflet';
import { loadMobility, siteCount, type MobilityFeed, type Mode, type Site } from './mobility-data';
import styles from './mobility.module.css';

type City = { slug: string; displayName: string; centre: { lat: number; lon: number } };
type Bounds = { south: number; north: number; west: number; east: number };
const modes: Mode[] = ['bike', 'scooter', 'car', 'moped'];
const labels: Record<Mode, string> = { bike: 'Bikes', scooter: 'Scooters', car: 'Cars', moped: 'Mopeds' };
const modeColors: Record<Mode, string> = { bike: '#2f5f7f', scooter: '#7a6100', car: '#0f766e', moped: '#28303d' };
function dominantMode(site: Site, selected: Mode[]): Mode {
  return selected.reduce((best, kind) => site.counts[kind] > site.counts[best] ? kind : best);
}
function markerRadius(count: number) { return Math.min(13, 2.5 + 1.5 * Math.sqrt(count)); }
const updated = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function breakdown(site: Site, selected: Mode[]) {
  return modes.filter(kind => selected.includes(kind) && site.counts[kind] > 0)
    .map(kind => `${site.counts[kind]} ${site.counts[kind] === 1 ? labels[kind].slice(0, -1).toLowerCase() : labels[kind].toLowerCase()}`)
    .join(' · ');
}

function Icon({ mode }: { mode: Mode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {mode === 'bike' && <><circle cx="6" cy="16" r="3" /><circle cx="18" cy="16" r="3" /><path d="m6 16 4-7 3 7H6m4-7h4m-1 7 3-6h-3" /></>}
    {mode === 'scooter' && <><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 18h8l3-11h3M11 7h7" /></>}
    {mode === 'car' && <><path d="M4 15v-3l2-5h12l2 5v3H4Zm2-3h12" /><circle cx="7" cy="16.5" r="1.5" /><circle cx="17" cy="16.5" r="1.5" /></>}
    {mode === 'moped' && <><circle cx="5" cy="17" r="2.5" /><circle cx="19" cy="17" r="2.5" /><path d="M5 17h6l4-5h3l1 5m-6-5-2-4h-3m8 1h3" /></>}
  </svg>;
}

export default function MobilityDashboard({ initialCity, cities }: { initialCity: string; cities: City[] }) {
  const router = useRouter();
  const city = cities.find(item => item.slug === initialCity)!;
  const [feed, setFeed] = useState<MobilityFeed | null>(null);
  const [error, setError] = useState('');
  const [selectedModes, setSelectedModes] = useState<Mode[]>(modes);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const points = useRef(new Map<string, CircleMarker>());

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    async function refresh() {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await loadMobility(controller.signal);
        if (!stopped) { setFeed(next); setError(''); }
      } catch {
        if (!stopped && !controller?.signal.aborted) setError('Shared mobility updates are temporarily unavailable.');
      }
    }
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { stopped = true; controller?.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    import('leaflet').then(L => {
      if (disposed || !container.current) return;
      const instance = L.map(container.current, { preferCanvas: true, zoomControl: false, scrollWheelZoom: false, minZoom: 7, maxZoom: 17 });
      map.current = instance;
      instance.setView([city.centre.lat, city.centre.lon], 14);
      L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', {
        maxZoom: 20, attribution: '&copy; <a href="https://stadiamaps.com/attribution/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(instance);
      L.control.zoom({ position: 'topright' }).addTo(instance);
      L.control.scale({ position: 'bottomright', imperial: false }).addTo(instance);
      layer.current = L.layerGroup().addTo(instance);
      const updateBounds = () => { const box = instance.getBounds(); setBounds({ south: box.getSouth(), north: box.getNorth(), west: box.getWest(), east: box.getEast() }); };
      instance.on('moveend', updateBounds);
      resize = new ResizeObserver(() => { instance.invalidateSize(); updateBounds(); });
      resize.observe(container.current);
      updateBounds();
      setMapReady(true);
    }).catch(() => setMapError(true));
    const markers = points.current;
    return () => { disposed = true; resize?.disconnect(); map.current?.remove(); map.current = null; layer.current = null; markers.clear(); };
  // City changes move the existing map below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { map.current?.setView([city.centre.lat, city.centre.lon], 14); }, [city]);

  const visible = useMemo(() => feed?.sites.filter(site => bounds && site.lat >= bounds.south && site.lat <= bounds.north &&
    site.lon >= bounds.west && site.lon <= bounds.east && siteCount(site, selectedModes) > 0)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'station' ? -1 : 1) ||
      siteCount(b, selectedModes) - siteCount(a, selectedModes) || a.name.localeCompare(b.name)) ?? [], [feed, bounds, selectedModes]);
  const selected = visible.find(site => site.id === selectedId);
  const total = visible.reduce((sum, site) => sum + siteCount(site, selectedModes), 0);

  useEffect(() => {
    if (!mapReady || !layer.current) return;
    let disposed = false;
    import('leaflet').then(L => {
      if (disposed || !layer.current) return;
      const ids = new Set(visible.map(site => site.id));
      for (const [id, marker] of points.current) if (!ids.has(id)) { layer.current.removeLayer(marker); points.current.delete(id); }
      for (const site of visible) {
        const count = siteCount(site, selectedModes);
        const chosen = selectedId === site.id;
        let marker = points.current.get(site.id);
        if (!marker) {
          marker = L.circleMarker([site.lat, site.lon]).on('click', () => setSelectedId(site.id)).addTo(layer.current);
          points.current.set(site.id, marker);
        }
        marker.setRadius(markerRadius(count)).setStyle({ color: chosen ? '#111' : '#fffdf9', weight: chosen ? 2 : .5,
          fillColor: modeColors[dominantMode(site, selectedModes)], fillOpacity: .9 });
        const tooltip = document.createElement('span');
        tooltip.textContent = `${site.name}\n${breakdown(site, selectedModes)} available\n${site.provider}`;
        if (marker.getTooltip()) marker.setTooltipContent(tooltip); else marker.bindTooltip(tooltip);
      }
    });
    return () => { disposed = true; };
  }, [visible, selectedId, selectedModes, mapReady]);

  function choose(site: Site) {
    setSelectedId(site.id);
    map.current?.panTo([site.lat, site.lon]);
  }
  function changeCity(slug: string) {
    if (!cities.some(item => item.slug === slug)) return;
    setSelectedId(null);
    router.push(`/mobility/${slug}/`);
  }

  return <main className={styles.page}>
    <header><div className="dp-navbar">
      <div className="dp-navbar-title"><Link className="dp-navbar-brand" href="/projects/">Daniel Pradilla</Link><span className="dp-navbar-project">Swiss Commutes <span aria-hidden="true">🇨🇭</span></span></div>
      <nav className="dp-navbar-links" aria-label="Site navigation"><Link href="/">Commuting</Link><Link href="/live/">Traffic</Link><Link href="/trains/">Trains</Link><Link href="/mobility/" aria-current="page">Shared mobility</Link><a href="#sources">Sources & method</a><Link href="/blog/">Blog</Link><a href="https://github.com/danielpradilla/swiss-commutes">GitHub</a></nav>
      <details className="dp-navbar-menu"><summary aria-label="Menu">☰</summary><nav aria-label="Site navigation (mobile)"><Link href="/">Commuting</Link><Link href="/live/">Traffic</Link><Link href="/trains/">Trains</Link><Link href="/mobility/">Shared mobility</Link><a href="#sources">Sources & method</a><Link href="/blog/">Blog</Link></nav></details>
    </div></header>
    <section className={styles.heading}><h1>Shared mobility in <span className="cityChoice"><select className="citySelect" aria-label="City" value={initialCity} onChange={event => changeCity(event.target.value)}>{cities.map(item => <option key={item.slug} value={item.slug}>{item.displayName}</option>)}</select><span aria-hidden="true">⌄</span></span></h1>
      <p>{feed ? <>Source updated <time dateTime={new Date(feed.updatedAt * 1000).toISOString()}>{updated.format(new Date(feed.updatedAt * 1000))}</time></> : 'Loading availability…'}</p></section>
    <div className={styles.dashboard}>
      <section className={styles.mapPanel} aria-label={`Shared vehicle pickup sites around ${city.displayName}`}>
        <div ref={container} className={styles.map} />
        <div className={styles.filters} role="group" aria-label="Vehicle types">{modes.map(kind => <button key={kind} type="button" style={{ '--mode-color': modeColors[kind] } as CSSProperties} aria-pressed={selectedModes.includes(kind)} aria-label={labels[kind]} data-label={labels[kind]} onClick={() => setSelectedModes(current => modes.filter(item => item === kind ? !current.includes(item) : current.includes(item)))}><Icon mode={kind} /></button>)}</div>
        {mapError && <p className={styles.mapMessage}>The map could not load. Sites are available in the list.</p>}
        {!feed && <p className={styles.mapMessage} role="status">{error || 'Loading shared mobility sites…'}</p>}
        <div className={styles.legend}><span>Available vehicles at a site</span>{[1, 10, 30].map(value => <span key={value} className={styles.sizeExample}><i style={{ width: markerRadius(value) * 2, height: markerRadius(value) * 2 }} />{value}</span>)}</div>
      </section>
      <aside className={styles.sidebar}>
        <div><span className={styles.kicker}>In this map view</span><strong className={styles.total}>{feed ? total.toLocaleString('en-CH') : '—'} <small>available vehicles</small></strong><p className={styles.note}>{visible.length} pickup sites · Colour shows the most available selected type; dot size shows the selected vehicle count.</p>{error && <p role="status" className={styles.error}>{error} Showing the last received update.</p>}</div>
        {selected ? <section className={styles.detail} aria-label="Selected pickup site"><button className={styles.back} onClick={() => setSelectedId(null)}>← All sites</button><h2>{selected.name}</h2><p>{selected.kind === 'station' ? 'Rental station' : 'Free-floating vehicle location'} · {selected.provider}</p><dl>{modes.filter(kind => selectedModes.includes(kind) && selected.counts[kind] > 0).map(kind => <div key={kind}><dt>{labels[kind]}</dt><dd>{selected.counts[kind]} available</dd></div>)}</dl></section>
          : <section className={styles.list} aria-label="Pickup sites in this map view">
            <h2>Sites and vehicles</h2>
            <p className={styles.note}>Station counts are reported by providers. Street markers use reported vehicle coordinates.</p>
            {visible.length ? <ul>{visible.slice(0, 150).map(site => <li key={site.id}><button onClick={() => choose(site)}><span><strong>{site.name}</strong><small>{site.provider} · {site.kind === 'station' ? 'Station' : 'Street location'}</small><small>{breakdown(site, selectedModes)}</small></span><b style={{ color: modeColors[dominantMode(site, selectedModes)] }}>{siteCount(site, selectedModes)}</b></button></li>)}</ul>
              : feed && <p className={styles.note}>{selectedModes.length ? 'No available vehicles of the selected types in this map view. Zoom out or choose another type.' : 'Choose a vehicle type to see availability.'}</p>}
            {visible.length > 150 && <p className={styles.note}>Showing the first 150 sites, stations first. Zoom in for the rest.</p>}
          </section>}
      </aside>
    </div>
    <section className="method" id="sources"><div className="methodIntro"><p className="eyebrow">Reported availability · participating providers</p><h2>About shared mobility</h2><p>Rental stations and free-floating vehicles come from the Swiss shared mobility GBFS feed. Counts describe vehicles reported available at the source update time, not guaranteed reservations.</p></div>
      <div className="sourceGrid"><a href="https://data.opentransportdata.swiss/dataset/sharedmobility" target="_blank" rel="noreferrer"><span>01 · Locations and availability</span><strong>Sharedmobility.ch / BFE</strong><p>Provider-reported station locations, vehicle types and availability across participating services.</p></a><a href="https://github.com/SFOE/sharedmobility/blob/main/Access%20the%20data.md" target="_blank" rel="noreferrer"><span>02 · Feed documentation</span><strong>GBFS data access</strong><p>Combined GBFS 2.0 feeds and provider-specific GBFS 2.3 station counts.</p></a></div>
      <div className="methodNote"><strong>How to read the map</strong><div><p>Colour identifies the most available selected vehicle type at a site; ties follow the selector order. Larger dots indicate more available vehicles of the selected types, using a square-root scale capped for readability. These are absolute counts, not availability relative to capacity. The list and total follow the current map bounds. Hover a marker for its site name, full vehicle-type breakdown, count and provider.</p><p>Vehicles at a matching station coordinate use that station’s name. Where a fresh station count exists, individually listed vehicles there are not counted twice. Other vehicles appear at their reported coordinates; only vehicles at identical coordinates share a marker. Closed stations, disabled and reserved vehicles are omitted. Availability can change after publication, and some providers may not be represented.</p></div></div>
    </section>
    <footer className="projectFooter"><div className="dp-footer"><span>© 2026 Daniel Pradilla</span><nav aria-label="Footer navigation"><Link href="/">Commuting</Link><Link href="/live/">Traffic</Link><Link href="/trains/">Trains</Link><Link href="/mobility/">Shared mobility</Link><Link href="/projects/">Projects</Link><Link href="/blog/">Blog</Link></nav></div></footer>
  </main>;
}
