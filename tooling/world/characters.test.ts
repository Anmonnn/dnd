import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GENERATED_MEDIA_DIR } from '../../src/shared/paths.ts';
import { compileWorld } from './compile.ts';
import { setFrontmatterField } from './frontmatter-edit.ts';
import { generateMedia, MediaLibrary, mediaFileNames, pruneMedia } from './media.ts';

let root = '';

async function put(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}

async function png(file: string, background: string, width = 300, height = 400): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background } }).png().toFile(path.join(root, file));
}

beforeAll(async () => {
  sharp.cache(false);
  root = await mkdtemp(path.join(os.tmpdir(), 'dnd-chars-'));
  await put('world/world.json', JSON.stringify({ title: 'Тест', defaultMap: 'world' }));
  await put('world/maps/world/map.json', JSON.stringify({ title: 'Мир', size: [200, 200] }));
  await put(
    'world/maps/world/features.geojson',
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'f-kingdom', properties: { entity: 'kingdom', labelAt: [60, 60] }, geometry: { type: 'Polygon', coordinates: [[[10, 10], [110, 10], [110, 110], [10, 110], [10, 10]]] } },
        { type: 'Feature', id: 'f-city', properties: { entity: 'city' }, geometry: { type: 'Point', coordinates: [40, 40] } },
        { type: 'Feature', id: 'f-secret', properties: { entity: 'secret-place' }, geometry: { type: 'Point', coordinates: [150, 150] } },
        { type: 'Feature', id: 'f-drawn', properties: { entity: 'drawn-hero' }, geometry: { type: 'Point', coordinates: [90, 90] } },
      ],
    }),
  );
  await put('world/lore/kingdom.md', '---\nname: Королевство\nkind: state\n---\n');
  await put('world/lore/city.md', '---\nname: Столица\nkind: capital\nparent: kingdom\n---\n');
  // Таверны нет на карте мира — кружок поднимется к городу.
  await put('world/lore/tavern.md', '---\nname: Таверна\nkind: poi\nparent: city\n---\n');
  await put('world/lore/secret-place.md', '---\nname: Тайное место\nkind: dungeon\nvisibility: dm\n---\n');

  await png('world/lore/characters/hero.png', '#884422');
  await png('world/media/avatars/king.png', '#224488');
  await png('world/art/portrait-unique.png', '#448822', 1600, 1200);
  await put('world/lore/characters/hero.md', '---\nname: Герой\nkind: character\nlocation: "[[Таверна]]"\navatar: hero.png\n---\nПервый абзац.\n\n![[portrait-unique.png|200]]\n\n![](../../art/portrait-unique.png)\n\n![[нет-такой.png]]\n');
  await put('world/lore/characters/king.md', '---\nname: Король\nkind: character\nlocation: kingdom\navatar: media/avatars/king.png\n---\n![[portrait-unique.png]]\n\nПравит.\n');
  await put('world/lore/characters/spy.md', '---\nname: Шпион\nkind: character\nlocation: secret-place\navatar: "https://example.com/spy.png"\n---\n');
  await put('world/lore/characters/ghost.md', '---\nname: Призрак\nkind: character\nlocation: city\nvisibility: dm\navatar: hero.png\n---\n');
  await put('world/lore/characters/lost.md', '---\nname: Потерянный\nkind: character\nlocation: nowhere\navatar: missing.png\n---\n');
  await put('world/lore/characters/drawn-hero.md', '---\nname: Нарисованный\nkind: character\nlocation: city\n---\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('аватары и привязка к месту', () => {
  it('находит аватары и выдаёт URL копий', async () => {
    const media = new MediaLibrary(root);
    const w = await compileWorld({ root, mode: 'dm', dev: false, media });
    const hero = w.entities.hero!;
    expect(hero.avatar?.thumb).toMatch(/^generated\/media\/[0-9a-f]{16}-s\.webp$/);
    expect(hero.avatar?.full).toMatch(/^generated\/media\/[0-9a-f]{16}-m\.webp$/);
    expect(w.entities.king!.avatar?.thumb).toMatch(/-s\.webp$/);
    expect(w.entities.spy!.avatar).toEqual({ thumb: 'https://example.com/spy.png', full: 'https://example.com/spy.png' });
    expect(w.entities.lost!.avatar).toBeNull();
    expect(w.issues.some((i) => i.message.includes('missing.png'))).toBe(true);
    // Один и тот же файл (hero.png у героя и призрака) — одно задание; плюс king и картинка из текста.
    expect(media.pending()).toHaveLength(3);
  });

  it('картинки в тексте: ![[…|200]] и ![](…), отсутствующая — предупреждение', async () => {
    const w = await compileWorld({ root, mode: 'dm', dev: false });
    const html = w.entities.hero!.html;
    expect(html).toMatch(/<img class="embed" src="generated\/media\/[0-9a-f]{16}-m\.webp" alt="portrait-unique.png" width="200"/);
    expect(html).toMatch(/<img src="generated\/media\/[0-9a-f]{16}-m\.webp" alt=""/);
    expect(w.issues.some((i) => i.message.includes('нет-такой.png'))).toBe(true);
    // Абзац из одной картинки не становится кратким описанием.
    expect(w.entities.king!.summary).toBe('Правит.');
  });

  it('location, жители и кружки на карте с подъёмом к предку', async () => {
    const w = await compileWorld({ root, mode: 'dm', dev: false });
    expect(w.entities.hero!.location).toBe('tavern');
    expect(w.entities.tavern!.residents).toEqual(['hero']);
    expect(w.entities.kingdom!.residents).toEqual(['king']);
    expect(w.entities.city!.residents).toEqual(['drawn-hero', 'ghost']);
    expect(w.issues.some((i) => i.message.includes('Место «nowhere» не найдено'))).toBe(true);

    const pins = w.maps.world!.pins;
    const byEntity = Object.fromEntries(pins.map((p) => [p.entity, p]));
    // Таверны на карте нет → кружок у города, над значком.
    expect(byEntity.hero).toMatchObject({ anchor: 'city', feature: 'f-city', at: [40, 40], placement: 'above' });
    // Область → под подписью (labelAt).
    expect(byEntity.king).toMatchObject({ anchor: 'kingdom', at: [60, 60], placement: 'below' });
    expect(byEntity.spy).toMatchObject({ anchor: 'secret-place' });
    // Сущность, нарисованная на карте сама, кружка не получает.
    expect(byEntity['drawn-hero']).toBeUndefined();
    expect(w.entities.hero!.locations).toContainEqual({ map: 'world', feature: 'pin-hero' });
  });

  it('в версии для игроков секретные места и персонажи не утекают', async () => {
    const media = new MediaLibrary(root);
    const w = await compileWorld({ root, mode: 'public', dev: false, media });
    expect(w.entities.ghost).toBeUndefined();
    expect(w.entities.spy!.location).toBeNull();
    expect(w.maps.world!.pins.map((p) => p.entity).sort()).toEqual(['hero', 'king']);
    const json = JSON.stringify(w);
    for (const secret of ['secret-place', 'Тайное место', 'Призрак', 'ghost']) expect(json).not.toContain(secret);
  });
});

describe('копии картинок', () => {
  it('делает квадрат 128 и копию ≤ 800, лишнее удаляет', async () => {
    const media = new MediaLibrary(root);
    await compileWorld({ root, mode: 'dm', dev: false, media });
    const jobs = media.pending();
    const result = await generateMedia(root, jobs);
    expect(result.errors).toEqual([]);
    expect(result.generated).toBe(jobs.length * 2);
    expect((await generateMedia(root, jobs)).generated).toBe(0);

    const dir = path.join(root, GENERATED_MEDIA_DIR);
    const big = jobs.find((j) => j.source.endsWith('portrait-unique.png'))!;
    const s = await sharp(path.join(dir, `${big.hash}-s.webp`)).metadata();
    const m = await sharp(path.join(dir, `${big.hash}-m.webp`)).metadata();
    expect([s.width, s.height]).toEqual([128, 128]);
    expect([m.width, m.height]).toEqual([800, 600]);

    await writeFile(path.join(dir, '0123456789abcdef-s.webp'), 'old');
    expect(await pruneMedia(dir, mediaFileNames(jobs))).toBe(1);
    expect((await readdir(dir)).sort()).toEqual([...mediaFileNames(jobs)].sort());
  });
});

describe('setFrontmatterField', () => {
  const doc = '---\nname: "Герой"\n# комментарий автора\ntags:\n  - один\n  - два\nkind: character\n---\nТекст';

  it('добавляет, заменяет и удаляет поле, не трогая остальное', () => {
    const added = setFrontmatterField(doc, 'location', 'city');
    expect(added).toBe('---\nname: "Герой"\n# комментарий автора\ntags:\n  - один\n  - два\nkind: character\nlocation: "city"\n---\nТекст');
    expect(setFrontmatterField(added, 'location', 'kingdom')).toContain('location: "kingdom"\n---');
    expect(setFrontmatterField(added, 'location', null)).toBe(doc);
    // Многострочное значение заменяется целиком.
    expect(setFrontmatterField(doc, 'tags', 'x')).toBe('---\nname: "Герой"\n# комментарий автора\ntags: "x"\nkind: character\n---\nТекст');
  });

  it('создаёт фронтматтер, сохраняет CRLF и экранирует кавычки', () => {
    expect(setFrontmatterField('Текст', 'avatar', 'a "b".png')).toBe('---\navatar: "a \\"b\\".png"\n---\nТекст');
    expect(setFrontmatterField('---\r\nkind: note\r\n---\r\nТекст', 'location', 'x')).toBe('---\r\nkind: note\r\nlocation: "x"\r\n---\r\nТекст');
    expect(setFrontmatterField('Текст', 'avatar', null)).toBe('Текст');
    expect(() => setFrontmatterField('---\nkind: note\n', 'a', 'b')).toThrow();
  });
});
