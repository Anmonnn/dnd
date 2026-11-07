/**
 * Детальные врезки: арт высокого разрешения на часть карты (world/maps/<id>/insets/<insetId>/).
 *
 * Врезка режется на ТОЙ ЖЕ сетке тайлов, что и карта: уровень z — арт, отмасштабированный до
 * bounds × 2^(z − zoomBase) пикселей и положенный в своё место пиксельной сетки уровня мира.
 * Поэтому в просмотрщике это обычный TileLayer с bounds — объекты карты, CRS и зум не меняются.
 * Края врезки растушёвываются в альфу — она без шва ложится поверх арта карты.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { GENERATED_INSETS_DIR, GENERATED_INSETS_URL, INSET_CONFIG_FILE, INSETS_DIR, MAPS_DIR, SLUG_RE, TILES_META_FILE } from '../../src/shared/paths.ts';
import { INSET_DEFAULT_FEATHER, InsetConfigSchema, InsetMetaSchema, type InsetConfig, type InsetMeta } from '../../src/shared/schemas.ts';
import { defaultInsetShowFrom, insetMinZoom, TILE_SIZE } from '../../src/shared/zoom.ts';
import { formatJson, hashFile, isFile, publishDir, removePath } from './lib/fs.ts';
import { errorMessage, formatDuration, formatInt, plural, stopwatch, type Log } from './lib/log.ts';
import { runPool } from './lib/pool.ts';
import { decodeRaster, RESIZE_KERNEL, TILE_FORMAT, WEBP_ALPHA_QUALITY, WEBP_EFFORT, type Raster } from './tiles.ts';

/** Меняется при изменении алгоритма — все врезки перенарежутся. */
export const INSETS_ALGORITHM_VERSION = 1;
const SOURCE_CANDIDATES = ['source.png', 'source.jpg', 'source.jpeg', 'source.webp'];

export type Bounds = readonly [number, number, number, number];

export interface InsetLevel {
  z: number;
  /** Прямоугольник врезки в пикселях уровня мира: [x0, x1) × [y0, y1). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Тайлы сетки мира, которые задевает врезка (включительно). */
  col0: number;
  col1: number;
  row0: number;
  row1: number;
}

export interface InsetPlan {
  minZoom: number;
  maxNativeZoom: number;
  levels: InsetLevel[];
}

/**
 * Уровни врезки: от minZoom до нативного уровня арта (сколько пикселей арта приходится на единицу карты).
 * Диапазон тайлов считается по НЕокруглённым краям, как это делает Leaflet для слоя с bounds, —
 * иначе на границе он запросит тайл, которого нет.
 */
export function planInset(opts: { zoomBase: number; bounds: Bounds; sourceSize: readonly [number, number]; minZoom: number }): InsetPlan {
  const { zoomBase, bounds, sourceSize, minZoom } = opts;
  const [bx, by, bw, bh] = bounds;
  const pxPerUnit = Math.min(sourceSize[0] / bw, sourceSize[1] / bh);
  const maxNativeZoom = Math.max(minZoom, zoomBase + Math.max(0, Math.round(Math.log2(pxPerUnit))));
  const levels: InsetLevel[] = [];
  for (let z = minZoom; z <= maxNativeZoom; z++) {
    const s = 2 ** (z - zoomBase);
    const fx0 = bx * s;
    const fy0 = by * s;
    const fx1 = (bx + bw) * s;
    const fy1 = (by + bh) * s;
    const x0 = Math.round(fx0);
    const y0 = Math.round(fy0);
    const x1 = Math.max(x0 + 1, Math.round(fx1));
    const y1 = Math.max(y0 + 1, Math.round(fy1));
    levels.push({
      z,
      x0,
      y0,
      x1,
      y1,
      col0: Math.floor(Math.min(fx0, x0) / TILE_SIZE),
      col1: Math.ceil(Math.max(fx1, x1) / TILE_SIZE) - 1,
      row0: Math.floor(Math.min(fy0, y0) / TILE_SIZE),
      row1: Math.ceil(Math.max(fy1, y1) / TILE_SIZE) - 1,
    });
  }
  return { minZoom, maxNativeZoom, levels };
}

/** Растушёвка: альфа плавно спадает к краям (smoothstep) на feather × меньшая сторона. */
export function featherAlpha(raster: Raster, feather: number): void {
  const band = feather * Math.min(raster.width, raster.height);
  if (band < 1) return;
  const { data, width, height } = raster;
  for (let y = 0; y < height; y++) {
    const dy = Math.min(y + 0.5, height - y - 0.5);
    for (let x = 0; x < width; x++) {
      const d = Math.min(dy, x + 0.5, width - x - 0.5) / band;
      if (d >= 1) continue;
      const t = d <= 0 ? 0 : d * d * (3 - 2 * d);
      const i = (y * width + x) * 4 + 3;
      data[i] = Math.round(data[i]! * t);
    }
  }
}

/** Файл арта врезки: явно указанный в inset.json или source.png / .jpg / .jpeg / .webp. */
export async function insetSourceFile(dir: string, config: Pick<InsetConfig, 'source'>): Promise<string | null> {
  const names = config.source ? [config.source] : SOURCE_CANDIDATES;
  for (const name of names) {
    const file = path.resolve(dir, name);
    if (path.relative(dir, file).startsWith('..')) continue;
    if (await isFile(file)) return file;
  }
  return null;
}

export interface InsetEntry {
  id: string;
  dir: string;
  configFile: string;
  config: InsetConfig;
}

/** Папки врезок карты (с inset.json). Ошибки — в errors, такие врезки пропускаются. */
export async function scanInsets(mapDir: string, errors: string[]): Promise<InsetEntry[]> {
  const root = path.join(mapDir, INSETS_DIR);
  let names: string[];
  try {
    names = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && !/^[_.]/.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
  const out: InsetEntry[] = [];
  for (const id of names.sort()) {
    const dir = path.join(root, id);
    const configFile = path.join(dir, INSET_CONFIG_FILE);
    if (!SLUG_RE.test(id)) {
      errors.push(`врезка «${id}»: имя папки — только a-z, 0-9 и дефисы`);
      continue;
    }
    let text: string;
    try {
      text = await fs.readFile(configFile, 'utf8');
    } catch {
      continue; // папка без inset.json — черновик, не врезка
    }
    try {
      const parsed = InsetConfigSchema.safeParse(JSON.parse(text.replace(/^﻿/, '')));
      if (!parsed.success) {
        errors.push(`врезка «${id}»: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`).join('; ')}`);
        continue;
      }
      out.push({ id, dir, configFile, config: parsed.data });
    } catch (error) {
      errors.push(`врезка «${id}»: некорректный JSON — ${errorMessage(error)}`);
    }
  }
  return out;
}

async function readMeta(file: string): Promise<InsetMeta | null> {
  try {
    const parsed = InsetMetaSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Тайлы одного уровня: полосы по строкам тайлов сетки мира, тайлы — кусок врезки в своей позиции. */
async function* levelTiles(src: Raster, level: InsetLevel): AsyncGenerator<{ z: number; x: number; y: number; rgba: Buffer }> {
  const width = level.x1 - level.x0;
  const height = level.y1 - level.y0;
  for (let row = level.row0; row <= level.row1; row++) {
    const top = Math.max(row * TILE_SIZE, level.y0);
    const bottom = Math.min((row + 1) * TILE_SIZE, level.y1);
    let strip: Buffer | null = null;
    if (bottom > top) {
      // libvips считает только нужные строки отмасштабированного арта.
      strip = await sharp(src.data, { raw: { width: src.width, height: src.height, channels: 4 }, limitInputPixels: false })
        .resize(width, height, { fit: 'fill', kernel: RESIZE_KERNEL })
        .extract({ left: 0, top: top - level.y0, width, height: bottom - top })
        .raw()
        .toBuffer();
    }
    for (let col = level.col0; col <= level.col1; col++) {
      const tile = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
      const left = Math.max(col * TILE_SIZE, level.x0);
      const right = Math.min((col + 1) * TILE_SIZE, level.x1);
      if (strip && right > left) {
        for (let y = 0; y < bottom - top; y++) {
          const from = (y * width + (left - level.x0)) * 4;
          const to = ((top - row * TILE_SIZE + y) * TILE_SIZE + (left - col * TILE_SIZE)) * 4;
          strip.copy(tile, to, from, from + (right - left) * 4);
        }
      }
      yield { z: level.z, x: col, y: row, rgba: tile };
    }
  }
}

export interface InsetBuildContext {
  root: string;
  mapId: string;
  mapDir: string;
  zoomBase: number;
  /** Нативный максимум арта карты — от него считается showFrom по умолчанию. */
  mapMaxNativeZoom: number;
  force: boolean;
  quality: number;
  concurrency: number;
  log: Log;
  warnings: string[];
  errors: string[];
}

/** Нарезает врезки одной карты (инкрементально) и убирает тайлы удалённых врезок. Возвращает число нарезанных. */
export async function buildInsets(ctx: InsetBuildContext): Promise<number> {
  const outRoot = path.join(ctx.root, GENERATED_INSETS_DIR, ctx.mapId);
  const entries = await scanInsets(ctx.mapDir, ctx.errors);
  const keep = new Set<string>();
  let built = 0;

  for (const entry of entries) {
    const label = `${ctx.mapId}/${entry.id}`;
    const source = await insetSourceFile(entry.dir, entry.config);
    if (!source) continue; // арта ещё нет — врезка ждёт source.png
    keep.add(entry.id);
    try {
      const timer = stopwatch();
      const feather = entry.config.feather ?? INSET_DEFAULT_FEATHER;
      const showFrom = entry.config.showFrom ?? defaultInsetShowFrom(ctx.mapMaxNativeZoom);
      const minZoom = insetMinZoom(showFrom);
      const metadata = await sharp(source, { limitInputPixels: false }).metadata();
      const sourceSize: [number, number] = [metadata.autoOrient?.width ?? metadata.width ?? 0, metadata.autoOrient?.height ?? metadata.height ?? 0];
      if (!sourceSize[0] || !sourceSize[1]) throw new Error('не удалось определить размер арта');
      const [, , bw, bh] = entry.config.bounds;
      const aspect = Math.abs(sourceSize[0] / sourceSize[1] / (bw / bh) - 1);
      if (aspect > 0.02) {
        ctx.warnings.push(`врезка ${label}: пропорции арта и bounds расходятся на ${(aspect * 100).toFixed(1)} % — арт будет растянут`);
      }
      const plan = planInset({ zoomBase: ctx.zoomBase, bounds: entry.config.bounds, sourceSize, minZoom });
      const hash = await hashFile(
        source,
        JSON.stringify({ v: INSETS_ALGORITHM_VERSION, bounds: entry.config.bounds, feather, minZoom, zoomBase: ctx.zoomBase, quality: ctx.quality }),
      );
      const outDir = path.join(outRoot, entry.id);
      const old = await readMeta(path.join(outDir, TILES_META_FILE));
      if (!ctx.force && old?.sourceHash === hash) continue;

      const temp = path.join(outRoot, `.${entry.id}.tmp-${process.pid}`);
      await removePath(temp);
      await fs.mkdir(temp, { recursive: true });
      try {
        const raster = await decodeRaster(source);
        featherAlpha(raster, feather);
        let tiles = 0;
        for (const level of plan.levels) {
          for (let x = level.col0; x <= level.col1; x++) await fs.mkdir(path.join(temp, String(level.z), String(x)), { recursive: true });
          await runPool(levelTiles(raster, level), ctx.concurrency, async (job) => {
            await sharp(job.rgba, { raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 4 } })
              .webp({ quality: ctx.quality, alphaQuality: WEBP_ALPHA_QUALITY, effort: WEBP_EFFORT })
              .toFile(path.join(temp, String(job.z), String(job.x), `${job.y}.${TILE_FORMAT}`));
            tiles++;
          });
        }
        const meta: InsetMeta = {
          version: 1,
          sourceFile: path.basename(source),
          sourceHash: hash,
          sourceSize,
          bounds: [...entry.config.bounds],
          feather,
          minZoom: plan.minZoom,
          maxNativeZoom: plan.maxNativeZoom,
          tileSize: TILE_SIZE,
          tiles: `${GENERATED_INSETS_URL}/${ctx.mapId}/${entry.id}/{z}/{x}/{y}.${TILE_FORMAT}`,
        };
        await fs.writeFile(path.join(temp, TILES_META_FILE), formatJson(InsetMetaSchema.parse(meta)));
        await publishDir(temp, outDir, TILES_META_FILE);
        built++;
        ctx.log(
          `  ${label}: ${path.basename(source)} ${sourceSize.join('×')}, z ${plan.minZoom}–${plan.maxNativeZoom}, ` +
            `${formatInt(tiles)} ${plural(tiles, ['тайл', 'тайла', 'тайлов'])} — ${formatDuration(timer.elapsed())}`,
        );
      } finally {
        await removePath(temp);
      }
    } catch (error) {
      ctx.errors.push(`врезка ${label}: ${errorMessage(error)}`);
      ctx.log(`  ошибка: врезка ${label}: ${errorMessage(error)}`);
    }
  }

  // Тайлы врезок, которых больше нет (или у которых убрали арт).
  for (const name of await fs.readdir(outRoot).catch(() => [] as string[])) {
    if (!keep.has(name) && !name.startsWith('.')) await removePath(path.join(outRoot, name));
  }
  return built;
}

/** Убирает тайлы врезок карт, которых больше нет. */
export async function pruneInsetMaps(root: string, mapIds: ReadonlySet<string>): Promise<void> {
  const dir = path.join(root, GENERATED_INSETS_DIR);
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!mapIds.has(name)) await removePath(path.join(dir, name));
  }
}

/** Путь к папке врезок карты (для CLI и сообщений). */
export function insetsDirOf(root: string, mapId: string): string {
  return path.join(root, MAPS_DIR, mapId, INSETS_DIR);
}
