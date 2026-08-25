'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { corridors, dataSummary, type Mode, type Point } from './commutes';
import {
  borderCrossings,
  commutersAtHomeShare,
  commutersInTransit,
  dailyPeak,
  flowAt,
  formatTime,
  MINUTES_PER_DAY,
  populationChange,
  populationSeries,
} from './model';

const GENEVA: Point = { code: 'CH6621', name: 'Genève', lat: 46.2044, lon: 6.1432 };

const modeMeta: Record<Mode, { label: string; short: string }> = {
  car: { label: 'Car', short: 'C' },
  transit: { label: 'Public transport', short: 'PT' },
  soft: { label: 'Bike & foot', short: 'A' },
};

const flowMeta = {
  inbound: { label: 'Into canton', colour: '#ef553f' },
  outbound: { label: 'Out of canton', colour: '#24798f' },
};

type CommuneNode = { point: Point; total: number; byMode: Record<Mode, number> };

const communeNodes = Array.from(corridors.reduce((nodes, corridor) => {
  const node = nodes.get(corridor.origin.code) ?? {
    point: corridor.origin,
    total: 0,
    byMode: { car: 0, transit: 0, soft: 0 },
  };
  node.total += corridor.commuters;
  node.byMode[corridor.mode] += corridor.commuters;
  nodes.set(corridor.origin.code, node);
  return nodes;
}, new Map<string, CommuneNode>()).values());

const markerRadius = (commuters: number) => Math.max(1.8, Math.min(9, Math.sqrt(commuters / 160)));

const hash = (value: number) => {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const primaryCorridorByOrigin = new Map<string, number>();
corridors.forEach((corridor, index) => {
  const primary = primaryCorridorByOrigin.get(corridor.origin.code);
  if (primary === undefined || corridors[primary].commuters < corridor.commuters) {
    primaryCorridorByOrigin.set(corridor.origin.code, index);
  }
});

const dots = corridors.flatMap((corridor, corridorIndex) =>
  Array.from({
    length: Math.floor(corridor.commuters / 900) +
      (primaryCorridorByOrigin.get(corridor.origin.code) === corridorIndex ? 1 : 0),
  }, (_, index) => {
    const seed = corridorIndex * 101 + index + 1;
    const distance = Math.hypot(
      corridor.origin.lat - corridor.target.lat,
      corridor.origin.lon - corridor.target.lon,
    );
    return {
      corridor,
      bend: (hash(seed * 5) - 0.5) * 0.18,
      inbound: 285 + Math.pow(hash(seed), 1.25) * 285,
      outbound: 895 + Math.pow(hash(seed * 3), 0.9) * 260,
      duration: 16 + distance * 115 + hash(seed * 7) * 15,
    };
  }),
);

const formatNumber = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');
const formatDelta = (value: number) => `${value >= 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;

function MapCanvas({ time, modes }: { time: number; modes: Record<Mode, boolean> }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const timeRef = useRef(time);
  const modesRef = useRef(modes);

  useEffect(() => {
    timeRef.current = time;
    modesRef.current = modes;
    drawRef.current();
  }, [time, modes]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;

    void import('leaflet').then((L) => {
      const container = mapElement.current;
      const canvas = canvasRef.current;
      if (disposed || !container || !canvas) return;

      const map = L.map(container, {
        preferCanvas: true,
        zoomControl: false,
        scrollWheelZoom: false,
        minZoom: 6,
        maxZoom: 14,
        maxBounds: [[45.4, 4.45], [47.2, 7.55]],
        maxBoundsViscosity: 0.8,
      });
      mapRef.current = map;
      map.fitBounds([[45.72, 4.72], [46.7, 7.12]], { padding: [18, 18] });
      L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>',
      }).addTo(map);
      L.control.zoom({ position: 'topright' }).addTo(map);
      L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 110 }).addTo(map);

      const draw = () => {
        const box = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pixelWidth = Math.max(1, Math.round(box.width * dpr));
        const pixelHeight = Math.max(1, Math.round(box.height * dpr));
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, box.width, box.height);
        const project = (place: Point) => {
          const point = map.latLngToContainerPoint([place.lat, place.lon]);
          return [point.x, point.y];
        };

        const curvePoint = (start: number[], end: number[], progress: number, bend: number) => {
          const dx = end[0] - start[0];
          const dy = end[1] - start[1];
          const control = [(start[0] + end[0]) / 2 - dy * bend, (start[1] + end[1]) / 2 + dx * bend];
          const inverse = 1 - progress;
          return [
            inverse * inverse * start[0] + 2 * inverse * progress * control[0] + progress * progress * end[0],
            inverse * inverse * start[1] + 2 * inverse * progress * control[1] + progress * progress * end[1],
          ];
        };

        const homeShare = commutersAtHomeShare(timeRef.current);
        communeNodes.forEach((node) => {
          const [x, y] = project(node.point);
          const visible = (Object.keys(modeMeta) as Mode[]).reduce(
            (sum, mode) => sum + (modesRef.current[mode] ? node.byMode[mode] : 0),
            0,
          );
          const radius = markerRadius(node.total);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(21,24,19,.11)';
          ctx.fill();
          if (!visible) return;
          ctx.beginPath();
          ctx.arc(x, y, markerRadius(visible) * (0.84 + homeShare * 0.16), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(21,24,19,${0.28 + homeShare * 0.5})`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(250,247,240,.72)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        });

        dots.forEach((dot) => {
          if (!modesRef.current[dot.corridor.mode]) return;
          const origin = project(dot.corridor.origin);
          const target = project(dot.corridor.target);
          const flow = flowAt(
            timeRef.current,
            dot.inbound,
            dot.outbound,
            dot.duration,
            dot.corridor.direction,
          );
          if (!flow) return;
          const start = flow.reverse ? target : origin;
          const end = flow.reverse ? origin : target;
          const point = curvePoint(start, end, flow.progress, dot.bend);
          const tail = curvePoint(start, end, Math.max(0, flow.progress - 0.09), dot.bend);
          const colour = flowMeta[flow.direction].colour;
          ctx.beginPath();
          ctx.moveTo(tail[0], tail[1]);
          ctx.lineTo(point[0], point[1]);
          ctx.strokeStyle = colour + '8a';
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(point[0], point[1], dot.corridor.mode === 'soft' ? 2.2 : 2.7, 0, Math.PI * 2);
          ctx.fillStyle = colour;
          ctx.fill();
        });

        const [genevaX, genevaY] = project(GENEVA);
        const delta = populationChange(timeRef.current);
        const haloRadius = 28 * Math.sqrt(Math.abs(delta) / dailyPeak.value);
        if (haloRadius > 0.5) {
          const haloColour = flowMeta[delta >= 0 ? 'inbound' : 'outbound'].colour;
          ctx.beginPath();
          ctx.arc(genevaX, genevaY, haloRadius, 0, Math.PI * 2);
          ctx.fillStyle = haloColour + '24';
          ctx.fill();
          ctx.strokeStyle = haloColour + 'a6';
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(genevaX, genevaY, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#c8df3e';
        ctx.fill();
        ctx.strokeStyle = '#151813';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      };

      drawRef.current = draw;
      map.on('move zoom resize', draw);
      observer = new ResizeObserver(() => {
        map.invalidateSize();
        draw();
      });
      observer.observe(container);
      draw();
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="commuterMap" role="region" aria-label={`Interactive commuter map of greater Geneva at ${formatTime(time)}; Geneva population change ${formatDelta(populationChange(time))}`}>
      <div ref={mapElement} className="mapBase" />
      <canvas ref={canvasRef} className="commuterOverlay" aria-hidden="true" />
    </div>
  );
}

function PopulationChart({ time }: { time: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(box.width * dpr));
      canvas.height = Math.max(1, Math.round(box.height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const width = box.width;
      const height = box.height;
      const pad = { top: 22, right: 8, bottom: 22, left: 8 };
      const min = Math.min(...populationSeries.map((point) => point.value), -7_000);
      const max = dailyPeak.value * 1.12;
      const x = (minute: number) => pad.left + minute / MINUTES_PER_DAY * (width - pad.left - pad.right);
      const y = (value: number) => pad.top + (max - value) / (max - min) * (height - pad.top - pad.bottom);
      const zeroY = y(0);

      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(21,24,19,.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(width - pad.right, zeroY);
      ctx.stroke();

      const peakY = y(dailyPeak.value);
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = '#ef553f';
      ctx.beginPath();
      ctx.moveTo(pad.left, peakY);
      ctx.lineTo(width - pad.right, peakY);
      ctx.stroke();
      ctx.setLineDash([]);

      populationSeries.forEach((point, index) => {
        if (!index) return;
        const previous = populationSeries[index - 1];
        ctx.beginPath();
        ctx.moveTo(x(previous.minute), zeroY);
        ctx.lineTo(x(previous.minute), y(previous.value));
        ctx.lineTo(x(point.minute), y(point.value));
        ctx.lineTo(x(point.minute), zeroY);
        ctx.closePath();
        ctx.fillStyle = point.value >= 0 ? 'rgba(239,85,63,.18)' : 'rgba(36,121,143,.24)';
        ctx.fill();
      });

      ctx.beginPath();
      populationSeries.forEach((point, index) => {
        if (index) ctx.lineTo(x(point.minute), y(point.value));
        else ctx.moveTo(x(point.minute), y(point.value));
      });
      ctx.strokeStyle = '#151813';
      ctx.lineWidth = 1.7;
      ctx.stroke();

      const currentX = x(time);
      const currentY = y(populationChange(time));
      ctx.strokeStyle = '#151813';
      ctx.beginPath();
      ctx.moveTo(currentX, pad.top);
      ctx.lineTo(currentX, height - pad.bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(currentX, currentY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#c8df3e';
      ctx.fill();
      ctx.strokeStyle = '#151813';
      ctx.stroke();

      ctx.fillStyle = '#6d7168';
      ctx.font = '9px ui-monospace, monospace';
      [0, 4, 8, 12, 16, 20, 24].forEach((hour) => {
        const labelX = x(hour * 60);
        ctx.textAlign = hour === 0 ? 'left' : hour === 24 ? 'right' : 'center';
        ctx.fillText(String(hour).padStart(2, '0'), labelX, height - 5);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [time]);

  return (
    <canvas
      ref={ref}
      className="populationChart"
      role="img"
      aria-label={`Modelled Geneva population change across a weekday. Current value ${formatDelta(populationChange(time))}; maximum ${formatDelta(dailyPeak.value)}.`}
    />
  );
}

export default function Home() {
  const [time, setTime] = useState(465);
  const [playing, setPlaying] = useState(false);
  const [modes, setModes] = useState<Record<Mode, boolean>>({
    car: true,
    transit: true,
    soft: true,
  });

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setTime((current) => current >= MINUTES_PER_DAY ? 0 : current + 5);
    }, 70);
    return () => window.clearInterval(timer);
  }, [playing]);

  const stats = useMemo(() => ({
    transit: commutersInTransit(time),
    population: populationChange(time),
    crossings: borderCrossings(time),
  }), [time]);

  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="#top">GENÈVE / 24H</a>
        <p>One weekday, in motion</p>
        <a href="#sources">Sources & method ↓</a>
      </header>

      <section className="hero" id="top">
        <div className="intro">
          <p className="eyebrow">A commuter portrait · 2023–2024 official counts</p>
          <h1>How Geneva<br />breathes.</h1>
          <p className="lede">Follow the daily pulse commune by commune across Geneva, neighbouring France and Vaud.</p>
        </div>
        <div className="clockBlock">
          <span>Local time</span>
          <strong>{formatTime(time)}</strong>
          <small>MODELLED WEEKDAY</small>
        </div>
      </section>

      <section className="dashboard" aria-label="Geneva commuter map and current statistics">
        <div className="mapPanel">
          <MapCanvas time={time} modes={modes} />
          <div className="mapNote">swisstopo grey national map · {formatNumber(dataSummary.originCommunes)} origins · marker area = commuter volume</div>
          <div className="modeFilters" aria-label="Show transport modes">
            <span className="filterLabel">Transport shown</span>
            {(Object.keys(modeMeta) as Mode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={modes[mode]}
                onClick={() => setModes((current) => ({ ...current, [mode]: !current[mode] }))}
              >
                <i aria-hidden="true">{modeMeta[mode].short}</i>
                {modeMeta[mode].label}
              </button>
            ))}
          </div>
          <div className="flowLegend" aria-label="Flow direction colors">
            <span><i className="inbound" />{flowMeta.inbound.label}</span>
            <span><i className="outbound" />{flowMeta.outbound.label}</span>
          </div>
        </div>

        <aside className="statRail" aria-live="polite">
          <p className="eyebrow">At {formatTime(time)}</p>
          <div>
            <span>In transit</span>
            <strong>{formatNumber(stats.transit)}</strong>
            <small>estimated people</small>
          </div>
          <div>
            <span>Population change</span>
            <strong className={stats.population >= 0 ? 'positive' : 'negative'}>
              {formatDelta(stats.population)}
            </strong>
            <small>vs. midnight baseline</small>
          </div>
          <div>
            <span>Border journeys</span>
            <strong>{formatNumber(stats.crossings)}</strong>
            <small>cumulative today</small>
          </div>
          <div className="peakStat">
            <span>Maximum</span>
            <strong>{formatDelta(dailyPeak.value)}</strong>
            <small>at {formatTime(dailyPeak.minute)}</small>
          </div>
          <p className="dotKey">Commune markers scale with commuter volume and dim while their commuters are away. Geneva’s halo shows net population change.</p>
        </aside>
      </section>

      <section className="timeline" aria-label="Population change through the day">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Geneva population change</p>
            <strong>{formatDelta(stats.population)}</strong>
          </div>
          <div className="chartLegend">
            <span><i className="up" /> Above baseline</span>
            <span><i className="down" /> Below baseline</span>
            <span><i className="maximum" /> Maximum</span>
          </div>
        </div>
        <PopulationChart time={time} />
        <div className="controls">
          <button
            className="playButton"
            type="button"
            aria-label={playing ? 'Pause animation' : 'Play animation'}
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? 'Ⅱ' : '▶'}
          </button>
          <label>
            <span className="srOnly">Time of day</span>
            <input
              aria-label="Time of day"
              type="range"
              min="0"
              max={MINUTES_PER_DAY}
              step="5"
              value={time}
              onInput={(event) => setTime(Number(event.currentTarget.value))}
            />
          </label>
          <output>{formatTime(time)}</output>
        </div>
      </section>

      <section className="method" id="sources">
        <div className="methodIntro">
          <p className="eyebrow">Sources & method</p>
          <h2>Counts are observed.<br /><em>Timing is a model.</em></h2>
          <p>
            The public datasets describe where people live, where they work and—where available—
            their travel mode. They do not contain a minute-by-minute trace. Departure times,
            durations, routes and the population curve are therefore an explanatory simulation.
          </p>
        </div>
        <div className="sourceGrid">
          <a href="https://www.insee.fr/fr/statistiques/9004795" target="_blank" rel="noreferrer">
            <span>01 · French communes</span><strong>INSEE RP2023</strong>
            <p>Weighted residence-to-work records by commune, destination commune and main transport mode.</p>
          </a>
          <a href="https://opendata.swiss/fr/dataset/erwerbstatige-nach-wohn-und-arbeitsgemeinde-2014-2018-und-2020" target="_blank" rel="noreferrer">
            <span>02 · Swiss communes</span><strong>OFS commune matrix</strong>
            <p>The latest published Swiss origin–destination matrix at commune grain: 2020.</p>
          </a>
          <a href="https://statistique.ge.ch/statistique/tel/domaines/11/11_02/T_11_06_2_04.xlsx" target="_blank" rel="noreferrer">
            <span>03 · Current Swiss totals</span><strong>OCSTAT 2024</strong>
            <p>Official incoming and outgoing commuter totals for Geneva, Vaud and its districts.</p>
          </a>
          <a href="https://docs.geo.admin.ch/visualize-data/xyz.html" target="_blank" rel="noreferrer">
            <span>04 · Basemap</span><strong>swisstopo grey map</strong>
            <p>Official national-map tiles, visually softened so commuter flows remain legible.</p>
          </a>
          <a href="https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d" target="_blank" rel="noreferrer">
            <span>05 · Swiss locations</span><strong>swissBOUNDARIES3D</strong>
            <p>Official commune boundaries used to locate Swiss origins and workplaces.</p>
          </a>
          <a href="https://geo.api.gouv.fr/decoupage-administratif/communes" target="_blank" rel="noreferrer">
            <span>06 · French locations</span><strong>API Géo</strong>
            <p>Official commune codes, names and representative centres for Ain and Haute-Savoie.</p>
          </a>
          <a href="https://www.reddit.com/r/geneva/comments/1vxy0q9/an_animated_map_of_all_commuters_to_geneva/" target="_blank" rel="noreferrer">
            <span>07 · Inspiration</span><strong>Habibi Code / Reddit</strong>
            <p>The original Geneva commuter animation that inspired this independent interpretation.</p>
          </a>
        </div>
        <div className="methodNote">
          <strong>Read this visualization as a pattern, not a headcount.</strong>
          <p>
            French flows use RP2023 directly. Swiss commune shares use the latest available matrix (2020)
            and cross-canton totals are scaled to OCSTAT 2024. Animated marks are representative journeys,
            never people or devices. Commune marker area represents commuter volume—not total population;
            paths and timing remain schematic.
          </p>
        </div>
      </section>

      <footer>
        <a className="wordmark" href="#top">GENÈVE / 24H ↑</a>
        <p>Independent data portrait · built in Geneva · data through 2024</p>
      </footer>
    </main>
  );
}
