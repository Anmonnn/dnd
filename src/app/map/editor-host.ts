/**
 * Контракт между просмотрщиком карты (MapController) и dev-редактором (src/app/editor).
 *
 * Редактор монтируется как <Editor key={mapId} host={host} /> — на каждую карту свой экземпляр:
 * при переходе на другую карту Leaflet-карта пересоздаётся (у каждой карты своя CRS).
 */
import type { Map as LeafletMap } from 'leaflet';

export interface EditorHost {
  /**
   * Leaflet-карта. CRS: LatLng(lat = y, lng = x) в единицах карты, y растёт вниз,
   * поэтому layer.toGeoJSON() сразу даёт координаты [x, y] в формате features.geojson.
   */
  readonly map: LeafletMap;
  readonly mapId: string;
  /** Скрыть/показать просмотровые слои объектов (пока идёт редактирование, их заменяют редактируемые). */
  setViewLayersVisible(visible: boolean): void;
}
