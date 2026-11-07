/**
 * Нарезка арта: декодирование исходника, уровни пирамиды, тайлы WebP 256×256, превью.
 *
 * Уровень z — исходник, отмасштабированный ровно до (width, height) уровня (fill, lanczos3).
 * Уровень считается полосами высотой в тайл (libvips вычисляет только нужные строки),
 * поэтому в памяти — исходник и одна-две полосы, а не весь уровень целиком.
 * Крайние тайлы дополняются прозрачными пикселями до 256×256, а не растягиваются.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { TILE_SIZE } from '../../src/shared/zoom.ts';
import { runPool } from './lib/pool.ts';
import { topLevel, type PyramidLevel, type PyramidPlan } from './pyramid.ts';

/** Меняется при изменении алгоритма нарезки — входит в хеш, старые тайлы пересоберутся. */
export const TILES_ALGORITHM_VERSION = 1;
export const TILE_FORMAT = 'webp';
export const RESIZE_KERNEL = 'lanczos3';
export const WEBP_ALPHA_QUALITY = 100;
export const WEBP_EFFORT = 4;
export const DEFAULT_QUALITY = 82;
export const PREVIEW_MAX_SIDE = 1024;
export const PREVIEW_QUALITY = 80;
/** Предел растеризации SVG по стороне. */
export const MAX_RASTER_SIDE = 16384;

/** Несжатая картинка RGBA, 8 бит на канал. */
export interface Raster {
  data: Buffer;
  width: number;
  height: number;
}

const rawInput = (r: Raster) => ({ raw: { width: r.width, height: r.height, channels: 4 as const }, limitInputPixels: false });

/** Декодирует исходник в RGBA (sRGB, EXIF-ориентация учтена). density — dpi для SVG. */
export async function decodeRaster(file: string, density?: number): Promise<Raster> {
  const { data, info } = await sharp(file, { autoOrient: true, limitInputPixels: false, ...(density ? { density } : {}) })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || data.length !== info.width * info.height * 4) {
    throw new Error(`неожиданный формат пикселей после декодирования: ${info.channels} канала(ов), ${info.width}×${info.height}`);
  }
  return { data, width: info.width, height: info.height };
}

/**
 * dpi для растеризации SVG: самый детальный уровень пирамиды должен получиться без апскейла,
 * но не больше MAX_RASTER_SIDE по стороне.
 */
export function svgDensity(svgSize: readonly [number, number], plan: PyramidPlan): number {
  const top = topLevel(plan);
  const want = Math.max(top.width / svgSize[0], top.height / svgSize[1]);
  const cap = MAX_RASTER_SIDE / Math.max(svgSize[0], svgSize[1]);
  return Math.min(100_000, Math.max(1, 72 * Math.min(want, cap)));
}

/** Полоса уровня: строки [row·256, row·256 + 256) картинки уровня, RGBA. */
export async function renderStrip(src: Raster, level: PyramidLevel, row: number): Promise<{ data: Buffer; height: number }> {
  const top = row * TILE_SIZE;
  const height = Math.min(TILE_SIZE, level.height - top);
  const { data, info } = await sharp(src.data, rawInput(src))
    .resize(level.width, level.height, { fit: 'fill', kernel: RESIZE_KERNEL })
    .extract({ left: 0, top, width: level.width, height })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== level.width || info.height !== height || info.channels !== 4) {
    throw new Error(`уровень ${level.z}: полоса ${info.width}×${info.height}×${info.channels} вместо ${level.width}×${height}×4`);
  }
  return { data, height };
}

/** Тайл col из полосы: 256×256 RGBA, всё за пределами картинки — прозрачное. */
export function cutTile(strip: Buffer, stripWidth: number, stripHeight: number, col: number): Buffer {
  const tile = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  const x0 = col * TILE_SIZE;
  const w = Math.min(TILE_SIZE, stripWidth - x0);
  for (let y = 0; y < stripHeight; y++) {
    const from = (y * stripWidth + x0) * 4;
    strip.copy(tile, y * TILE_SIZE * 4, from, from + w * 4);
  }
  return tile;
}

interface TileJob {
  z: number;
  x: number;
  y: number;
  rgba: Buffer;
}

async function* tileJobs(src: Raster, plan: PyramidPlan): AsyncGenerator<TileJob> {
  for (const level of plan.levels) {
    for (let row = 0; row < level.rows; row++) {
      const strip = await renderStrip(src, level, row);
      for (let col = 0; col < level.cols; col++) {
        yield { z: level.z, x: col, y: row, rgba: cutTile(strip.data, level.width, strip.height, col) };
      }
    }
  }
}

export interface TileOptions {
  quality: number;
  /** Сколько тайлов кодируется одновременно. */
  concurrency?: number;
}

/** Пишет тайлы всех уровней в outDir/{z}/{x}/{y}.webp (x — столбец, y — строка). Возвращает число тайлов. */
export async function writeTiles(src: Raster, plan: PyramidPlan, outDir: string, options: TileOptions): Promise<number> {
  for (const level of plan.levels) {
    for (let x = 0; x < level.cols; x++) await fs.mkdir(path.join(outDir, String(level.z), String(x)), { recursive: true });
  }
  let count = 0;
  await runPool(tileJobs(src, plan), options.concurrency ?? 8, async (job) => {
    await sharp(job.rgba, { raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 4 } })
      .webp({ quality: options.quality, alphaQuality: WEBP_ALPHA_QUALITY, effort: WEBP_EFFORT })
      .toFile(path.join(outDir, String(job.z), String(job.x), `${job.y}.${TILE_FORMAT}`));
    count++;
  });
  return count;
}

/** Размер превью: пропорции пространства координат, ≤ maxSide, без апскейла сверх детализации растра. */
export function previewSize(size: readonly [number, number], raster: { width: number; height: number }, maxSide = PREVIEW_MAX_SIDE): [number, number] {
  const [w, h] = size;
  const rasterScale = Math.min(raster.width / w, raster.height / h);
  const scale = Math.min(maxSide / Math.max(w, h), rasterScale);
  return [Math.max(1, Math.min(maxSide, Math.round(w * scale))), Math.max(1, Math.min(maxSide, Math.round(h * scale)))];
}

/** Превью всей карты (растянутой до пропорций пространства координат, как и тайлы). */
export async function writePreview(src: Raster, size: readonly [number, number], file: string): Promise<[number, number]> {
  const [pw, ph] = previewSize(size, src);
  await sharp(src.data, rawInput(src))
    .resize(pw, ph, { fit: 'fill', kernel: RESIZE_KERNEL })
    .webp({ quality: PREVIEW_QUALITY, alphaQuality: WEBP_ALPHA_QUALITY, effort: WEBP_EFFORT })
    .toFile(file);
  return [pw, ph];
}
