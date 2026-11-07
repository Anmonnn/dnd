import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeatureCollectionSchema } from '../../src/shared/schemas.ts';
import { compileWorld } from './compile.ts';
import { formatFeatureCollection } from './format.ts';
import { preprocess } from './markdown.ts';

let root = '';

async function put(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'dnd-world-'));
  await put('world/world.json', JSON.stringify({ title: 'Тест', defaultMap: 'world' }));
  await put('world/maps/world/map.json', JSON.stringify({ title: 'Мир', size: [100, 100] }));
  // Суша — квадрат 0..50 по x; государство заходит в «море» до 80.
  await put(
    'world/maps/world/land.geojson',
    JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [50, 0], [50, 100], [0, 100], [0, 0]]] } }] }),
  );
  await put(
    'world/maps/world/features.geojson',
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'f-kingdom', properties: { entity: 'kingdom' }, geometry: { type: 'Polygon', coordinates: [[[10, 10], [80, 10], [80, 90], [10, 90], [10, 10]]] } },
        { type: 'Feature', id: 'f-lair', properties: { entity: 'lair' }, geometry: { type: 'Point', coordinates: [20, 20] } },
        { type: 'Feature', id: 'f-city', properties: { entity: 'Златоград' }, geometry: { type: 'Point', coordinates: [30.123, 40.456] } },
        { type: 'Feature', id: 'f-city', properties: { name: 'Дубль' }, geometry: { type: 'Point', coordinates: [1, 1] } },
      ],
    }),
  );
  await put('world/lore/states/kingdom.md', '---\nname: Королевство\nkind: state\n---\nСтолица — [[zlatograd]], враги — [[Логово культа|культисты]].\n\n> [!dm] Тайна\n> Король — оборотень. См. [[lair]].\n');
  await put('world/lore/Златоград.md', '---\nkind: capital\nparent: "[[Королевство]]"\naliases: [Злато]\nfacts:\n  Население: 12000\n  Правитель: "[[kingdom]]"\n  Пусто:\n---\nГород у реки. %% заметка автора %%\n\n`[[не ссылка]]` и [[нет-такой]].\n');
  await put('world/lore/lair.md', '---\nname: Логово культа\nkind: dungeon\nvisibility: dm\n---\nСекретное логово.\n');
  await put('world/lore/_templates/tpl.md', '---\nkind: unknown\n---\n');
  await put('world/lore/a.md', '---\nkind: note\nparent: b\n---\n');
  await put('world/lore/b.md', '---\nkind: note\nparent: a\n---\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('compileWorld', () => {
  it('режим мастера: ссылки, родители, факты, секреты', async () => {
    const w = await compileWorld({ root, mode: 'dm', dev: true });
    const city = w.entities.zlatograd!;
    expect(city.name).toBe('Златоград');
    expect(city.parent).toBe('kingdom');
    expect(w.entities.kingdom!.children).toEqual(['zlatograd']);
    expect(city.facts.map((f) => f.label)).toEqual(['Население', 'Правитель']);
    expect(city.facts[1]!.html).toContain('data-entity="kingdom"');
    expect(city.html).not.toContain('заметка автора');
    expect(city.html).toContain('<code>[[не ссылка]]</code>');
    expect(city.html).toContain('wikilink-missing');
    expect(city.summary).toBe('Город у реки.');
    expect(w.entities.kingdom!.html).toContain('callout-dm');
    expect(w.entities.kingdom!.backlinks).toContain('zlatograd');
    expect(city.source).toBe('world/lore/Златоград.md');
    expect(w.issues.some((i) => i.message.includes('Цикл'))).toBe(true);
    expect(w.entities.a!.parent === null || w.entities.b!.parent === null).toBe(true);
  });

  it('режим игроков: секреты не попадают в данные вообще', async () => {
    const w = await compileWorld({ root, mode: 'public', dev: false });
    const json = JSON.stringify(w);
    expect(w.entities.lair).toBeUndefined();
    for (const secret of ['lair', 'Логово культа', 'оборотень', 'Секретное логово', 'Тайна']) expect(json).not.toContain(secret);
    expect(w.entities.kingdom!.html).toContain('wikilink-plain');
    expect(w.maps.world!.features.map((f) => f.id)).not.toContain('f-lair');
    expect(w.entities.zlatograd!.source).toBeNull();
  });

  it('объекты: обрезка по суше, точка подписи, дубли id, поиск по имени', async () => {
    const w = await compileWorld({ root, mode: 'dm', dev: false });
    const map = w.maps.world!;
    const kingdom = map.features.find((f) => f.id === 'f-kingdom')!;
    const xs = (kingdom.display as { coordinates: number[][][] }).coordinates[0]!.map((p) => p[0]!);
    expect(Math.max(...xs)).toBe(50);
    expect(kingdom.labelAt![0]).toBeLessThanOrEqual(50);
    expect(kingdom.color).toMatch(/^#/);
    const city = map.features.find((f) => f.id === 'f-city')!;
    expect(city.entity).toBe('zlatograd');
    expect(city.geometry).toEqual({ type: 'Point', coordinates: [30.12, 40.46] });
    expect(map.features.some((f) => f.id === 'f-city-2')).toBe(true);
    expect(w.issues.some((i) => i.level === 'warning' && i.message.includes('по id'))).toBe(true);
    expect(map.base).toBeNull();
  });

  it('детерминированность', async () => {
    const a = await compileWorld({ root, mode: 'dm', dev: false });
    const b = await compileWorld({ root, mode: 'dm', dev: false });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('markdown и формат', () => {
  it('callout и комментарии вне кода', () => {
    expect(preprocess('```\n%% x %%\n> [!dm]\n```', 'public')).toContain('%% x %%');
    expect(preprocess('> [!dm]\n> секрет\nдальше', 'public')).toBe('дальше');
    expect(preprocess('> [!tip] Совет дня\n> текст', 'dm')).toContain('callout-tip');
  });

  it('formatFeatureCollection даёт валидный стабильный JSON', () => {
    const fc = FeatureCollectionSchema.parse({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'a', properties: { zz: 1, entity: 'x', name: null }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1.005, 0], [1, 1], [0, 0]]] } }],
    });
    const text = formatFeatureCollection(fc);
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed.features[0].properties)).toEqual(['entity', 'zz']);
    expect(formatFeatureCollection(FeatureCollectionSchema.parse(parsed))).toBe(text);
  });
});
