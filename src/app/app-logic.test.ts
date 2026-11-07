import { describe, expect, it } from 'vitest';
import type { Entity, WorldData } from '../shared/types';
import { ancestors, mapChain, preferredMap, searchEntities } from './model';
import { buildHash, parseHash } from './route';

function entity(id: string, patch: Partial<Entity> = {}): Entity {
  return {
    id,
    name: id,
    kind: 'note',
    summary: '',
    html: '',
    parent: null,
    map: null,
    color: null,
    icon: null,
    image: null,
    avatar: null,
    location: null,
    residents: [],
    aliases: [],
    tags: [],
    facts: [],
    visibility: 'public',
    children: [],
    backlinks: [],
    locations: [],
    source: null,
    ...patch,
  };
}

function world(entities: Entity[], maps: Array<{ id: string; parent: string | null }> = []): WorldData {
  return {
    mode: 'public',
    title: 'Тест',
    subtitle: '',
    defaultMap: maps[0]?.id ?? 'world',
    entities: Object.fromEntries(entities.map((e) => [e.id, e])),
    maps: Object.fromEntries(
      maps.map((m) => [
        m.id,
        { id: m.id, title: m.id, width: 100, height: 100, zoomBase: 0, background: '#000', base: null, entity: null, parent: m.parent, visibility: 'public' as const, features: [], pins: [], insets: [], source: null },
      ]),
    ),
    issues: [],
  };
}

describe('route', () => {
  it('разбирает и собирает адреса', () => {
    expect(parseHash('#/m/world/e/zlatograd')).toEqual({ mapId: 'world', entityId: 'zlatograd' });
    expect(parseHash('#/e/zlatograd')).toEqual({ mapId: null, entityId: 'zlatograd' });
    expect(parseHash('')).toEqual({ mapId: null, entityId: null });
    expect(parseHash('#/m/')).toEqual({ mapId: null, entityId: null });
    expect(buildHash({ mapId: 'world', entityId: 'zlatograd' })).toBe('#/m/world/e/zlatograd');
    expect(buildHash({ mapId: 'world', entityId: null })).toBe('#/m/world');
    expect(buildHash({ mapId: null, entityId: 'x' })).toBe('#/e/x');
  });

  it('переживает кривое кодирование', () => {
    expect(parseHash('#/e/%E0%A4%A')).toEqual({ mapId: null, entityId: '%E0%A4%A' });
  });
});

describe('model', () => {
  const w = world(
    [
      entity('kingdom', { kind: 'state', name: 'Лесное королевство' }),
      entity('city', { kind: 'capital', name: 'Златоград', parent: 'kingdom', aliases: ['Злато'] }),
      entity('tavern', { kind: 'poi', name: 'Пьяный ёж', parent: 'city', summary: 'Таверна у ворот' }),
      entity('loop-a', { parent: 'loop-b' }),
      entity('loop-b', { parent: 'loop-a' }),
    ],
    [
      { id: 'world', parent: null },
      { id: 'city-map', parent: 'world' },
      { id: 'cycle', parent: 'cycle' },
    ],
  );

  it('строит цепочку предков и не зацикливается', () => {
    expect(ancestors(w, 'tavern').map((e) => e.id)).toEqual(['kingdom', 'city']);
    expect(ancestors(w, 'kingdom')).toEqual([]);
    expect(ancestors(w, 'loop-a').map((e) => e.id)).toEqual(['loop-b']);
  });

  it('строит цепочку карт', () => {
    expect(mapChain(w, 'city-map').map((m) => m.id)).toEqual(['world', 'city-map']);
    expect(mapChain(w, 'cycle').map((m) => m.id)).toEqual(['cycle']);
  });

  it('ищет по имени, алиасам и описанию с учётом ё', () => {
    expect(searchEntities(w, 'злато')[0]?.id).toBe('city');
    expect(searchEntities(w, 'еж')[0]?.id).toBe('tavern');
    expect(searchEntities(w, 'ворот')[0]?.id).toBe('tavern');
    expect(searchEntities(w, 'королевство')[0]?.id).toBe('kingdom');
    expect(searchEntities(w, 'нет такого')).toEqual([]);
    // Пустой запрос — каталог по типам: государство раньше столицы.
    const catalog = searchEntities(w, '  ').map((e) => e.id);
    expect(catalog.indexOf('kingdom')).toBeLessThan(catalog.indexOf('city'));
  });

  it('выбирает карту для сущности', () => {
    const e = entity('x', { locations: [{ map: 'a', feature: 'f1' }, { map: 'b', feature: 'f2' }] });
    expect(preferredMap(e, 'b')).toBe('b');
    expect(preferredMap(e, 'c')).toBe('a');
    expect(preferredMap(entity('y'), 'a')).toBeNull();
  });
});
