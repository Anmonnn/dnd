/**
 * Система координат Leaflet для «нереальных» карт: LatLng(lat = y, lng = x) в единицах карты,
 * y растёт вниз. Масштаб подобран так, что уровень зума z совпадает с уровнем пирамиды тайлов z
 * (см. src/shared/zoom.ts), поэтому TileLayer работает без zoomOffset.
 */
import L from 'leaflet';
import type { Geometry, Position } from 'geojson';
import type { MapDef, Vec2 } from '../../shared/types';

export function createCrs(zoomBase: number): L.CRS {
  const k = 2 ** -zoomBase;
  return L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(k, 0, k, 0) }) as L.CRS;
}

export function toLatLng(position: Position | Vec2): L.LatLng {
  return L.latLng(position[1]!, position[0]!);
}

export function mapBounds(def: Pick<MapDef, 'width' | 'height'>): L.LatLngBounds {
  return L.latLngBounds([0, 0], [def.height, def.width]);
}

/** Кольца полигона/мультиполигона → массивы LatLng для L.polygon. */
export function polygonLatLngs(geometry: Geometry): L.LatLng[][] | L.LatLng[][][] | null {
  if (geometry.type === 'Polygon') return geometry.coordinates.map((ring) => ring.map(toLatLng));
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => poly.map((ring) => ring.map(toLatLng)));
  return null;
}

export function lineLatLngs(geometry: Geometry): L.LatLng[] | L.LatLng[][] | null {
  if (geometry.type === 'LineString') return geometry.coordinates.map(toLatLng);
  if (geometry.type === 'MultiLineString') return geometry.coordinates.map((line) => line.map(toLatLng));
  return null;
}

/** Описывающий прямоугольник любой геометрии. */
export function geometryBounds(geometry: Geometry): L.LatLngBounds | null {
  const bounds = L.latLngBounds([]);
  const visit = (coords: unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === 'number') bounds.extend(toLatLng(coords as Position));
    else if (Array.isArray(coords)) coords.forEach(visit);
  };
  if (geometry.type === 'GeometryCollection') geometry.geometries.forEach((g) => visit('coordinates' in g ? g.coordinates : []));
  else visit(geometry.coordinates);
  return bounds.isValid() ? bounds : null;
}

declare module 'leaflet' {
  // Опция Leaflet-Geoman: просмотровые слои не должны попадать в редактор.
  interface MapOptions {
    pmIgnore?: boolean;
  }
  interface LayerOptions {
    pmIgnore?: boolean;
  }
}
