/**
 * Реестр типов сущностей мира — единственный источник правды для схемы фронтматтера,
 * легенды, иконок на карте, папок для новых файлов и уровней детализации.
 * Новый тип = новая запись здесь (+ при желании глиф в src/app/map/icons.ts).
 *
 * Модуль изоморфный: используется и в Node (сборка контента), и в браузере.
 */

/** Какая геометрия обычно у объектов этого типа (подсказка для редактора, не жёсткое правило). */
export type GeometryHint = 'area' | 'point' | 'line' | 'none';

/** Уровень детализации: 0 — виден всегда, 1 — при среднем приближении, 2 — при сильном. */
export type DetailLevel = 0 | 1 | 2;

export interface KindDef {
  /** Название в единственном числе. */
  label: string;
  /** Название во множественном числе (группы в каталоге и легенде). */
  plural: string;
  geometry: GeometryHint;
  /** Подпапка world/lore/, куда редактор кладёт новые файлы этого типа. */
  folder: string;
  detail: DetailLevel;
  /** Порядок сортировки в каталоге и легенде. */
  order: number;
}

export const KINDS = {
  state: { label: 'Государство', plural: 'Государства', geometry: 'area', folder: 'states', detail: 0, order: 10 },
  region: { label: 'Регион', plural: 'Регионы', geometry: 'area', folder: 'regions', detail: 0, order: 20 },
  district: { label: 'Район', plural: 'Районы', geometry: 'area', folder: 'districts', detail: 1, order: 30 },
  water: { label: 'Водоём', plural: 'Водоёмы', geometry: 'point', folder: 'regions', detail: 0, order: 35 },
  capital: { label: 'Столица', plural: 'Столицы', geometry: 'point', folder: 'settlements', detail: 0, order: 40 },
  city: { label: 'Город', plural: 'Города', geometry: 'point', folder: 'settlements', detail: 0, order: 50 },
  town: { label: 'Городок', plural: 'Городки', geometry: 'point', folder: 'settlements', detail: 1, order: 60 },
  village: { label: 'Деревня', plural: 'Деревни', geometry: 'point', folder: 'settlements', detail: 2, order: 70 },
  fortress: { label: 'Крепость', plural: 'Крепости', geometry: 'point', folder: 'places', detail: 1, order: 80 },
  temple: { label: 'Храм', plural: 'Храмы', geometry: 'point', folder: 'places', detail: 1, order: 90 },
  ruin: { label: 'Руины', plural: 'Руины', geometry: 'point', folder: 'places', detail: 1, order: 100 },
  dungeon: { label: 'Подземелье', plural: 'Подземелья', geometry: 'point', folder: 'places', detail: 1, order: 110 },
  landmark: { label: 'Достопримечательность', plural: 'Достопримечательности', geometry: 'point', folder: 'landmarks', detail: 0, order: 120 },
  poi: { label: 'Место', plural: 'Места', geometry: 'point', folder: 'places', detail: 1, order: 130 },
  route: { label: 'Путь', plural: 'Пути', geometry: 'line', folder: 'routes', detail: 1, order: 140 },
  party: { label: 'Группа', plural: 'Группы', geometry: 'none', folder: 'parties', detail: 0, order: 195 },
  character: { label: 'Персонаж', plural: 'Персонажи', geometry: 'none', folder: 'characters', detail: 0, order: 200 },
  people: { label: 'Народ', plural: 'Народы', geometry: 'none', folder: 'peoples', detail: 0, order: 205 },
  faction: { label: 'Фракция', plural: 'Фракции', geometry: 'none', folder: 'factions', detail: 0, order: 210 },
  note: { label: 'Статья', plural: 'Статьи', geometry: 'none', folder: 'notes', detail: 0, order: 300 },
} as const satisfies Record<string, KindDef>;

export type Kind = keyof typeof KINDS;

export const KIND_IDS = Object.keys(KINDS) as [Kind, ...Kind[]];

export function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && Object.hasOwn(KINDS, value);
}

export function kindDef(kind: Kind): KindDef {
  return KINDS[kind];
}

/** Типы, которые на карте рисуются областями (заливка + граница). */
export function isAreaKind(kind: Kind): boolean {
  return KINDS[kind].geometry === 'area';
}
