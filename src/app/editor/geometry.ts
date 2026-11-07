/**
 * Чистая геометрия редактора (без Leaflet и DOM): нормализация перед сохранением,
 * перевод GeoJSON-координат [x, y] в Leaflet-порядок [lat = y, lng = x], площади
 * и попадание точки в многоугольник (подсказка родителя для новой статьи).
 */
import type { LineString, MultiLineString, MultiPolygon, Point, Polygon, Position } from 'geojson';
import type { Vec2 } from '../../shared/types';

/** Геометрии, которые понимает features.geojson (см. GeometrySchema). */
export type EditableGeometry = Point | LineString | MultiLineString | Polygon | MultiPolygon;

/** Как объект рисуется в редакторе: маркер, область или линия. */
export type ShapeKind = 'point' | 'area' | 'line';

/** Точность координат в features.geojson. */
export const COORD_DIGITS = 2;

const EDITABLE_TYPES = new Set(['Point', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']);

export function isEditableGeometry(geometry: { type: string } | null | undefined): geometry is EditableGeometry {
  return !!geometry && EDITABLE_TYPES.has(geometry.type);
}

export function shapeOf(geometry: EditableGeometry): ShapeKind {
  switch (geometry.type) {
    case 'Point':
      return 'point';
    case 'LineString':
    case 'MultiLineString':
      return 'line';
    case 'Polygon':
    case 'MultiPolygon':
      return 'area';
  }
}

export function roundCoord(value: number, digits = COORD_DIGITS): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  // -0 → 0, чтобы в файле не появлялось «-0»
  return rounded === 0 ? 0 : rounded;
}

function validPosition(p: Position | undefined): p is Position {
  return !!p && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/** [x, y(, z)] → [x, y] с округлением. */
export function roundPosition(p: Position, digits = COORD_DIGITS): Position {
  return [roundCoord(p[0], digits), roundCoord(p[1], digits)];
}

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Округление + удаление подряд идущих дублей (после округления соседние вершины могут совпасть). */
function cleanPath(path: readonly Position[], digits: number): Position[] | null {
  const out: Position[] = [];
  for (const p of path) {
    if (!validPosition(p)) return null;
    const r = roundPosition(p, digits);
    const last = out.at(-1);
    if (!last || !samePosition(last, r)) out.push(r);
  }
  return out;
}

function normalizeLine(line: readonly Position[], digits: number): Position[] | null {
  const out = cleanPath(line, digits);
  return out && out.length >= 2 ? out : null;
}

/** Кольцо: замкнутое, минимум 3 различные вершины (4 позиции с замыкающей). */
function normalizeRing(ring: readonly Position[], digits: number): Position[] | null {
  const out = cleanPath(ring, digits);
  if (!out) return null;
  while (out.length > 1 && samePosition(out[0], out[out.length - 1])) out.pop();
  if (out.length < 3) return null;
  out.push([out[0][0], out[0][1]]);
  return out;
}

/** Внешнее кольцо обязательно, вырожденные дыры выбрасываются. */
function normalizePolygon(rings: readonly (readonly Position[])[], digits: number): Position[][] | null {
  if (rings.length === 0) return null;
  const shell = normalizeRing(rings[0], digits);
  if (!shell) return null;
  const out = [shell];
  for (const hole of rings.slice(1)) {
    const ring = normalizeRing(hole, digits);
    if (ring) out.push(ring);
  }
  return out;
}

/**
 * Геометрия в том виде, в каком она пишется в features.geojson: координаты округлены до 2 знаков,
 * кольца замкнуты, вырожденные части выброшены. Multi* из одной части становится простым типом.
 * null — от геометрии ничего не осталось (например, линия из одной точки).
 */
export function normalizeGeometry(geometry: EditableGeometry, digits = COORD_DIGITS): EditableGeometry | null {
  switch (geometry.type) {
    case 'Point':
      return validPosition(geometry.coordinates) ? { type: 'Point', coordinates: roundPosition(geometry.coordinates, digits) } : null;
    case 'LineString': {
      const line = normalizeLine(geometry.coordinates, digits);
      return line ? { type: 'LineString', coordinates: line } : null;
    }
    case 'MultiLineString': {
      const lines = geometry.coordinates.map((l) => normalizeLine(l, digits)).filter((l) => l !== null);
      if (lines.length === 0) return null;
      return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
    }
    case 'Polygon': {
      const poly = normalizePolygon(geometry.coordinates, digits);
      return poly ? { type: 'Polygon', coordinates: poly } : null;
    }
    case 'MultiPolygon': {
      const polys = geometry.coordinates.map((p) => normalizePolygon(p, digits)).filter((p) => p !== null);
      if (polys.length === 0) return null;
      return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
    }
  }
}

// ─── Leaflet-порядок координат ───────────────────────────────────────────────

/** [lat, lng] = [y, x]. */
export type LatLngPair = [number, number];

export type LeafletShape =
  | { shape: 'point'; latlng: LatLngPair }
  | { shape: 'line'; latlngs: LatLngPair[] | LatLngPair[][] }
  | { shape: 'area'; latlngs: LatLngPair[][] | LatLngPair[][][] };

function toPair(p: Position): LatLngPair {
  return [p[1], p[0]];
}

/** Кольцо для L.polygon: без замыкающей точки (Leaflet замыкает сам). */
function ringToPairs(ring: readonly Position[]): LatLngPair[] {
  const pairs = ring.map(toPair);
  if (pairs.length > 1 && samePosition(pairs[0], pairs[pairs.length - 1])) pairs.pop();
  return pairs;
}

/** GeoJSON-геометрия → координаты для L.marker / L.polyline / L.polygon. */
export function toLeafletShape(geometry: EditableGeometry): LeafletShape {
  switch (geometry.type) {
    case 'Point':
      return { shape: 'point', latlng: toPair(geometry.coordinates) };
    case 'LineString':
      return { shape: 'line', latlngs: geometry.coordinates.map(toPair) };
    case 'MultiLineString':
      return { shape: 'line', latlngs: geometry.coordinates.map((line) => line.map(toPair)) };
    case 'Polygon':
      return { shape: 'area', latlngs: geometry.coordinates.map(ringToPairs) };
    case 'MultiPolygon':
      return { shape: 'area', latlngs: geometry.coordinates.map((poly) => poly.map(ringToPairs)) };
  }
}

// ─── Площади и попадание точки ───────────────────────────────────────────────

/** Площадь кольца по формуле шнурования (без знака). */
export function ringArea(ring: readonly Position[]): number {
  let sum = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

function polygonArea(rings: readonly (readonly Position[])[]): number {
  if (rings.length === 0) return 0;
  const holes = rings.slice(1).reduce((s, h) => s + ringArea(h), 0);
  return Math.max(0, ringArea(rings[0]) - holes);
}

/** Площадь области в квадратных единицах карты; у точек и линий — 0. */
export function geometryArea(geometry: EditableGeometry): number {
  if (geometry.type === 'Polygon') return polygonArea(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.reduce((s, p) => s + polygonArea(p), 0);
  return 0;
}

/** Луч вправо из точки: нечётное число пересечений — точка внутри. */
export function pointInRing(point: Vec2, ring: readonly Position[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Vec2, rings: readonly (readonly Position[])[]): boolean {
  if (rings.length === 0 || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

export function pointInGeometry(point: Vec2, geometry: EditableGeometry): boolean {
  if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((p) => pointInPolygon(point, p));
  return false;
}

function average(points: readonly Position[]): Vec2 | null {
  const valid = points.filter(validPosition);
  if (valid.length === 0) return null;
  const sx = valid.reduce((s, p) => s + p[0], 0);
  const sy = valid.reduce((s, p) => s + p[1], 0);
  return [sx / valid.length, sy / valid.length];
}

/**
 * Точка, по которой ищется «где находится» объект: сама точка, средняя вершина линии,
 * среднее вершин внешнего кольца области (для выпуклых областей — внутри).
 */
export function representativePoint(geometry: EditableGeometry): Vec2 | null {
  switch (geometry.type) {
    case 'Point':
      return validPosition(geometry.coordinates) ? [geometry.coordinates[0], geometry.coordinates[1]] : null;
    case 'LineString':
    case 'MultiLineString': {
      const line: readonly Position[] = (geometry.type === 'LineString' ? geometry.coordinates : geometry.coordinates[0]) ?? [];
      const mid = line[Math.floor(line.length / 2)];
      return validPosition(mid) ? [mid[0], mid[1]] : null;
    }
    case 'Polygon':
    case 'MultiPolygon': {
      const ring: readonly Position[] = (geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0]) ?? [];
      const closed = ring.length > 1 && samePosition(ring[0], ring[ring.length - 1]);
      return average(closed ? ring.slice(0, -1) : ring);
    }
  }
}
