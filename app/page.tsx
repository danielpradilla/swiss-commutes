'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  borderCrossings,
  commutersInTransit,
  dailyPeak,
  formatTime,
  MINUTES_PER_DAY,
  populationChange,
  populationSeries,
} from './model';

type Mode = 'car' | 'transit' | 'soft';
type Point = { name: string; lat: number; lon: number };
type Corridor = { origin: Point; target: Point; commuters: number; mode: Mode };

const GENEVA = { name: 'Genève', lat: 46.2044, lon: 6.1432 };
const AIRPORT = { name: 'Aéroport', lat: 46.2381, lon: 6.109 };
const MEYRIN = { name: 'Meyrin', lat: 46.2337, lon: 6.08 };
const PLAN_LES_OUATES = { name: 'Plan-les-Ouates', lat: 46.167, lon: 6.116 };

const corridors: Corridor[] = [
  { origin: { name: 'Annemasse', lat: 46.1944, lon: 6.2377 }, target: GENEVA, commuters: 31_000, mode: 'car' },
  { origin: { name: 'St-Julien', lat: 46.1447, lon: 6.081 }, target: PLAN_LES_OUATES, commuters: 19_000, mode: 'car' },
  { origin: { name: 'Gex', lat: 46.3332, lon: 6.0577 }, target: AIRPORT, commuters: 16_500, mode: 'car' },
  { origin: { name: 'Annecy', lat: 45.8992, lon: 6.1294 }, target: GENEVA, commuters: 11_000, mode: 'car' },
  { origin: { name: 'Thonon', lat: 46.371, lon: 6.479 }, target: GENEVA, commuters: 9_500, mode: 'car' },
  { origin: { name: 'Nyon', lat: 46.3833, lon: 6.2396 }, target: GENEVA, commuters: 22_000, mode: 'transit' },
  { origin: { name: 'Lausanne', lat: 46.5197, lon: 6.6323 }, target: GENEVA, commuters: 13_000, mode: 'transit' },
  { origin: { name: 'Annemasse', lat: 46.1944, lon: 6.2377 }, target: GENEVA, commuters: 18_000, mode: 'transit' },
  { origin: { name: 'Bellegarde', lat: 46.1087, lon: 5.826 }, target: GENEVA, commuters: 7_500, mode: 'transit' },
  { origin: { name: 'Meyrin', lat: 46.2337, lon: 6.08 }, target: GENEVA, commuters: 29_000, mode: 'transit' },
  { origin: { name: 'Carouge', lat: 46.182, lon: 6.139 }, target: GENEVA, commuters: 17_000, mode: 'soft' },
  { origin: { name: 'Vernier', lat: 46.217, lon: 6.084 }, target: MEYRIN, commuters: 13_000, mode: 'soft' },
];

const modeMeta: Record<Mode, { label: string; colour: string }> = {
  car: { label: 'Car', colour: '#ef553f' },
  transit: { label: 'Public transport', colour: '#24798f' },
  soft: { label: 'Bike & foot', colour: '#a9c51d' },
};

const hash = (value: number) => {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const dots = corridors.flatMap((corridor, corridorIndex) =>
  Array.from({ length: Math.max(4, Math.round(corridor.commuters / 900)) }, (_, index) => {
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

const lake = [
  [6.143, 46.205], [6.19, 46.295], [6.24, 46.383], [6.34, 46.455],
  [6.49, 46.49], [6.64, 46.52], [6.69, 46.45], [6.57, 46.39],
  [6.48, 46.37], [6.33, 46.36], [6.22, 46.3],
];

const canton = [
  [5.96, 46.135], [6.08, 46.13], [6.2, 46.155], [6.25, 46.23],
  [6.24, 46.31], [6.1, 46.32], [5.96, 46.25],
];

const formatNumber = (value: number) => new Intl.NumberFormat('en-CH').format(value);
const formatDelta = (value: number) => `${value >= 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;

function MapCanvas({ time, modes }: { time: number; modes: Record<Mode, boolean> }) {
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
      const bounds = { minLon: 5.73, maxLon: 6.72, minLat: 45.84, maxLat: 46.59 };
      const project = ([lon, lat]: number[]) => [
        ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * width,
        ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * height,
      ];

      ctx.fillStyle = '#e9e6dc';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(21,24,19,.07)';
      ctx.lineWidth = 1;
      for (let row = 0; row < 14; row++) {
        ctx.beginPath();
        for (let x = -20; x <= width + 20; x += 12) {
          const y = height * (row + 1) / 15 + Math.sin(x / 52 + row) * 7;
          x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.beginPath();
      lake.forEach((point, index) => {
        const [x, y] = project(point);
        index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = '#bdd7dc';
      ctx.fill();
      ctx.strokeStyle = '#91b7bf';
      ctx.stroke();

      ctx.beginPath();
      canton.forEach((point, index) => {
        const [x, y] = project(point);
        index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(200,223,62,.15)';
      ctx.fill();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(21,24,19,.56)';
      ctx.stroke();
      ctx.setLineDash([]);

      corridors.forEach((corridor) => {
        const [ox, oy] = project([corridor.origin.lon, corridor.origin.lat]);
        const [tx, ty] = project([corridor.target.lon, corridor.target.lat]);
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = modeMeta[corridor.mode].colour + '24';
        ctx.lineWidth = corridor.mode === 'transit' ? 2 : 1;
        ctx.stroke();
      });

      const curvePoint = (
        start: number[],
        end: number[],
        progress: number,
        bend: number,
      ) => {
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const control = [
          (start[0] + end[0]) / 2 - dy * bend,
          (start[1] + end[1]) / 2 + dx * bend,
        ];
        const inverse = 1 - progress;
        return [
          inverse * inverse * start[0] + 2 * inverse * progress * control[0] + progress * progress * end[0],
          inverse * inverse * start[1] + 2 * inverse * progress * control[1] + progress * progress * end[1],
        ];
      };

      dots.forEach((dot) => {
        if (!modes[dot.corridor.mode]) return;
        const origin = project([dot.corridor.origin.lon, dot.corridor.origin.lat]);
        const target = project([dot.corridor.target.lon, dot.corridor.target.lat]);
        let start = origin;
        let end = target;
        let progress = (time - dot.inbound) / dot.duration;
        if (progress < 0 || progress > 1) {
          start = target;
          end = origin;
          progress = (time - dot.outbound) / dot.duration;
        }
        if (progress < 0 || progress > 1) return;
        const point = curvePoint(start, end, progress, dot.bend);
        const tail = curvePoint(start, end, Math.max(0, progress - 0.09), dot.bend);
        const colour = modeMeta[dot.corridor.mode].colour;
        ctx.beginPath();
        ctx.moveTo(tail[0], tail[1]);
        ctx.lineTo(point[0], point[1]);
        ctx.strokeStyle = colour + '70';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(point[0], point[1], dot.corridor.mode === 'soft' ? 2.1 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
      });

      const labels = [
        ...Array.from(new Map(corridors.map((item) => [item.origin.name, item.origin])).values()),
        GENEVA,
      ];
      ctx.font = '600 9px Arial';
      ctx.textBaseline = 'middle';
      labels.forEach((place) => {
        const [x, y] = project([place.lon, place.lat]);
        ctx.beginPath();
        ctx.arc(x, y, place.name === 'Genève' ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#151813';
        ctx.fill();
        ctx.fillText(place.name.toUpperCase(), x + 7, y - 7);
      });

      const [lakeX, lakeY] = project([6.42, 46.405]);
      ctx.save();
      ctx.translate(lakeX, lakeY);
      ctx.rotate(-0.23);
      ctx.fillStyle = '#568896';
      ctx.font = 'italic 12px Georgia';
      ctx.fillText('Lac Léman', 0, 0);
      ctx.restore();
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [time, modes]);

  return (
    <canvas
      ref={ref}
      className="commuterMap"
      role="img"
      aria-label={`Animated commuter map of greater Geneva at ${formatTime(time)}`}
    >
      Animated map of commuter flows in greater Geneva.
    </canvas>
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
        index ? ctx.lineTo(x(point.minute), y(point.value)) : ctx.moveTo(x(point.minute), y(point.value));
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
      ctx.font = '9px Arial';
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
          <p className="eyebrow">A commuter portrait · 2021 reference data</p>
          <h1>How Geneva<br />breathes.</h1>
          <p className="lede">Follow the daily pulse across the canton, neighbouring France and Vaud.</p>
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
          <div className="mapNote">Simplified geographic view · not live tracking</div>
          <div className="modeFilters" aria-label="Show transport modes">
            {(Object.keys(modeMeta) as Mode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={modes[mode]}
                onClick={() => setModes((current) => ({ ...current, [mode]: !current[mode] }))}
              >
                <i style={{ background: modeMeta[mode].colour }} />
                {modeMeta[mode].label}
              </button>
            ))}
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
          <p className="dotKey">One moving mark ≈ 900 commuter journeys.</p>
        </aside>
      </section>

      <section className="timeline" aria-label="Population change through the day">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Geneva population change</p>
            <strong>{formatDelta(stats.population)}</strong>
          </div>
          <div className="chartLegend">
            <span><i className="up" /> Increase</span>
            <span><i className="down" /> Decrease</span>
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
              onChange={(event) => setTime(Number(event.target.value))}
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
          <a href="https://www.insee.fr/fr/statistiques/8201899" target="_blank" rel="noreferrer">
            <span>01 · Observed flows</span><strong>INSEE RP2021</strong>
            <p>Residence-to-work mobility flows for employed people, including cross-border destinations.</p>
          </a>
          <a href="https://statistique.ge.ch/domaines/apercu.asp?dom=11_02" target="_blank" rel="noreferrer">
            <span>02 · Cantonal context</span><strong>OCSTAT Genève</strong>
            <p>Geneva mobility, commuter and resident-worker statistics.</p>
          </a>
          <a href="https://www.bfs.admin.ch/bfs/en/home/statistics/mobility-transport/passenger-transport/commuting.html" target="_blank" rel="noreferrer">
            <span>03 · Swiss commuters</span><strong>Federal Statistical Office</strong>
            <p>Structural survey indicators on commuting for work and education.</p>
          </a>
          <a href="https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d" target="_blank" rel="noreferrer">
            <span>04 · Boundaries</span><strong>swisstopo</strong>
            <p>Official Swiss national, cantonal and municipal boundary data.</p>
          </a>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            <span>05 · Network context</span><strong>OpenStreetMap contributors</strong>
            <p>Reference context for roads, rail, place names and the lake edge.</p>
          </a>
          <a href="https://www.reddit.com/r/geneva/comments/1vxy0q9/an_animated_map_of_all_commuters_to_geneva/" target="_blank" rel="noreferrer">
            <span>06 · Inspiration</span><strong>Habibi Code / Reddit</strong>
            <p>The original Geneva commuter animation that inspired this independent interpretation.</p>
          </a>
        </div>
        <div className="methodNote">
          <strong>Read this visualization as a pattern, not a headcount.</strong>
          <p>
            Corridor volumes and the 2021 French cross-border reference are aggregated. Animated marks
            are representative journeys, never people or devices. The view is intentionally simplified
            and should not be used for route planning.
          </p>
        </div>
      </section>

      <footer>
        <a className="wordmark" href="#top">GENÈVE / 24H ↑</a>
        <p>Independent data portrait · built in Geneva · reference year 2021</p>
      </footer>
    </main>
  );
}
