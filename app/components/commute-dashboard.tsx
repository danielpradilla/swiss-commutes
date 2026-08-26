'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Map as LeafletMap, TileLayer } from 'leaflet';
import type { CityConfig } from '../cities';
import { routeGeometries } from '../data/route-geometries';
import type { Corridor, Mode, Point } from '../data/types';
import {
  arrivalBlip,
  createDailyModel,
  flowAt,
  formatTime,
  MINUTES_PER_DAY,
} from '../model';
import { decodePolyline, pointAlongPolyline, routeKey, type RouteCoordinate, type ScreenCoordinate } from '../route-geometry';

const ROUTED_GEOMETRY_ENABLED = true;
type Basemap =
  | 'swisstopo'
  | 'positron'
  | 'stadiaOutdoors'
  | 'stadiaStamenToner'
  | 'stadiaStamenTonerLite';

type BasemapMeta = {
  label: string;
  stadiaVariant?: string;
};

const basemapMeta: Record<Basemap, BasemapMeta> = {
  swisstopo: { label: 'SwissFederalGeoportal.NationalMapGrey' },
  positron: { label: 'CartoDB.Positron' },
  stadiaOutdoors: { label: 'Stadia.Outdoors', stadiaVariant: 'outdoors' },
  stadiaStamenToner: { label: 'Stadia.StamenToner', stadiaVariant: 'stamen_toner' },
  stadiaStamenTonerLite: { label: 'Stadia.StamenTonerLite', stadiaVariant: 'stamen_toner_lite' },
};

function createBasemapLayer(L: typeof import('leaflet'), basemap: Basemap) {
  if (basemap === 'positron') {
    return L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    });
  }
  const stadia = basemapMeta[basemap];
  if (stadia.stadiaVariant) {
    return L.tileLayer(`https://tiles.stadiamaps.com/tiles/${stadia.stadiaVariant}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 20,
      attribution: `&copy; Stadia Maps${stadia.stadiaVariant.startsWith('stamen_') ? ' &copy; Stamen Design' : ''} &copy; OpenMapTiles &copy; OpenStreetMap`,
    });
  }
  return L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.swisstopo.admin.ch/">swisstopo</a>',
  });
}

const modeMeta: Record<Mode, { label: string }> = {
  car: { label: 'Car' },
  transit: { label: 'Public transport' },
  soft: { label: 'Bike & foot' },
};

function ModeIcon({ mode }: { mode: Mode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {mode === 'car' && <><path d="M4 15v-3l2-5h12l2 5v3H4Z" /><path d="M6 12h12" /><circle cx="7" cy="16.5" r="1.5" /><circle cx="17" cy="16.5" r="1.5" /></>}
      {mode === 'transit' && <><rect x="6" y="3" width="12" height="15" rx="3" /><path d="M8.5 7h7M8 13h8M9 21l2-3m4 0 2 3" /><circle cx="9" cy="15" r="1" /><circle cx="15" cy="15" r="1" /></>}
      {mode === 'soft' && <><circle cx="6" cy="16" r="3" /><circle cx="18" cy="16" r="3" /><path d="m6 16 4-7 3 7h-7m4-7h4m-1 7 3-6h-3" /></>}
    </svg>
  );
}

const flowMeta = {
  inbound: { colour: '#c2413f' },
  outbound: { colour: '#2f5f7f' },
};

type CommuneNode = { point: Point; total: number; byMode: Record<Mode, number> };

const markerRadius = (commuters: number) => Math.max(1.8, Math.min(9, Math.sqrt(commuters / 160)));

const hash = (value: number) => {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

function prepareMapData(corridors: Corridor[], citySlug: string) {
  const routes = corridors.map((corridor) => {
    const encoded = ROUTED_GEOMETRY_ENABLED ? routeGeometries[routeKey(citySlug, corridor)] : undefined;
    return encoded ? decodePolyline(encoded) : undefined;
  });
  const communeNodes = Array.from(corridors.reduce((nodes, corridor) => {
    const remote = corridor.direction === 'inbound' ? corridor.origin : corridor.target;
    const node = nodes.get(remote.code) ?? {
      point: remote,
      total: 0,
      byMode: { car: 0, transit: 0, soft: 0 },
    };
    node.total += corridor.commuters;
    node.byMode[corridor.mode] += corridor.commuters;
    nodes.set(remote.code, node);
    return nodes;
  }, new Map<string, CommuneNode>()).values());

  const primaryCorridorByCommune = new Map<string, number>();
  corridors.forEach((corridor, index) => {
    const code = corridor.direction === 'inbound' ? corridor.origin.code : corridor.target.code;
    const primary = primaryCorridorByCommune.get(code);
    if (primary === undefined || corridors[primary].commuters < corridor.commuters) {
      primaryCorridorByCommune.set(code, index);
    }
  });

  const dots = corridors.flatMap((corridor, corridorIndex) => {
    const route = routes[corridorIndex];
    if (ROUTED_GEOMETRY_ENABLED && !route) return [];
    return Array.from({
      length: Math.floor(corridor.commuters / 900) +
        (primaryCorridorByCommune.get(
          corridor.direction === 'inbound' ? corridor.origin.code : corridor.target.code,
        ) === corridorIndex ? 1 : 0),
    }, (_, index) => {
      const seed = corridorIndex * 101 + index + 1;
      const distance = Math.hypot(
        corridor.origin.lat - corridor.target.lat,
        corridor.origin.lon - corridor.target.lon,
      );
      return {
        corridor,
        route,
        bend: (hash(seed * 5) - 0.5) * 0.18,
        inbound: 285 + Math.pow(hash(seed), 1.25) * 285,
        outbound: 895 + Math.pow(hash(seed * 3), 0.9) * 260,
        duration: 16 + distance * 115 + hash(seed * 7) * 15,
      };
    });
  });

  const routedCorridors = corridors.flatMap((corridor, index) =>
    routes[index] ? [{ corridor, route: routes[index] }] : []);
  return { communeNodes, dots, routedCorridors };
}

const formatNumber = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');
const formatDelta = (value: number) => `${value >= 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;
type ClockMode = 'realtime' | 'fast' | 'paused';

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
type MapData = ReturnType<typeof prepareMapData>;

function MapCanvas({
  time,
  modes,
  basemap,
  city,
  model,
  mapData,
}: {
  time: number;
  modes: Record<Mode, boolean>;
  basemap: Basemap;
  city: CityConfig;
  model: DailyModel;
  mapData: MapData;
}) {
  const mapElement = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileLayerRef = useRef<TileLayer | null>(null);
  const hoverPointsRef = useRef<Array<{ name: string; x: number; y: number; radius: number }>>([]);
  const drawRef = useRef<() => void>(() => undefined);
  const timeRef = useRef(time);
  const modesRef = useRef(modes);
  const basemapRef = useRef(basemap);
  const [hoveredMapItem, setHoveredMapItem] = useState<{ name: string; x: number; y: number } | null>(null);

  useEffect(() => {
    timeRef.current = time;
    modesRef.current = modes;
    basemapRef.current = basemap;
    drawRef.current();
  }, [time, modes, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !mapRef.current) return;
      const layer = createBasemapLayer(L, basemap);
      tileLayerRef.current?.remove();
      tileLayerRef.current = layer.addTo(map);
    });
    return () => { disposed = true; };
  }, [basemap]);

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
        maxBounds: city.maxBounds,
        maxBoundsViscosity: 0.8,
      });
      mapRef.current = map;
      map.setView([city.centre.lat, city.centre.lon], 10);
      tileLayerRef.current = createBasemapLayer(L, basemapRef.current).addTo(map);
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
        const projectCoordinate = ([latitude, longitude]: RouteCoordinate): ScreenCoordinate => {
          const point = map.latLngToContainerPoint([latitude, longitude]);
          return [point.x, point.y];
        };
        const project = (place: Point) => projectCoordinate([place.lat, place.lon]);
        const projectedRoutes = new Map<RouteCoordinate[], ScreenCoordinate[]>();
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

        const homeShare = model.commutersAtHomeShare(timeRef.current);
        const hoverPoints: typeof hoverPointsRef.current = [];
        mapData.routedCorridors.forEach(({ corridor, route }) => {
          if (!modesRef.current[corridor.mode]) return;
          const points = projectRoute(route);
          if (points.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(points[0][0], points[0][1]);
          points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = 'rgba(35, 38, 37, .52)';
          ctx.lineWidth = 1.25;
          ctx.stroke();
          ctx.setLineDash([]);
        });
        mapData.communeNodes.forEach((node) => {
          const [x, y] = project(node.point);
          const visible = (Object.keys(modeMeta) as Mode[]).reduce(
            (sum, mode) => sum + (modesRef.current[mode] ? node.byMode[mode] : 0),
            0,
          );
          const radius = markerRadius(node.total);
          hoverPoints.push({ name: node.point.name, x, y, radius: Math.max(7, radius + 3) });
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(103,107,103,.18)';
          ctx.fill();
          if (!visible) return;
          ctx.beginPath();
          ctx.arc(x, y, markerRadius(visible) * (0.84 + homeShare * 0.16), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(88,92,88,${0.24 + homeShare * 0.38})`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,253,249,.72)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        });
        let incomingArrivals = 0;
        mapData.dots.forEach((dot) => {
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
          const tailProgress = Math.max(0, flow.progress - 0.09);
          const route = dot.route ? projectRoute(dot.route) : undefined;
          const point = route
            ? pointAlongPolyline(route, flow.reverse ? 1 - flow.progress : flow.progress)
            : curvePoint(start, end, flow.progress, dot.bend);
          const tail = route
            ? pointAlongPolyline(route, flow.reverse ? 1 - tailProgress : tailProgress)
            : curvePoint(start, end, tailProgress, dot.bend);
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
          ctx.moveTo(tail[0], tail[1]);
          ctx.lineTo(point[0], point[1]);
          ctx.strokeStyle = colour + '8a';
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(point[0], point[1], dot.corridor.mode === 'soft' ? 2.2 : 2.7, 0, Math.PI * 2);
          ctx.fillStyle = colour;
          ctx.fill();
          const journeyStart = flow.reverse ? dot.corridor.target : dot.corridor.origin;
          const journeyEnd = flow.reverse ? dot.corridor.origin : dot.corridor.target;
          hoverPoints.push({
            name: `${journeyStart.name} → ${journeyEnd.name}`,
            x: point[0],
            y: point[1],
            radius: 9,
          });
        });
        hoverPointsRef.current = hoverPoints;

        const [cityX, cityY] = project(city.centre);
        const delta = model.populationChange(timeRef.current);
        const haloRadius = 28 * Math.sqrt(Math.abs(delta) / model.dailyPeak.value);
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
      tileLayerRef.current = null;
    };
  }, [city, mapData, model]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
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
    setHoveredMapItem(match ? { name: match.name, x, y } : null);
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
      {hoveredMapItem && (
        <div className="mapTooltip" style={{ left: hoveredMapItem.x, top: hoveredMapItem.y }}>
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
  onTimeChange,
}: {
  time: number;
  city: CityConfig;
  model: DailyModel;
  onTimeChange: (minute: number) => void;
}) {
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
      const deviations = model.populationSeries.map((point) => ({
        minute: point.minute,
        value: point.value - model.dailyAverage,
      }));
      const rawMin = Math.min(...deviations.map((point) => point.value));
      const rawMax = Math.max(...deviations.map((point) => point.value));
      const range = Math.max(1, rawMax - rawMin);
      const min = rawMin - range * 0.1;
      const max = rawMax + range * 0.12;
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

      const currentX = x(time);
      const currentDeviation = model.populationChange(time) - model.dailyAverage;
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

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [model, time]);

  const currentDeviation = model.populationChange(time) - model.dailyAverage;
  return (
    <div className="populationChartWrap">
      <canvas
        ref={ref}
        className="populationChart"
        role="img"
        aria-label={`Modelled ${city.name} commuter population relative to its daily average. Current value ${formatDelta(currentDeviation)}; maximum ${formatDelta(model.dailyPeak.value - model.dailyAverage)}.`}
      />
      <input
        className="populationChartScrubber"
        aria-label="Time of day"
        type="range"
        min="0"
        max={MINUTES_PER_DAY}
        step="1"
        value={time}
        onInput={(event) => onTimeChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

type CityOption = Pick<CityConfig, 'slug' | 'displayName'>;

function CityTitle({ city, cityOptions }: { city: CityConfig; cityOptions: CityOption[] }) {
  return (
    <h1>
      How{' '}
      <span className={`cityChoice${city.displayName.length > 12 ? ' longCity' : ''}`}>
        <select
          className="citySelect"
          aria-label="City"
          value={city.slug}
          onChange={(event) => window.location.assign(`/swiss-commutes/${event.currentTarget.value}/`)}
        >
          {cityOptions.map((option) => (
            <option key={option.slug} value={option.slug}>{option.displayName}</option>
          ))}
        </select>
        <span aria-hidden="true">⌄</span>
      </span>
      <br />breathes.
    </h1>
  );
}

function PlannedCity({ city, cityOptions }: { city: CityConfig; cityOptions: CityOption[] }) {
  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="#top">SWISS COMMUTES / 24H</a>
        <p>One weekday, in motion</p>
        <a href="../geneva/">View live city →</a>
      </header>
      <section className="hero" id="top">
        <div className="intro">
          <p className="eyebrow">A commuter portrait · {city.dataYears}</p>
          <CityTitle city={city} cityOptions={cityOptions} />
          <p className="lede">Follow a weekday of commuting in {city.displayName}, commune by commune, across {city.neighbours}.</p>
        </div>
      </section>
      <section className="plannedCity">
        <p className="eyebrow">City route ready</p>
        <h2>{city.displayName} data is next.</h2>
        <p>The map is ready. This page will go live once its commuter counts have been checked.</p>
        <a href="../geneva/">View the completed Geneva portrait →</a>
      </section>
      <footer>
        <a className="wordmark" href="#top">SWISS COMMUTES / 24H ↑</a>
        <p>Independent data portrait · built in Geneva</p>
      </footer>
    </main>
  );
}

function ReadyCity({ city, cityOptions }: { city: CityConfig; cityOptions: CityOption[] }) {
  const [time, setTime] = useState(465);
  const [clockMode, setClockMode] = useState<ClockMode>('realtime');
  const [modes, setModes] = useState<Record<Mode, boolean>>({
    car: true,
    transit: true,
    soft: true,
  });
  const basemap: Basemap = 'stadiaOutdoors';
  const model = useMemo(() => createDailyModel(city.model!), [city.model]);
  const mapData = useMemo(() => prepareMapData(city.data!.corridors, city.slug), [city.data, city.slug]);

  useEffect(() => {
    if (clockMode === 'paused') return;
    if (clockMode === 'realtime') {
      const sync = () => setTime(genevaTime());
      sync();
      const timer = window.setInterval(sync, 1_000);
      return () => window.clearInterval(timer);
    }
    const timer = window.setInterval(() => setTime((current) =>
      (current + 5) % MINUTES_PER_DAY), 70);
    return () => window.clearInterval(timer);
  }, [clockMode]);

  const stats = useMemo(() => ({
    transit: model.commutersInTransit(time),
    population: model.populationChange(time),
    populationVsAverage: model.populationChange(time) - model.dailyAverage,
  }), [model, time]);

  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="#top">SWISS COMMUTES / 24H</a>
        <p>One weekday, in motion</p>
        <a href="#sources">Sources & method ↓</a>
      </header>

      <section className="hero" id="top">
        <div className="intro">
          <p className="eyebrow">A commuter portrait · {city.dataYears} source data</p>
          <CityTitle city={city} cityOptions={cityOptions} />
          <p className="lede">Follow a weekday of commuting in {city.displayName}, commune by commune, across {city.neighbours}.</p>
        </div>
        <div className="clockBlock">
          <span>Local time</span>
          <strong>{formatTime(time)}</strong>
          <small>{clockMode === 'realtime' ? 'REAL TIME ESTIMATE' : clockMode === 'fast' ? 'FAST-FORWARD' : 'PAUSED'}</small>
        </div>
      </section>

      <section className="dashboard" aria-label={`${city.name} commuter map and current statistics`}>
        <div className="mapPanel">
          <MapCanvas time={time} modes={modes} basemap={basemap} city={city} model={model} mapData={mapData} />
          <div className="mapNote">{basemapMeta[basemap].label} · {formatNumber(city.data!.summary.originCommunes)} communes · {mapData.routedCorridors.length} routed preview paths</div>
          <div className="modeFilters" aria-label="Show transport modes">
            {(Object.keys(modeMeta) as Mode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={modes[mode]}
                aria-label={`${modeMeta[mode].label} filter`}
                data-tooltip={modeMeta[mode].label}
                onClick={() => setModes((current) => ({ ...current, [mode]: !current[mode] }))}
              >
                <ModeIcon mode={mode} />
              </button>
            ))}
          </div>
          <div className="flowLegend" aria-label="Flow direction colors">
            <span><i className="inbound" />Into {city.name}</span>
            <span><i className="outbound" />Out of {city.name}</span>
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
            <span>Population vs average</span>
            <strong className={stats.populationVsAverage >= 0 ? 'positive' : 'negative'}>
              {formatDelta(stats.populationVsAverage)}
            </strong>
            <small>estimated people</small>
          </div>
          <div className="peakStat">
            <span>Maximum</span>
            <strong>{formatDelta(model.dailyPeak.value - model.dailyAverage)}</strong>
            <small>above average at {formatTime(model.dailyPeak.minute)}</small>
          </div>
          <p className="dotKey">Circles shrink while commuters are away and flash when a journey arrives. Trips into {city.name} light the city as a whole because the data stops at the commune boundary.</p>
        </aside>
      </section>

      <section className="timeline" aria-label="Commuter population relative to the daily average">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">{city.name} vs daily average</p>
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
          onTimeChange={(minute) => {
            setClockMode('paused');
            setTime(minute);
          }}
        />
        <div className="controls">
          <div className="clockControls" aria-label="Clock speed">
            <button
              className="playButton"
              type="button"
              aria-label="Follow Swiss local time estimate"
              aria-pressed={clockMode === 'realtime'}
              data-tooltip="Real-time estimate"
              onClick={() => setClockMode((current) => current === 'realtime' ? 'paused' : 'realtime')}
            >▶</button>
            <button
              className="playButton"
              type="button"
              aria-label="Fast-forward through the day"
              aria-pressed={clockMode === 'fast'}
              data-tooltip="Fast-forward"
              onClick={() => setClockMode((current) => current === 'fast' ? 'paused' : 'fast')}
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
          <output>{formatTime(time)}</output>
        </div>
      </section>

      <section className="method" id="sources">
        <div className="methodIntro">
          <p className="eyebrow">Sources & method</p>
          <h2>The data is published.<br /><em>The timing is modelled.</em></h2>
          <p>
            The source tables tell us where commuters live and work. Some also record their usual
            way of travelling. None says when anyone left home, which road they took or how long the
            trip lasted. Those parts are modelled so the map can move.
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
          <strong>What the dots mean</strong>
          <p>
            {city.methodNote} Each moving dot stands for a bundle of trips, not one person.
            Circle size follows commuter count. Routes are simplified and timing is approximate.
          </p>
        </div>
      </section>

      <footer>
        <a className="wordmark" href="#top">SWISS COMMUTES / 24H ↑</a>
        <p>Independent data portrait · built in Geneva · {city.dataYears}</p>
      </footer>
    </main>
  );
}

export default function CommuteDashboard({ city, cityOptions }: { city: CityConfig; cityOptions: CityOption[] }) {
  if (!city.data || !city.model) return <PlannedCity city={city} cityOptions={cityOptions} />;
  return <ReadyCity city={city} cityOptions={cityOptions} />;
}
