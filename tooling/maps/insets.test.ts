import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InsetMetaSchema } from '../../src/shared/schemas.ts';
import { compileWorld } from '../world/compile.ts';
import { ART_FILE_RE } from '../world/vite-plugin.ts';
import { fitInsetBounds, parseAspect, pickAspect, referenceSize, unionRect } from './inset-geometry.ts';
import { buildInsets, featherAlpha, planInset, type InsetBuildContext } from './insets.ts';

let root = '';
const mapDir = () => path.join(root, 'world/maps/world');
const insetDir = () => path.join(mapDir(), 'insets/east');
const outDir = () => path.join(root, 'public/generated/insets/world/east');

function ctx(): InsetBuildContext {
  return { root, mapId: 'world', mapDir: mapDir(), zoomBase: 1, mapMaxNativeZoom: 1, force: false, quality: 80, concurrency: 4, log: () => {}, warnings: [], errors: [] };
}

async function pixel(file: string, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
}

beforeAll(async () => {
  sharp.cache(false);
  root = await mkdtemp(path.join(os.tmpdir(), 'dnd-insets-'));
  await mkdir(insetDir(), { recursive: true });
  // Карта без арта: только пространство координат 512×512 → zoomBase 1.
  await writeFile(path.join(mapDir(), 'map.json'), JSON.stringify({ title: 'Мир', size: [512, 512] }));
  await writeFile(path.join(root, 'world/world.json'), JSON.stringify({ title: 'Тест', defaultMap: 'world' }));
  await writeFile(path.join(insetDir(), 'inset.json'), JSON.stringify({ title: 'Восток', bounds: [100, 100, 200, 100] }));
  await sharp({ create: { width: 800, height: 400, channels: 3, background: '#ff0000' } }).png().toFile(path.join(insetDir(), 'source.png'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('planInset', () => {
  it('уровни от minZoom до нативного, прямоугольник и тайлы на сетке мира', () => {
    const plan = planInset({ zoomBase: 3, bounds: [100, 50, 200, 100], sourceSize: [1600, 800], minZoom: 2 });
    expect(plan.maxNativeZoom).toBe(6);
    expect(plan.levels.map((l) => l.z)).toEqual([2, 3, 4, 5, 6]);
    expect(plan.levels[1]).toMatchObject({ z: 3, x0: 100, y0: 50, x1: 300, y1: 150, col0: 0, col1: 1, row0: 0, row1: 0 });
    expect(plan.levels[4]).toMatchObject({ z: 6, x0: 800, x1: 2400, col0: 3, col1: 9, row0: 1, row1: 4 });
  });

  it('арт хуже карты — один нативный уровень', () => {
    expect(planInset({ zoomBase: 3, bounds: [0, 0, 1000, 500], sourceSize: [500, 250], minZoom: 3 }).maxNativeZoom).toBe(3);
  });
});

describe('featherAlpha', () => {
  it('края прозрачные, середина непрозрачная', () => {
    const raster = { data: Buffer.alloc(100 * 100 * 4, 255), width: 100, height: 100 };
    featherAlpha(raster, 0.1);
    const alpha = (x: number, y: number) => raster.data[(y * 100 + x) * 4 + 3]!;
    expect(alpha(0, 0)).toBeLessThan(5);
    expect(alpha(0, 50)).toBeLessThan(5);
    expect(alpha(5, 50)).toBeGreaterThan(80);
    expect(alpha(5, 50)).toBeLessThan(200);
    expect(alpha(50, 50)).toBe(255);
  });
});

describe('buildInsets', () => {
  it('режет врезку на сетке мира, пропускает без изменений, перенарезает при сдвиге', async () => {
    expect(await buildInsets(ctx())).toBe(1);
    const meta = InsetMetaSchema.parse(JSON.parse(await readFile(path.join(outDir(), 'meta.json'), 'utf8')));
    // showFrom по умолчанию 1.25 → минимальный уровень 0; 4 px арта на единицу → нативный 1 + 2 = 3.
    expect(meta).toMatchObject({ minZoom: 0, maxNativeZoom: 3, bounds: [100, 100, 200, 100], tiles: 'generated/insets/world/east/{z}/{x}/{y}.webp' });

    // Уровень 3 (×4): врезка — пиксели [400, 1200) × [400, 800), тайлы x 1..4, y 1..3.
    const tile = (z: number, x: number, y: number) => path.join(outDir(), String(z), String(x), `${y}.webp`);
    for (let x = 1; x <= 4; x++) for (let y = 1; y <= 3; y++) expect((await stat(tile(3, x, y))).isFile()).toBe(true);
    // Центр врезки — красный и непрозрачный; слева от врезки в том же тайле — прозрачно.
    const center = await pixel(tile(3, 3, 2), 0, 88); // (768, 600) уровня
    expect(center[0]).toBeGreaterThan(200);
    expect(center[3]).toBe(255);
    expect((await pixel(tile(3, 1, 2), 10, 88))[3]).toBe(0); // (266, 600) — левее врезки

    expect(await buildInsets(ctx())).toBe(0);
    await writeFile(path.join(insetDir(), 'inset.json'), JSON.stringify({ title: 'Восток', bounds: [120, 100, 200, 100] }));
    expect(await buildInsets(ctx())).toBe(1);
  });

  it('компилятор отдаёт свежую врезку и прячет устаревшую', async () => {
    const fresh = await compileWorld({ root, mode: 'public', dev: false });
    const inset = fresh.maps.world!.insets[0]!;
    expect(inset).toMatchObject({ id: 'east', title: 'Восток', bounds: [120, 100, 200, 100], showFrom: 1.25 });
    expect(inset.tiles).toMatchObject({ minNativeZoom: 0, maxNativeZoom: 3, tileSize: 256 });

    await writeFile(path.join(insetDir(), 'inset.json'), JSON.stringify({ title: 'Восток', bounds: [140, 100, 200, 100] }));
    const stale = await compileWorld({ root, mode: 'public', dev: false });
    expect(stale.maps.world!.insets[0]!.tiles).toBeNull();
    expect(stale.issues.some((i) => i.message.includes('тайлы устарели'))).toBe(true);
  });

  it('арт убрали — тайлы врезки удаляются', async () => {
    await rm(path.join(insetDir(), 'source.png'));
    await buildInsets(ctx());
    await expect(stat(outDir())).rejects.toThrow();
  });
});

describe('рамка врезки', () => {
  it('пропорции нейросети и поля, рамка внутри карты', () => {
    expect(pickAspect(890, 620).name).toBe('3:2');
    expect(pickAspect(300, 700).name).toBe('2:3');
    expect(parseAspect('16:9')).toBeCloseTo(16 / 9);
    expect(parseAspect('auto')).toBeNull();
    const { bounds, clipped } = fitInsetBounds([290, 260, 890, 620], [1461, 1077], 1.5, 0.05);
    expect(bounds[2] / bounds[3]).toBeCloseTo(1.5, 2);
    expect(bounds[0]).toBeGreaterThanOrEqual(0);
    expect(bounds[0] + bounds[2]).toBeLessThanOrEqual(1461.05);
    expect(bounds[1] + bounds[3]).toBeLessThanOrEqual(1077.05);
    expect(clipped).toBe(false);
    // Квадрат из 50×40: достраивается по высоте поровну сверху и снизу.
    expect(fitInsetBounds([1400, 10, 50, 40], [1461, 1077], 1, 0)).toMatchObject({ bounds: [1400, 5, 50, 50] });
    // Регион вылезает за правый край карты: рамка сдвигается внутрь.
    expect(fitInsetBounds([1430, 10, 50, 40], [1461, 1077], 1, 0)).toMatchObject({ bounds: [1411, 5, 50, 50] });
    // Широкая полоса в пропорциях 3:2 больше карты — рамка уменьшается, регион не влезает.
    expect(fitInsetBounds([0, 0, 1461, 235], [1461, 300], 1.5, 0).clipped).toBe(true);
    expect(unionRect([[0, 0, 10, 10], [20, 5, 5, 20]])).toEqual([0, 0, 25, 25]);
    expect(referenceSize([0, 0, 300, 200], 1536)).toEqual([1536, 1024]);
    expect(referenceSize([0, 0, 200, 300], 1536)).toEqual([1024, 1536]);
  });
});

describe('ART_FILE_RE', () => {
  it('ловит арт карты и врезок и на Windows, и в POSIX-путях', () => {
    const win = String.raw`D:\p\world\maps\world\insets\east\source.webp`;
    expect(ART_FILE_RE.exec(String.raw`D:\p\world\maps\world\source.png`)?.[1]).toBe('world');
    expect(ART_FILE_RE.exec(win)?.[1]).toBe('world');
    expect(ART_FILE_RE.exec('/p/world/maps/city/source.svg')?.[1]).toBe('city');
    expect(ART_FILE_RE.test(String.raw`D:\p\world\maps\world\insets\east\reference.png`)).toBe(false);
    expect(ART_FILE_RE.test(String.raw`D:\p\world\lore\a\source.png`)).toBe(false);
  });
});
