/** Группировка типов сущностей по переключаемым слоям карты. */
import { KINDS, type Kind } from '../shared/kinds';
import type { LayerKey } from './store';

const SETTLEMENTS = new Set<Kind>(['capital', 'city', 'town', 'village']);

export function layerOf(kind: Kind): LayerKey {
  const geometry = KINDS[kind].geometry;
  if (geometry === 'area') return 'areas';
  if (geometry === 'line') return 'routes';
  if (kind === 'water') return 'labels';
  if (SETTLEMENTS.has(kind)) return 'settlements';
  return 'places';
}

export const LAYER_LABELS: Record<LayerKey, string> = {
  areas: 'Границы и области',
  settlements: 'Поселения',
  places: 'Места и достопримечательности',
  characters: 'Персонажи',
  routes: 'Дороги и пути',
  labels: 'Подписи',
};

export const LAYER_ORDER: LayerKey[] = ['areas', 'settlements', 'places', 'characters', 'routes', 'labels'];
