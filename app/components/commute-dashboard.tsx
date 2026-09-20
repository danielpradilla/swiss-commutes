'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { useRouter } from 'next/navigation';
import type { CityConfig } from '../cities';
import { prepareMapDataAsync, carPointName, CAR_COMMUTERS_PER_DOT, type MapSummary } from '../map-data';
import { carPosition, unpackCarRoutes } from '../road-flow';
import type { RouteData } from '../route-data';
import type { Mode, Point } from '../data/types';
import {
  arrivalBlip,
  createDailyModel,
  createJourneyModel,
  flowAt,
  formatTime,
  MINUTES_PER_DAY,
  transportLabels,
  transportModes,
} from '../model';
import { pointAlongPolyline, type RouteCoordinate, type ScreenCoordinate } from '../route-geometry';

const flowMeta = {
  inbound: { colour: '#c2413f' },
  outbound: { colour: '#2f5f7f' },
};

function ModeIcon({ mode }: { mode: Mode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {mode === 'car' && <><path d="M4 15v-3l2-5h12l2 5v3H4Z" /><path d="M6 12h12" /><circle cx="7" cy="16.5" r="1.5" /><circle cx="17" cy="16.5" r="1.5" /></>}
      {mode === 'transit' && <><rect x="6" y="3" width="12" height="15" rx="3" /><path d="M8.5 7h7M8 13h8M9 21l2-3m4 0 2 3" /><circle cx="9" cy="15" r="1" /><circle cx="15" cy="15" r="1" /></>}
      {mode === 'soft' && <><circle cx="6" cy="16" r="3" /><circle cx="18" cy="16" r="3" /><path d="m6 16 4-7 3 7h-7m4-7h4m-1 7 3-6h-3" /></>}
    </svg>
  );
}

const markerRadius = (commuters: number) => Math.max(1.8, Math.min(9, Math.sqrt(commuters / 160)));

const formatNumber = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');
const formatDelta = (value: number) => `${value >= 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;
type ClockMode = 'realtime' | 'fast' | 'paused';
const playbackSpeed = 15; // Simulated minutes per second.
const dotSize = 1.5;
// Retain the selected slider's proportions across transport modes.
const sizeBlend = (dotSize - 1.4) / (2.7 - 1.4);
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function genevaTime() {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts().map((part) => [part.type, Number(part.value)]));
  return values.hour * 60 + values.minute + values.second / 60;
}

type DailyModel = ReturnType<typeof createDailyModel>;
type MapData = Awaited<ReturnType<typeof prepareMapDataAsync>>;

function MapCanvas({
  time,
  city,
  model,
  modes,
  populationScale,
  mapData,
  onReady,
}: {
  time: number;
  city: CityConfig;
  model: DailyModel;
  modes: Mode[];
  populationScale: number;
  mapData: MapData;
  onReady: (ready: boolean) => void;
}) {
  const mapElement = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const hoverPointsRef = useRef<Array<{ name: string; x: number; y: number; radius: number }>>([]);
  const drawRef = useRef<() => void>(() => undefined);
  const timeRef = useRef(time);
  const modelRef = useRef(model);
  const modesRef = useRef(modes);
  const [hoveredMapItem, setHoveredMapItem] = useState<{ name: string; x: number; y: number; minute: number } | null>(null);

  useEffect(() => {
    timeRef.current = time;
    modelRef.current = model;
    modesRef.current = modes;
    drawRef.current();
  }, [time, model, modes]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    const refresh = () => drawRef.current();
    document.addEventListener('visibilitychange', refresh);

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
        maxBounds: city.maxBounds,
        maxBoundsViscosity: 0.8,
      });
      mapRef.current = map;
      map.setView([city.centre.lat, city.centre.lon], 10);
      L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', {
        maxZoom: 20,
        attribution: '&copy; <a href="https://stadiamaps.com/attribution/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      L.control.zoom({ position: 'topright' }).addTo(map);
      L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 110 }).addTo(map);

      const projectedRoutes = new Map<RouteCoordinate[], ScreenCoordinate[]>();
      let moving = false;
      let drawnCentre = map.latLngToContainerPoint([city.centre.lat, city.centre.lon]);
      let viewKey = '';
      const draw = () => {
        if (moving || document.hidden) return;
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
        canvas.style.transform = '';
        canvas.style.visibility = '';
        drawnCentre = map.latLngToContainerPoint([city.centre.lat, city.centre.lon]);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, box.width, box.height);
        const projectCoordinate = ([latitude, longitude]: RouteCoordinate): ScreenCoordinate => {
          const point = map.latLngToContainerPoint([latitude, longitude]);
          return [point.x, point.y];
        };
        const project = (place: Point) => projectCoordinate([place.lat, place.lon]);
        const centre = map.getCenter();
        const nextViewKey = `${map.getZoom()}:${centre.lat}:${centre.lng}:${box.width}:${box.height}`;
        if (nextViewKey !== viewKey) {
          viewKey = nextViewKey;
          projectedRoutes.clear();
        }
        const projectRoute = (route: RouteCoordinate[]) => {
          const cached = projectedRoutes.get(route);
          if (cached) return cached;
          const projected = route.map(projectCoordinate);
          projectedRoutes.set(route, projected);
          return projected;
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

        const homeShare = modelRef.current.commutersAtHomeShare(timeRef.current);
        const enabled = modesRef.current;
        const hoverPoints: typeof hoverPointsRef.current = [];
        mapData.communeNodes.forEach((node) => {
          const total = city.slug === 'geneva' && node.point.code === 'CH22'
            ? enabled.includes('car') ? node.byMode.car : 0
            : enabled.reduce((sum, mode) => sum + node.byMode[mode], 0);
          if (!total) return;
          const [x, y] = project(node.point);
          const radius = markerRadius(total);
          hoverPoints.push({ name: node.point.name, x, y, radius: Math.max(7, radius + 3) });
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(103,107,103,.18)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y, radius * (0.84 + homeShare * 0.16), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(88,92,88,${0.24 + homeShare * 0.38})`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,253,249,.72)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        });
        let incomingArrivals = 0;
        mapData.dots.forEach((dot) => {
          if (!enabled.includes(dot.corridor.mode)) return;
          const flow = flowAt(
            timeRef.current,
            dot.inbound,
            dot.outbound,
            dot.duration,
            dot.corridor.direction,
            dot.returnDuration,
          );
          if (!flow) return;
          const origin = project(dot.corridor.origin);
          const target = project(dot.corridor.target);
          const carRoute = flow.reverse ? dot.car?.toHome : dot.car?.toWork;
          const timedRoute = carRoute ?? (flow.reverse ? dot.walkBike?.toHome : dot.walkBike?.toWork)
            ?? (flow.reverse ? dot.scheduled?.toHome : dot.scheduled?.toWork);
          const start = timedRoute ? projectCoordinate(timedRoute.points[0]) : flow.reverse ? target : origin;
          const end = timedRoute ? projectCoordinate(timedRoute.points.at(-1)!) : flow.reverse ? origin : target;
          const route = dot.route ? projectRoute(dot.route) : undefined;
          const point = timedRoute
            ? projectCoordinate(carPosition(timedRoute, flow.progress * timedRoute.duration)) : route
            ? pointAlongPolyline(route, flow.reverse ? 1 - flow.progress : flow.progress)
            : curvePoint(start, end, flow.progress, dot.bend);
          const colour = flowMeta[flow.direction].colour;
          const blip = arrivalBlip(flow.progress);
          if (flow.direction === 'inbound') incomingArrivals += blip;
          if (blip > 0 && flow.direction !== 'inbound') {
            ctx.save();
            ctx.beginPath();
            ctx.arc(end[0], end[1], 3 + blip * 9, 0, Math.PI * 2);
            ctx.strokeStyle = colour;
            ctx.globalAlpha = 0.85 - blip * 0.6;
            ctx.lineWidth = 1.4;
            ctx.stroke();
            ctx.restore();
          }
          ctx.beginPath();
          const radius = carRoute ? Math.max(0.9 + sizeBlend * 0.5, dotSize * Math.sqrt(dot.weight / CAR_COMMUTERS_PER_DOT))
            : dot.corridor.mode === 'soft' ? 1.2 + sizeBlend : 1.5 + sizeBlend * 1.2;
          ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
          ctx.fillStyle = colour;
          ctx.fill();
          const journeyStart = flow.reverse ? dot.corridor.target : dot.corridor.origin;
          const journeyEnd = flow.reverse ? dot.corridor.origin : dot.corridor.target;
          hoverPoints.push({
            name: carRoute
              ? `${carPointName(journeyStart, city.slug)} → ${carPointName(journeyEnd, city.slug)} · ${Math.round(carRoute.duration)} min · ≈${formatNumber(dot.weight)} people`
              : dot.walkBike ? `${journeyStart.name} → ${journeyEnd.name} · ${dot.walkBike.costing === 'bicycle' ? 'Cycling' : 'Walking'} route · ${Math.round(timedRoute!.duration)} min (estimated)`
              : dot.scheduled ? `${journeyStart.name} → ${journeyEnd.name} · Sample timetable journey · ${Math.round(timedRoute!.duration)} min`
              : dot.train ? `${flow.reverse ? dot.train.to : dot.train.from} → ${flow.reverse ? dot.train.from : dot.train.to} · Estimated rail journey`
              : `${journeyStart.name} → ${journeyEnd.name}`,
            x: point[0],
            y: point[1],
            radius: 9,
          });
        });
        hoverPointsRef.current = hoverPoints;

        const [cityX, cityY] = project(city.centre);
        const delta = modelRef.current.populationChange(timeRef.current);
        const haloRadius = 28 * Math.sqrt(Math.abs(delta) / populationScale);
        if (haloRadius > 0.5) {
          const haloColour = flowMeta[delta >= 0 ? 'inbound' : 'outbound'].colour;
          ctx.beginPath();
          ctx.arc(cityX, cityY, haloRadius, 0, Math.PI * 2);
          ctx.fillStyle = haloColour + '24';
          ctx.fill();
          ctx.strokeStyle = haloColour + 'a6';
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
        const reception = Math.min(1, incomingArrivals / 3);
        if (reception > 0) {
          const cityEdge = map.latLngToContainerPoint([city.centre.lat, city.centre.lon + city.cityRadiusLongitude]);
          const cityRadius = Math.max(24, Math.abs(cityEdge.x - cityX));
          const glow = ctx.createRadialGradient(cityX, cityY, 0, cityX, cityY, cityRadius);
          glow.addColorStop(0, `rgba(194,65,63,${0.12 + reception * 0.12})`);
          glow.addColorStop(0.65, `rgba(194,65,63,${0.06 + reception * 0.08})`);
          glow.addColorStop(1, 'rgba(194,65,63,0)');
          ctx.beginPath();
          ctx.arc(cityX, cityY, cityRadius, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }
      };

      const requestDraw = () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
      };
      drawRef.current = requestDraw;
      // Move the existing image during a drag; redraw geometry when the map settles.
      map.on('movestart', () => { moving = true; setHoveredMapItem(null); });
      map.on('move', () => {
        const centre = map.latLngToContainerPoint([city.centre.lat, city.centre.lon]);
        canvas.style.transform = `translate(${centre.x - drawnCentre.x}px, ${centre.y - drawnCentre.y}px)`;
      });
      map.on('zoomstart', () => { canvas.style.visibility = 'hidden'; });
      map.on('moveend zoomend resize', () => { moving = false; requestDraw(); });
      observer = new ResizeObserver(() => {
        map.invalidateSize();
        requestDraw();
      });
      observer.observe(container);
      draw();
      onReady(true);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', refresh);
      drawRef.current = () => undefined;
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [city, mapData, populationScale, onReady]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons) { setHoveredMapItem(null); return; }
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let match: typeof hoverPointsRef.current[number] | undefined;
    let nearest = Infinity;
    hoverPointsRef.current.forEach((point) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= point.radius && distance < nearest) {
        match = point;
        nearest = distance;
      }
    });
    const tooltipX = Math.max(12, Math.min(x, box.width - Math.min(340, box.width - 24) - 12));
    setHoveredMapItem(match ? { name: match.name, x: tooltipX, y, minute: time } : null);
  };

  return (
    <div
      className="commuterMap"
      role="region"
      aria-label={`Interactive commuter map of greater ${city.name} at ${formatTime(time)}; ${city.name} population change ${formatDelta(model.populationChange(time))}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoveredMapItem(null)}
    >
      <div ref={mapElement} className="mapBase" />
      <canvas ref={canvasRef} className="commuterOverlay" aria-hidden="true" />
      {hoveredMapItem?.minute === time && (
        <div className="mapTooltip" style={{ left: hoveredMapItem.x, top: hoveredMapItem.y,
          transform: hoveredMapItem.y < 60 ? 'translateY(12px)' : 'translateY(calc(-100% - 12px))' }}>
          {hoveredMapItem.name}
        </div>
      )}
    </div>
  );
}

function PopulationChart({
  time,
  city,
  model,
  fullModel,
  modeLabel,
  onTimeChange,
  onScrubbingChange,
}: {
  time: number;
  city: CityConfig;
  model: DailyModel;
  fullModel: DailyModel;
  modeLabel: string;
  onTimeChange: (minute: number) => void;
  onScrubbingChange: (scrubbing: boolean) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(time);
  const drawRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    timeRef.current = time;
    drawRef.current();
  }, [time]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const deviations = model.populationSeries.map((point) => ({
      minute: point.minute,
      value: point.value - model.dailyAverage,
    }));
    const scaleValues = fullModel.populationSeries.map((p) => p.value - fullModel.dailyAverage);
    const rawMin = Math.min(...scaleValues, ...deviations.map((point) => point.value));
    const rawMax = Math.max(...scaleValues, ...deviations.map((point) => point.value));
    const range = Math.max(1, rawMax - rawMin);
    const min = rawMin - range * 0.1;
    const max = rawMax + range * 0.12;
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
      const width = box.width;
      const height = box.height;
      const pad = { top: 22, right: 8, bottom: 22, left: 8 };
      const x = (minute: number) => pad.left + minute / MINUTES_PER_DAY * (width - pad.left - pad.right);
      const y = (value: number) => pad.top + (max - value) / (max - min) * (height - pad.top - pad.bottom);
      const averageY = y(0);

      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(0,0,0,.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, averageY);
      ctx.lineTo(width - pad.right, averageY);
      ctx.stroke();
      ctx.setLineDash([]);

      const peakY = y(model.dailyPeak.value - model.dailyAverage);
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = '#c2413f';
      ctx.beginPath();
      ctx.moveTo(pad.left, peakY);
      ctx.lineTo(width - pad.right, peakY);
      ctx.stroke();
      ctx.setLineDash([]);

      const areaPath = () => {
        ctx.beginPath();
        ctx.moveTo(x(deviations[0].minute), averageY);
        deviations.forEach((point) => ctx.lineTo(x(point.minute), y(point.value)));
        ctx.lineTo(x(deviations.at(-1)!.minute), averageY);
        ctx.closePath();
      };

      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.left, pad.top, width - pad.left - pad.right, averageY - pad.top);
      ctx.clip();
      areaPath();
      ctx.fillStyle = 'rgba(194,65,63,.18)';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.left, averageY, width - pad.left - pad.right, height - pad.bottom - averageY);
      ctx.clip();
      areaPath();
      ctx.fillStyle = 'rgba(47,95,127,.24)';
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      deviations.forEach((point, index) => {
        if (index) ctx.lineTo(x(point.minute), y(point.value));
        else ctx.moveTo(x(point.minute), y(point.value));
      });
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.7;
      ctx.stroke();

      const currentX = x(timeRef.current);
      const currentDeviation = model.populationChange(timeRef.current) - model.dailyAverage;
      const currentY = y(currentDeviation);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(currentX, pad.top);
      ctx.lineTo(currentX, height - pad.bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(currentX, currentY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#d1dfe4';
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      ctx.fillStyle = '#6d6d6d';
      ctx.font = '9px ui-monospace, monospace';
      [0, 4, 8, 12, 16, 20, 24].forEach((hour) => {
        const labelX = x(hour * 60);
        ctx.textAlign = hour === 0 ? 'left' : hour === 24 ? 'right' : 'center';
        ctx.fillText(String(hour).padStart(2, '0'), labelX, height - 5);
      });
    };

    drawRef.current = draw;
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => { observer.disconnect(); drawRef.current = () => undefined; };
  }, [model, fullModel]);

  const currentDeviation = model.populationChange(time) - model.dailyAverage;
  return (
    <div className="populationChartWrap">
      <canvas
        ref={ref}
        className="populationChart"
        role="img"
        aria-label={`Modelled ${city.name} commuter population relative to its daily average (${modeLabel}). Current value ${formatDelta(currentDeviation)}; maximum ${formatDelta(model.dailyPeak.value - model.dailyAverage)}.`}
      />
      <input
        className="populationChartScrubber"
        aria-label="Time of day"
        aria-valuetext={formatTime(time)}
        type="range"
        min="0"
        max={MINUTES_PER_DAY}
        step="1"
        value={time}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          onScrubbingChange(true);
        }}
        onPointerUp={() => onScrubbingChange(false)}
        onPointerCancel={() => onScrubbingChange(false)}
        onLostPointerCapture={() => onScrubbingChange(false)}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) onScrubbingChange(true);
        }}
        onKeyUp={() => onScrubbingChange(false)}
        onBlur={() => onScrubbingChange(false)}
        onInput={(event) => onTimeChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

type CityOption = Pick<CityConfig, 'slug' | 'displayName'>;

function CityTitle({ city, cityOptions }: { city: CityConfig; cityOptions: CityOption[] }) {
  const router = useRouter();
  return (
    <h1>
      Commuting in{' '}
      <span className={`cityChoice${city.displayName.length > 12 ? ' longCity' : ''}`}>
        <select
          className="citySelect"
          aria-label="City"
          value={city.slug}
          onChange={(event) => router.push(`/${event.currentTarget.value}/`)}
        >
          {cityOptions.map((option) => (
            <option key={option.slug} value={option.slug}>{option.displayName}</option>
          ))}
        </select>
        <span aria-hidden="true">⌄</span>
      </span>
    </h1>
  );
}

function PlannedCity({ city, cityOptions }: { city: CityConfig; cityOptions: CityOption[] }) {
  return (
    <main>
      <header>
        <div className="dp-navbar">
          <div className="dp-navbar-title">
            <a className="dp-navbar-brand" href="/projects/">Daniel Pradilla</a>
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
      <section className="hero" id="top">
        <div className="intro">
          <CityTitle city={city} cityOptions={cityOptions} />
          <p className="lede">Journeys to work and back around {city.displayName}.</p>
        </div>
      </section>
      <section className="plannedCity" id="sources">
        <p className="eyebrow">Coming soon</p>
        <h2>{city.displayName} data is being checked.</h2>
        <p>The map will be available once the commuter counts have been checked.</p>
        <a href="../geneva/">View the Geneva map →</a>
      </section>
      <footer className="projectFooter">
        <div className="projectFooterContent">
          <a className="wordmark" href="#top">SWISS COMMUTES <span aria-hidden="true">🇨🇭</span> ↑</a>
          <p>Built in Geneva · Data: {city.dataYears}</p>
        </div>
        <div className="dp-footer">
          <span>© 2026 Daniel Pradilla</span>
          <nav aria-label="Footer navigation">
            <a href="/projects/">Projects</a>
            <a href="/blog/">Blog</a>
            <a href="https://github.com/danielpradilla/swiss-commutes">GitHub</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

type DashboardProps = { city: CityConfig; cityOptions: CityOption[]; summary: MapSummary; routesUrl: string };

function ReadyCity({ city, cityOptions, summary, routesUrl }: DashboardProps) {
  const [time, setTime] = useState(465);
  const [requestedClockMode, setClockMode] = useState<ClockMode>();
  const [scrubbing, setScrubbing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches, () => true);
  const clockMode = requestedClockMode ?? (reducedMotion || !mapReady ? 'paused' : 'fast');
  const [modes, setModes] = useState<Mode[]>(transportModes);
  const [mapData, setMapData] = useState<MapData>();
  const [mapError, setMapError] = useState<'failed' | 'changed'>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function loadMap() {
      try {
        const response = await fetch(routesUrl, { signal });
        if (!response.ok) throw new Error(`Route data: HTTP ${response.status}`);
        const routes: RouteData = await response.json();
        signal.throwIfAborted();
        if (routes.version !== new URL(routesUrl, window.location.href).searchParams.get('v')) {
          setMapError('changed');
          return;
        }
        const data = await prepareMapDataAsync(signal, city.data!.corridors, city.slug,
          unpackCarRoutes(routes.carRoutes), routes.railRoutes, routes.activeRoutes,
          routes.transitRoutes && unpackCarRoutes(routes.transitRoutes));
        if (!signal.aborted) setMapData(data);
      } catch {
        if (!signal.aborted) setMapError('failed');
      }
    }
    void loadMap();
    return () => controller.abort();
  }, [city, routesUrl, loadAttempt]);
  const journeys = useMemo(() => summary.journeyTimes.map(([index, duration, returnDuration]) => ({
    corridor: city.data!.corridors[index], duration, returnDuration,
  })), [city.data, summary]);
  const [selectedCommune, setSelectedCommune] = useState('');
  const communeOptions = useMemo(() => [...summary.communeNodes].sort((a, b) => a.point.name.localeCompare(b.point.name)), [summary]);
  const communeCode = selectedCommune || communeOptions[0]?.point.code;
  const communeJourneys = useMemo(() => journeys.filter(({ corridor: c }) =>
    (c.direction === 'inbound' ? c.origin.code : c.target.code) === communeCode && modes.includes(c.mode)), [journeys, communeCode, modes]);
  const fullModel = useMemo(() => createJourneyModel(journeys), [journeys]);
  const model = useMemo(() => modes.length === 3 ? fullModel : createJourneyModel(journeys, modes), [journeys, modes, fullModel]);
  const populationScale = useMemo(() => Math.max(1, ...fullModel.populationSeries.map((point) => Math.abs(point.value))), [fullModel]);
  const coverage = useMemo(() => transportModes.map((mode) => ({ mode,
    total: city.data!.corridors.filter((c) => c.mode === mode).reduce((n, c) => n + c.commuters, 0),
    routed: journeys.filter((j) => j.corridor.mode === mode).reduce((n, j) => n + j.corridor.commuters, 0),
  })), [city.data, journeys]);
  const sourcePeople = city.model!.populationGroups.reduce((n, group) => n + Math.abs(group.people), 0);
  const unknownPeople = city.data!.corridors.filter(c => c.mode === 'unknown').reduce((n, c) => n + c.commuters, 0);
  const mappedPeople = coverage.reduce((n, row) => n + row.total, 0) + unknownPeople;
  const modeLabel = modes.length === 3 ? 'All transport' : modes.length ? modes.map((mode) => transportLabels[mode]).join(' + ') : 'No modes selected';

  useEffect(() => {
    if (scrubbing || clockMode === 'paused') return;
    if (clockMode === 'realtime') {
      const sync = () => { if (!document.hidden) setTime(genevaTime()); };
      sync();
      const timer = window.setInterval(sync, 1_000);
      document.addEventListener('visibilitychange', sync);
      return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
    }
    let previous = performance.now();
    let frame = 0;
    const reset = () => { previous = performance.now(); };
    const advance = (now: number) => {
      const elapsed = Math.max(0, now - previous);
      previous = now;
      if (!document.hidden) setTime(current => (current + elapsed * playbackSpeed / 1_000) % MINUTES_PER_DAY);
      frame = requestAnimationFrame(advance);
    };
    document.addEventListener('visibilitychange', reset);
    frame = requestAnimationFrame(advance);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', reset); };
  }, [clockMode, scrubbing]);

  const stats = useMemo(() => ({
    transit: model.travelling(time),
    populationVsAverage: model.populationChange(time) - model.dailyAverage,
  }), [model, time]);

  return (
    <main>
      <header>
        <div className="dp-navbar">
          <div className="dp-navbar-title">
            <a className="dp-navbar-brand" href="/projects/">Daniel Pradilla</a>
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

      <section className="hero" id="top">
        <div className="intro">
          <CityTitle city={city} cityOptions={cityOptions} />
          <p className="lede">Journeys to work and back around {city.displayName}.</p>
        </div>
        <div className="clockBlock">
          <span>Time of day</span>
          <strong>{formatTime(time)}</strong>
          <small>{clockMode === 'realtime' ? 'CURRENT TIME' : clockMode === 'fast' ? 'FAST-FORWARD' : 'PAUSED'}</small>
        </div>
      </section>

      <section className="dashboard" aria-label={`${city.name} commuter map and current statistics`}>
        <div className="mapPanel">
          {mapData
            ? <MapCanvas time={time} city={city} model={model} modes={modes} populationScale={populationScale} mapData={mapData} onReady={setMapReady} />
            : <div className="commuterMap mapLoading" aria-busy={!mapError}>
              <p role="status">{mapError === 'changed' ? 'The route data has changed. Reload the page to load the updated map.'
                : mapError ? 'The map could not load. Counts and charts are still available.' : 'Loading map…'}</p>
              {mapError === 'changed' ? <button type="button" onClick={() => window.location.reload()}>Reload page</button>
                : mapError && <button type="button" onClick={() => { setMapError(undefined); setLoadAttempt(n => n + 1); }}>Retry map</button>}
            </div>}
          <div className="modeFilters" role="group" aria-label="Transport modes">
            {transportModes.map((mode) => <button key={mode} type="button" aria-pressed={modes.includes(mode)}
              aria-label={transportLabels[mode]} title={transportLabels[mode]}
              onClick={() => setModes((current) => transportModes.filter((m) => m === mode ? !current.includes(m) : current.includes(m)))}>
              <ModeIcon mode={mode} />
            </button>)}
          </div>
          <div className="mapNote">{modes.length ? 'Estimated modes & routes · Coverage incomplete' : 'No modes selected'}</div>
          <div className="flowLegend" aria-label="Flow direction colors">
            <span><i className="inbound" />Into {city.name}</span>
            <span><i className="outbound" />Out of {city.name}</span>
          </div>
        </div>

        <section className="timeline" aria-label="Commuter population relative to the daily average">
          <div className="chartHeader">
            <div>
              <p className="eyebrow">{city.name} population vs daily average · {modeLabel}</p>
              <strong>{formatDelta(stats.populationVsAverage)}</strong>
            </div>
            <div className="chartLegend">
              <span><i className="up" /> Above average</span>
              <span><i className="down" /> Below average</span>
              <span><i className="average" /> Daily average</span>
              <span><i className="maximum" /> Maximum</span>
            </div>
          </div>
          <PopulationChart
            time={time}
            city={city}
            model={model}
            fullModel={fullModel}
            modeLabel={modeLabel}
            onTimeChange={setTime}
            onScrubbingChange={setScrubbing}
          />
          <div className="controls">
            <div className="clockControls" aria-label="Clock speed">
              <button
                className="playButton"
                type="button"
                aria-label="Use the current time in Switzerland"
                aria-pressed={clockMode === 'realtime'}
                data-tooltip="Use current time"
                onClick={() => setClockMode(clockMode === 'realtime' ? 'paused' : 'realtime')}
              >Now</button>
              <button
                className="playButton"
                type="button"
                aria-label="Fast-forward through the day"
                aria-pressed={clockMode === 'fast'}
                data-tooltip="Fast-forward"
                onClick={() => setClockMode(clockMode === 'fast' ? 'paused' : 'fast')}
              >▶▶</button>
              <button
                className="playButton"
                type="button"
                aria-label="Pause the clock"
                aria-pressed={clockMode === 'paused'}
                data-tooltip="Pause"
                onClick={() => setClockMode('paused')}
              >Ⅱ</button>
            </div>
            <output aria-live="off">{formatTime(time)}</output>
          </div>
        </section>

        <aside className="statRail" aria-live={clockMode === 'paused' ? 'polite' : 'off'}>
          <div>
            <span>Travelling now</span>
            <strong>{formatNumber(stats.transit)}</strong>
            <small>estimated people on selected routes</small>
          </div>
          <div>
            <span>Population vs daily average</span>
            <strong className={stats.populationVsAverage >= 0 ? 'positive' : 'negative'}>
              {formatDelta(stats.populationVsAverage)}
            </strong>
            <small>estimated people on selected routes</small>
          </div>
          <div className="peakStat">
            <span>Daily peak</span>
            <strong>{formatDelta(model.dailyPeak.value - model.dailyAverage)}</strong>
            <small>{modes.length ? `above average at ${formatTime(model.dailyPeak.minute)}` : 'no modes selected'}</small>
          </div>
          <p className="dotKey">An illustrative working day. The map and chart use the same routed commuters and journey times.</p>
          <details className="routeCoverage"><summary>Route coverage</summary>
            <p>{formatNumber(mappedPeople)} of {formatNumber(sourcePeople)} commuters in the source cohort have mapped commune pairs.</p>
            {coverage.map(({ mode, total, routed }) => <p key={mode}>{transportLabels[mode]}: {formatNumber(routed)} / {formatNumber(total)} ({total ? Math.round(routed / total * 100) : 0}%)</p>)}
            {unknownPeople > 0 && <p>{formatNumber(unknownPeople)} people have an unspecified mode. They are included in source totals and excluded from the three mode filters, chart and travelling counter.</p>}
            <p>People in mapped commune pairs, both directions. Unrouted journeys are excluded from the chart and travelling counter.</p>
            {city.slug === 'geneva' && <p>Swiss totals cover Vaud only. Other cantons and unknown destinations are outside this model.</p>}
          </details>
          <details className="routeCoverage">
            <summary>Commune journeys</summary>
            <label>Commune
              <select className="communeSelect" value={communeCode ?? ''} onChange={event => setSelectedCommune(event.currentTarget.value)}>
                {communeOptions.map(({ point }) => <option key={point.code} value={point.code}>{point.name}</option>)}
              </select>
            </label>
            {communeJourneys.length ? <ul>{communeJourneys.map(({ corridor: c, duration, returnDuration }) =>
              <li key={`${c.origin.code}:${c.target.code}:${c.mode}:${c.direction}`}>
                {c.origin.name} → {c.target.name} · {transportLabels[c.mode]} · ≈{formatNumber(c.commuters)} people · {Math.round(duration)} min to work / {Math.round(returnDuration)} min home (estimated)
              </li>)}</ul> : <p>No journeys for the selected modes.</p>}
          </details>
        </aside>
      </section>

      <section className="method" id="sources">
        <div className="methodIntro">
          <p className="eyebrow">Commuter data · {city.dataYears}</p>
          <h2>About the data</h2>
          <p>
            The counts come from published commuting statistics. Routes and travel times are
            estimates for an illustrative working day. The map doesn’t show live traffic.
          </p>
        </div>
        <div className="sourceGrid">
          {city.sources!.map((source, index) => (
            <a key={source.href} href={source.href} target="_blank" rel="noreferrer">
              <span>{String(index + 1).padStart(2, '0')} · {source.label}</span><strong>{source.name}</strong>
              <p>{source.description}</p>
            </a>
          ))}
        </div>
        <div className="methodNote">
          <strong>How to read the map</strong>
          <div>
            <p>{city.methodNote} Each moving dot represents a group of commuters. Larger circles mean more commuters.</p>
            <p>The buttons filter the map, chart and city circle together. The chart counts arrivals at workplace endpoints and departures from home endpoints; it does not measure crossings of city boundaries. It includes routed journeys only. This is an illustrative working day without attendance, weekend or holiday adjustments.</p>
            {city.slug === 'geneva' && <p>Geneva uses sample morning and return journeys from the Swiss timetable for 8 September 2026, including cross-border buses, trains, walks to stops and transfer waiting. These provide possible routes and journey times. They do not tell us which service each commuter uses. The animation spreads departures across a typical working day; it does not show a live timetable.</p>}
            <p>Where no timetable journey is available, Swiss rail paths follow the federal transport model’s 2023 network between selected stations. These paths use estimated travel times and do not establish a valid service or passenger count. Bus connections, transfers and routes abroad may still be missing.{city.slug !== 'geneva' && ' Other public transport shows a small sample.'}</p>
            <p>Where only resident shares are available, walk/bike is the residual after motorised and public transport and may include other modes. The six-city study explicitly identifies walking/cycling. Only local routes up to 25 km between endpoints are considered. Valhalla uses walking within 3 km and cycling beyond that. Routes over 35 km or three hours are excluded from both map and chart. French records explicitly distinguish walking and cycling; no-journey records are excluded.</p>
            {summary.hasRoadRoutes && <>
              <p>Routes cover at least 95% of mapped car / motorcycle estimates in each direction, with separate journeys to work and home.
                Moving dots follow these routes over the basemap.
                Departure times are estimated; journey times come from Valhalla. The counts include people travelling by car or motorcycle,
                not vehicles, and don’t account for traffic jams.</p>
              <p>Routes start and end near town and village centres or French town halls, with commune centres where needed.
                {city.slug === 'geneva' && <> Geneva covers the canton. French workplace communes are retained. Swiss journeys cover Vaud in both directions; other cantons and unknown locations are outside this map.</>}
              </p>
            </>}
          </div>
        </div>
      </section>

      <footer className="projectFooter">
        <div className="projectFooterContent">
          <a className="wordmark" href="#top">SWISS COMMUTES <span aria-hidden="true">🇨🇭</span> ↑</a>
          <p>Built in Geneva · Data: {city.dataYears}</p>
        </div>
        <div className="dp-footer">
          <span>© 2026 Daniel Pradilla</span>
          <nav aria-label="Footer navigation">
            <a href="/projects/">Projects</a>
            <a href="/blog/">Blog</a>
            <a href="https://github.com/danielpradilla/swiss-commutes">GitHub</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

export default function CommuteDashboard({ city, cityOptions, summary, routesUrl }: DashboardProps) {
  if (!city.data || !city.model) return <PlannedCity city={city} cityOptions={cityOptions} />;
  return <ReadyCity key={city.slug} city={city} cityOptions={cityOptions} summary={summary} routesUrl={routesUrl} />;
}
