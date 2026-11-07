/**
 * Чистая логика объектов редактора: сборка features.geojson, id новых объектов,
 * итоговые имя/тип/цвет для отрисовки, подсказка родителя по положению на карте.
 */
import { isKind, KINDS, type GeometryHint, type Kind } from '../../shared/kinds';
import type { AuthoredFeatureCollection } from '../../shared/schemas';
import { uniqueSlug } from '../../shared/slug';
import type { AuthoredFeatureProps, Vec2 } from '../../shared/types';
import { geometryArea, normalizeGeometry, pointInGeometry, type EditableGeometry, type ShapeKind } from './geometry';
import { isHexColor, KIND_COLORS } from './palette';

/** Объект в редакторе: id, авторские свойства и текущая (ещё не округлённая) геометрия. */
export interface EditorFeature {
  id: string;
  props: AuthoredFeatureProps;
  geometry: EditableGeometry;
}

/** Свойства без null/undefined — в файл пишется только то, что задано. */
export function cleanProps(props: AuthoredFeatureProps): AuthoredFeatureProps {
  const out: AuthoredFeatureProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

export interface BuildResult {
  collection: AuthoredFeatureCollection;
  /** id объектов, от геометрии которых ничего не осталось: в файл они не попадут. */
  dropped: string[];
}

/** Содержимое features.geojson: порядок объектов сохраняется, координаты округлены до 2 знаков. */
export function buildFeatureCollection(features: readonly EditorFeature[]): BuildResult {
  const used = new Set<string>();
  const dropped: string[] = [];
  const out: AuthoredFeatureCollection['features'] = [];
  for (const feature of features) {
    const geometry = normalizeGeometry(feature.geometry);
    if (!geometry) {
      dropped.push(feature.id);
      continue;
    }
    // id обязаны быть уникальны; повтор (не должен случаться) получает суффикс
    const id = feature.id && !used.has(feature.id) ? feature.id : uniqueSlug(feature.id || 'f', (c) => used.has(c));
    used.add(id);
    out.push({ type: 'Feature', id, properties: cleanProps(feature.props), geometry });
  }
  return { collection: { type: 'FeatureCollection', features: out }, dropped };
}

/** id нового объекта: «f-<id статьи>» или «f-<slug названия>», при коллизии — с суффиксом. */
export function makeFeatureId(entityId: string | null, name: string, taken: (id: string) => boolean): string {
  return uniqueSlug(`f-${entityId ?? name}`, taken);
}

/** Отпечаток объектов карты: совпал — файл на диске не менялся. */
export function featuresSignature(features: ReadonlyArray<{ id: string; props: unknown; geometry: unknown }>): string {
  return JSON.stringify(features.map((f) => [f.id, f.props, f.geometry]));
}

// ─── Итоговый вид объекта ────────────────────────────────────────────────────

/** То, что редактору нужно знать о статье для отрисовки. */
export interface EntityRef {
  name: string;
  kind: Kind;
  color: string | null;
}

export type EntityResolver = (id: string) => EntityRef | null;

export interface FeatureView {
  name: string;
  kind: Kind;
  color: string;
  entity: EntityRef | null;
  /** props.entity указывает на статью, которой нет. */
  broken: boolean;
}

/** Тип объекта без статьи и без своего kind — только для отрисовки в редакторе. */
export const DISPLAY_KIND: Record<ShapeKind, Kind> = { point: 'poi', area: 'region', line: 'route' };

/** Свойство объекта ?? свойство статьи ?? значение по умолчанию — как у компилятора мира. */
export function resolveView(props: AuthoredFeatureProps, shape: ShapeKind, resolve: EntityResolver): FeatureView {
  const entityId = typeof props.entity === 'string' && props.entity ? props.entity : null;
  const entity = entityId ? resolve(entityId) : null;
  const kind = isKind(props.kind) ? props.kind : (entity?.kind ?? DISPLAY_KIND[shape]);
  const ownName = typeof props.name === 'string' ? props.name.trim() : '';
  const entityColor = entity?.color;
  const color = isHexColor(props.color) ? props.color : isHexColor(entityColor) ? entityColor : KIND_COLORS[kind];
  return { name: ownName || entity?.name || '', kind, color, entity, broken: entityId !== null && entity === null };
}

// ─── Типы по умолчанию и группы типов ────────────────────────────────────────

/** Тип новой статьи по умолчанию — по нарисованной геометрии. */
export const NEW_ENTITY_KIND: Record<ShapeKind, Kind> = { point: 'village', area: 'state', line: 'route' };
/** Тип подписи без статьи по умолчанию (например, название моря). */
export const LABEL_KIND: Record<ShapeKind, Kind> = { point: 'water', area: 'region', line: 'route' };
export const SHAPE_HINT: Record<ShapeKind, GeometryHint> = { point: 'point', area: 'area', line: 'line' };
export const SHAPE_LABEL: Record<ShapeKind, string> = { point: 'Точка', area: 'Область', line: 'Линия' };

/** Кто может быть родителем новой статьи: государства, регионы, районы, поселения. */
export const PARENT_KINDS: readonly Kind[] = ['state', 'region', 'district', 'capital', 'city', 'town', 'village'];

export interface KindGroup {
  label: string;
  kinds: Kind[];
}

const GROUP_LABELS: Record<GeometryHint, string> = { area: 'Области', point: 'Точки', line: 'Линии', none: 'Без геометрии' };

/** Типы для <select>: по группам геометрии, внутри — в порядке реестра. */
export function kindGroups(): KindGroup[] {
  const kinds = (Object.keys(KINDS) as Kind[]).sort((a, b) => KINDS[a].order - KINDS[b].order);
  return (['area', 'point', 'line', 'none'] as const)
    .map((hint) => ({ label: GROUP_LABELS[hint], kinds: kinds.filter((k) => KINDS[k].geometry === hint) }))
    .filter((g) => g.kinds.length > 0);
}

// ─── Подсказка родителя ──────────────────────────────────────────────────────

export interface AreaCandidate {
  entityId: string;
  kind: Kind;
  geometry: EditableGeometry;
}

/** Типы областей, которые «содержат» другие объекты. */
export const CONTAINER_KINDS: readonly Kind[] = ['state', 'region', 'district'];

/** Самая маленькая область-государство/регион/район, в которую попадает точка. */
export function suggestParent(point: Vec2, areas: readonly AreaCandidate[]): string | null {
  let best: { id: string; area: number } | null = null;
  for (const candidate of areas) {
    if (!CONTAINER_KINDS.includes(candidate.kind) || !pointInGeometry(point, candidate.geometry)) continue;
    const area = geometryArea(candidate.geometry);
    if (!best || area < best.area) best = { id: candidate.entityId, area };
  }
  return best?.id ?? null;
}
