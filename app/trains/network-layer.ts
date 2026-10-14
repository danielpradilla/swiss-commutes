import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { Coords, DoneCallback, GridLayer, Map as LeafletMap } from 'leaflet';
import type * as Leaflet from 'leaflet';
import { networkModes } from './train-data.ts';
import type { VehicleMode } from './train-data';

export type NetworkStatus = 'loading' | 'ready' | 'unavailable';
export interface NetworkLayer extends GridLayer {
  setModes(enabled: readonly VehicleMode[]): void;
}
type NetworkLine = { modes: VehicleMode[]; extent: number; parts: { x: number; y: number }[][] };
type Tile = { canvas: HTMLCanvasElement; coords: Coords; done: DoneCallback; settled: boolean; controller?: AbortController; lines?: NetworkLine[]; error: boolean };

export function decodeNetwork(buffer: ArrayBuffer): NetworkLine[] {
  if (!buffer.byteLength) throw new Error('Empty network tile');
  const tile = new VectorTile(new PbfReader(buffer));
  const lines: NetworkLine[] = [];
  // Name-layer paths stitch the same roads for labels; avoid drawing them twice.
  const layer = tile.layers.transportation ?? tile.layers.transportation_name;
  if (!layer) return lines;
  if (!Number.isInteger(layer.extent) || layer.extent <= 0 || layer.extent > 65536) throw new Error('Invalid network extent');
  for (let index = 0; index < layer.length; index++) {
    const feature = layer.feature(index);
    if (feature.type !== 2) continue;
    const modes = networkModes(feature.properties);
    if (!modes.length) continue;
    const parts = feature.loadGeometry();
    for (const part of parts) for (const point of part) {
      if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y) || Math.abs(point.x) > layer.extent * 16 || Math.abs(point.y) > layer.extent * 16) {
        throw new Error('Invalid network coordinate');
      }
    }
    lines.push({ modes, extent: layer.extent, parts });
  }
  return lines;
}

export function drawNetwork(context: CanvasRenderingContext2D, width: number, height: number, lines: NetworkLine[], enabled: readonly VehicleMode[], lineWidth = 1.5): void {
  context.clearRect(0, 0, width, height);
  context.strokeStyle = '#8c969b';
  context.lineWidth = lineWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  for (const line of lines) {
    if (!line.modes.some(mode => enabled.includes(mode))) continue;
    const scaleX = width / line.extent;
    const scaleY = height / line.extent;
    for (const part of line.parts) {
      if (part.length < 2) continue;
      context.moveTo(part[0].x * scaleX, part[0].y * scaleY);
      for (let index = 1; index < part.length; index++) context.lineTo(part[index].x * scaleX, part[index].y * scaleY);
    }
  }
  context.stroke();
}

export function createNetworkLayer(L: typeof Leaflet, city: string, initialModes: readonly VehicleMode[], status: (value: NetworkStatus) => void): NetworkLayer {
  return new class extends L.GridLayer {
    private enabled = initialModes;
    private active = false;
    private mapInstance: LeafletMap | null = null;
    private tiles = new Map<HTMLCanvasElement, Tile>();
    private cache = new Map<string, NetworkLine[]>();
    private repaint = () => {
      for (const tile of this.tiles.values()) {
        if (!tile.lines) continue;
        try { this.draw(tile); tile.error = false; } catch { tile.error = true; }
      }
      this.report();
    };

    constructor() {
      super({ pane: 'transit-context', minZoom: 7, maxZoom: 17, maxNativeZoom: 14, tileSize: 256, opacity: .55, keepBuffer: 1,
        attribution: 'Network: <a href="https://developer.geops.io/apis/maps/">geOps Maps</a> / <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });
      this.on('tileunload', event => {
        const canvas = event.tile as unknown as HTMLCanvasElement;
        this.tiles.get(canvas)?.controller?.abort();
        this.tiles.delete(canvas);
        this.report();
      });
    }

    onAdd(map: LeafletMap): this {
      this.active = true;
      this.mapInstance = map;
      map.on('zoomend', this.repaint);
      return super.onAdd(map);
    }

    onRemove(map: LeafletMap): this {
      this.active = false;
      map.off('zoomend', this.repaint);
      this.mapInstance = null;
      for (const tile of this.tiles.values()) tile.controller?.abort();
      this.tiles.clear();
      return super.onRemove(map);
    }

    setModes(enabled: readonly VehicleMode[]): void {
      if (enabled.length === this.enabled.length && enabled.every(mode => this.enabled.includes(mode))) return;
      this.enabled = enabled;
      for (const tile of this.tiles.values()) {
        tile.controller?.abort();
        if (tile.lines) {
          try { this.draw(tile); tile.error = false; } catch { tile.error = true; }
        } else void this.load(tile);
      }
      this.report();
    }

    protected createTile(coords: Coords, done: DoneCallback): HTMLElement {
      const canvas = document.createElement('canvas');
      const size = this.getTileSize();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(size.x * ratio);
      canvas.height = Math.round(size.y * ratio);
      canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
      const tile: Tile = { canvas, coords, done, settled: false, error: false };
      this.tiles.set(canvas, tile);
      // Leaflet must register the returned tile before a cached tile calls done.
      void Promise.resolve().then(() => this.load(tile));
      return canvas;
    }

    private async load(tile: Tile): Promise<void> {
      if (!this.active || !this.tiles.has(tile.canvas)) return;
      const controller = new AbortController();
      tile.controller = controller;
      tile.error = false;
      this.report();
      const current = () => this.active && this.tiles.get(tile.canvas) === tile && tile.controller === controller && !controller.signal.aborted;
      try {
        const { z, x, y } = tile.coords;
        if (![z, x, y].every(Number.isInteger) || z < 7 || z > 14 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('Invalid network tile coordinates');
        const key = `${z}/${x}/${y}`;
        let lines = this.cache.get(key);
        if (!lines) {
          const response = await fetch(`/projects/swiss-commutes/trains/network.php?city=${encodeURIComponent(city)}&z=${z}&x=${x}&y=${y}`, { signal: controller.signal });
          if (!response.ok) throw new Error('Network tile unavailable');
          lines = response.status === 204 ? [] : decodeNetwork(await response.arrayBuffer());
          if (!current()) return;
          this.cache.set(key, lines);
          if (this.cache.size > 96) this.cache.delete(this.cache.keys().next().value!);
        }
        if (!current()) return;
        tile.lines = lines;
        this.draw(tile);
        if (!tile.settled) { tile.settled = true; tile.done(undefined, tile.canvas); }
      } catch (error) {
        if (!current()) return;
        tile.error = true;
        if (!tile.settled) { tile.settled = true; tile.done(error instanceof Error ? error : new Error('Network tile unavailable'), tile.canvas); }
      } finally {
        if (current()) { tile.controller = undefined; this.report(); }
      }
    }

    private draw(tile: Tile): void {
      const context = tile.canvas.getContext('2d');
      if (!context) throw new Error('Network canvas unavailable');
      const size = this.getTileSize();
      const scale = 2 ** ((this.mapInstance?.getZoom() ?? tile.coords.z) - tile.coords.z);
      drawNetwork(context, size.x, size.y, tile.lines ?? [], this.enabled, 1.5 / scale);
    }

    private report(): void {
      if (!this.active) return;
      let loading = !this.tiles.size;
      for (const tile of this.tiles.values()) {
        if (tile.error) { status('unavailable'); return; }
        if (!tile.lines) loading = true;
      }
      status(loading ? 'loading' : 'ready');
    }
  }();
}
