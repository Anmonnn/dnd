/**
 * `npm run maps:land -- <mapId> [--debug] [--open=2] [--min-area=30] [--simplify=0.8]`
 * Маска суши из растрового арта → world/maps/<id>/land.geojson. По ней компилятор обрезает
 * государства и регионы по береговой линии, так что их морские края можно рисовать небрежно.
 *
 * Вода — насыщенные синие/бирюзовые пиксели; тонкие реки убираются морфологическим «открытием»;
 * море — вода, связанная с краем карты (озёра внутри суши остаются сушей).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { contours } from 'd3-contour';
import sharp from 'sharp';
import simplify from 'simplify-js';
import { LAND_FILE, MAPS_DIR } from '../../src/shared/paths.ts';
import { LandSchema } from '../../src/shared/schemas.ts';
import { loadMap, probeSource } from './map-config.ts';

export interface LandOptions {
  /** Радиус морфологического открытия маски воды, px. */
  open?: number;
  /** Минимальная площадь острова, px². */
  minArea?: number;
  /** Допуск упрощения контура, единицы карты. */
  simplify?: number;
  /** Предел рабочей стороны, px. */
  maxSide?: number;
}

/** Похож ли пиксель на воду: синий/бирюзовый и достаточно насыщенный. */
export function isWater(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  return b > r + 20 && b >= g - 12 && sat > 0.3;
}

/** Минимум/максимум по квадрату (2r+1)² — разделимый фильтр. */
function morph(mask: Uint8Array, w: number, h: number, r: number, op: 'min' | 'max'): Uint8Array {
  const pick = op === 'min' ? Math.min : Math.max;
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = op === 'min' ? 1 : 0;
      for (let k = -r; k <= r; k++) v = pick(v, mask[y * w + Math.min(w - 1, Math.max(0, x + k))]!);
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = op === 'min' ? 1 : 0;
      for (let k = -r; k <= r; k++) v = pick(v, tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]!);
      out[y * w + x] = v;
    }
  return out;
}

/** Компоненты связности (4-соседство) значения value; возвращает метки и размеры. */
function components(mask: Uint8Array, w: number, h: number, value: number): { labels: Int32Array; sizes: number[]; touchesEdge: boolean[] } {
  const labels = new Int32Array(mask.length).fill(-1);
  const sizes: number[] = [];
  const touchesEdge: boolean[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== value || labels[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    let edge = false;
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (n >= 0 && mask[n] === value && labels[n] === -1) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
    touchesEdge.push(edge);
  }
  return { labels, sizes, touchesEdge };
}

/** Маска суши (1 — суша) по RGB-буферу. */
export function landMask(rgb: Uint8Array, w: number, h: number, options: LandOptions = {}): Uint8Array {
  const water = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) water[i] = isWater(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!) ? 1 : 0;
  const r = options.open ?? 2;
  const opened = r > 0 ? morph(morph(water, w, h, r, 'min'), w, h, r, 'max') : water;
  // Море — вода, касающаяся края карты.
  const sea = components(opened, w, h, 1);
  const land = new Uint8Array(w * h);
  for (let i = 0; i < land.length; i++) land[i] = opened[i] && sea.touchesEdge[sea.labels[i]!] ? 0 : 1;
  // Убираем мелкие островки-шум.
  const minArea = options.minArea ?? 30;
  const islands = components(land, w, h, 1);
  for (let i = 0; i < land.length; i++) if (land[i] && islands.sizes[islands.labels[i]!]! < minArea) land[i] = 0;
  return land;
}

type Ring = [number, number][];

/** Контуры маски → полигоны (координаты карты), упрощённые и отсортированные по площади. */
export function maskToPolygons(mask: Uint8Array, w: number, h: number, scaleX: number, scaleY: number, tolerance: number): Ring[][] {
  // Рамка из нулей, чтобы контуры суши у края карты замыкались.
  const pw = w + 2;
  const ph = h + 2;
  const values = new Float64Array(pw * ph);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) values[(y + 1) * pw + x + 1] = mask[y * w + x]!;
  const [multi] = contours().size([pw, ph]).thresholds([0.5])(Array.from(values));
  const polygons: Ring[][] = [];
  for (const poly of multi?.coordinates ?? []) {
    const rings: Ring[] = [];
    for (const ring of poly) {
      const pts = ring.map(([x, y]) => ({
        x: Math.min(w, Math.max(0, x! - 1)) * scaleX,
        y: Math.min(h, Math.max(0, y! - 1)) * scaleY,
      }));
      const simple = simplify(pts, tolerance, true).map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] as [number, number]);
      if (simple.length < 4) continue;
      const [fx, fy] = simple[0]!;
      const [lx, ly] = simple[simple.length - 1]!;
      if (fx !== lx || fy !== ly) simple.push([fx, fy]);
      rings.push(simple);
    }
    if (rings.length && rings[0]!.length >= 4) polygons.push(rings);
  }
  const area = (ring: Ring) => Math.abs(ring.reduce((s, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return s + x * ny - nx * y; }, 0) / 2);
  return polygons.filter((p) => area(p[0]!) > tolerance * tolerance * 4).sort((a, b) => area(b[0]!) - area(a[0]!));
}

export async function extractLand(root: string, mapId: string, options: LandOptions & { debug?: boolean } = {}): Promise<{ polygons: number; vertices: number; file: string; debug?: string }> {
  const map = await loadMap(root, mapId);
  const source = await probeSource(root, map);
  if (!source) throw new Error(`у карты ${mapId} нет арта (source)`);
  if (source.vector) throw new Error('маска суши строится только для растрового арта, не для SVG');
  const [W, H] = map.config.size ?? [source.width, source.height];
  const maxSide = options.maxSide ?? 2048;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.round(W * k);
  const h = Math.round(H * k);
  const rgb = new Uint8Array(await sharp(source.file).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer());
  const mask = landMask(rgb, w, h, options);
  const polygons = maskToPolygons(mask, w, h, W / w, H / h, options.simplify ?? 0.8);

  const fc = {
    type: 'FeatureCollection' as const,
    features: polygons.map((coordinates) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates } })),
  };
  LandSchema.parse(fc);
  const body = fc.features
    .map((f) => `    { "type": "Feature", "properties": {}, "geometry": { "type": "Polygon", "coordinates": [\n${f.geometry.coordinates.map((r) => `      ${JSON.stringify(r)}`).join(',\n')}\n    ] } }`)
    .join(',\n');
  const file = path.join(root, MAPS_DIR, mapId, LAND_FILE);
  await fs.writeFile(file, `{\n  "type": "FeatureCollection",\n  "features": [\n${body}\n  ]\n}\n`);

  let debug: string | undefined;
  if (options.debug) {
    const overlay = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const edge = mask[i] && (mask[i - 1] === 0 || mask[i + 1] === 0 || mask[i - w] === 0 || mask[i + w] === 0);
      overlay.set(edge ? [255, 40, 200, 255] : mask[i] ? [0, 0, 0, 0] : [0, 0, 0, 140], i * 4);
    }
    debug = path.join(root, MAPS_DIR, mapId, 'land-debug.png');
    await fs.mkdir(path.dirname(debug), { recursive: true });
    await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
      .composite([{ input: overlay, raw: { width: w, height: h, channels: 4 } }])
      .png()
      .toFile(debug);
  }
  return { polygons: polygons.length, vertices: polygons.flat(2).length, file, debug };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('maps', 'extract-land.ts'))) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const a = args.find((x) => x.startsWith(`--${name}=`));
    return a ? Number(a.split('=')[1]) : undefined;
  };
  const mapId = args.find((a) => !a.startsWith('--'));
  if (!mapId) {
    console.error('Укажите карту: npm run maps:land -- <mapId> [--debug]');
    process.exitCode = 1;
  } else {
    try {
      const r = await extractLand(process.cwd(), mapId, { debug: args.includes('--debug'), open: flag('open'), minArea: flag('min-area'), simplify: flag('simplify') });
      console.log(`Суша: ${r.polygons} массивов, ${r.vertices} вершин → ${path.relative(process.cwd(), r.file)}`);
      if (r.debug) console.log(`Проверка: ${path.relative(process.cwd(), r.debug)}`);
    } catch (e) {
      console.error(`Ошибка: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }
}
