/** Чистые помощники над WorldData: иерархии, сортировка, поиск. Без DOM и Leaflet. */
import { KINDS } from '../shared/kinds';
import type { Entity, MapDef, WorldData } from '../shared/types';

const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

export function byKindThenName(a: Entity, b: Entity): number {
  return KINDS[a.kind].order - KINDS[b.kind].order || collator.compare(a.name, b.name);
}

/** Цепочка предков сущности от корня: [государство, город] для района. Защищена от циклов. */
export function ancestors(world: WorldData, entityId: string): Entity[] {
  const chain: Entity[] = [];
  const seen = new Set<string>([entityId]);
  let current = world.entities[entityId]?.parent ?? null;
  while (current && !seen.has(current)) {
    const entity = world.entities[current];
    if (!entity) break;
    chain.unshift(entity);
    seen.add(current);
    current = entity.parent;
  }
  return chain;
}

/** Цепочка карт от корневой до текущей (по полю parent). */
export function mapChain(world: WorldData, mapId: string): MapDef[] {
  const chain: MapDef[] = [];
  const seen = new Set<string>();
  let current: string | null = mapId;
  while (current && !seen.has(current)) {
    const map: MapDef | undefined = world.maps[current];
    if (!map) break;
    chain.unshift(map);
    seen.add(current);
    current = map.parent;
  }
  return chain;
}

/** Дети, сгруппированные по типу в порядке реестра. */
export function groupByKind(entities: Entity[]): Array<{ kind: Entity['kind']; items: Entity[] }> {
  const groups = new Map<Entity['kind'], Entity[]>();
  for (const e of [...entities].sort(byKindThenName)) {
    const list = groups.get(e.kind) ?? [];
    list.push(e);
    groups.set(e.kind, list);
  }
  return [...groups].map(([kind, items]) => ({ kind, items }));
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').normalize('NFC');
}

/** Поиск по имени, алиасам, тегам и краткому описанию; результат отсортирован по релевантности. */
export function searchEntities(world: WorldData, query: string, limit = 40): Entity[] {
  const q = normalizeText(query.trim());
  const all = Object.values(world.entities);
  if (!q) return all.sort(byKindThenName);
  const scored: Array<{ e: Entity; score: number }> = [];
  for (const e of all) {
    const name = normalizeText(e.name);
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.split(/[\s\-«»"]+/).some((w) => w.startsWith(q))) score = 60;
    else if (name.includes(q)) score = 40;
    if (score < 50 && e.aliases.some((a) => normalizeText(a).includes(q))) score = Math.max(score, 50);
    if (score < 30 && e.tags.some((t) => normalizeText(t).startsWith(q))) score = 30;
    if (score < 10 && normalizeText(e.summary).includes(q)) score = 10;
    if (score > 0) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || byKindThenName(a.e, b.e));
  return scored.slice(0, limit).map((s) => s.e);
}

/** На какой карте показывать сущность: текущая, если она там есть, иначе первая из её расположений. */
export function preferredMap(entity: Entity, currentMapId: string): string | null {
  return entity.locations.find((l) => l.map === currentMapId)?.map ?? entity.locations[0]?.map ?? null;
}
