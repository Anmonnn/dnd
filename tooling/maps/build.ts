/**
 * `npm run maps`: для каждой карты с арт-подложкой — пирамида тайлов WebP, превью и meta.json
 * в public/generated/maps/<id>/. Инкрементально: если хеш исходника и параметров нарезки
 * не изменился, карта пропускается.
 *
 * Всё пишется во временную папку рядом с итоговой и подменяется в самом конце (см. publishDir),
 * meta.json — последним: запущенный dev-сервер не увидит наполовину нарезанную карту.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { GENERATED_MAPS_DIR, GENERATED_MAPS_URL, TILES_META_FILE } from '../../src/shared/paths.ts';
import { TilesMetaSchema, type TilesMeta } from '../../src/shared/schemas.ts';
import { TILE_SIZE } from '../../src/shared/zoom.ts';
import { formatJson, hashFile, isFile, isProcessAlive, publishDir, removePath } from './lib/fs.ts';
import { errorMessage, formatDuration, formatInt, formatSize, plural, silentLog, stopwatch, type Log } from './lib/log.ts';
import { aspectDifference, ensureMapSize, loadMap, MapError, probeSource, relPath, scanMaps, type SourceInfo } from './map-config.ts';
import { buildInsets, pruneInsetMaps } from './insets.ts';
import { planPyramid, type PyramidPlan } from './pyramid.ts';
import { zoomBaseFor } from '../../src/shared/zoom.ts';
import {
  decodeRaster,
  DEFAULT_QUALITY,
  PREVIEW_MAX_SIDE,
  PREVIEW_QUALITY,
  RESIZE_KERNEL,
  svgDensity,
  TILE_FORMAT,
  TILES_ALGORITHM_VERSION,
  WEBP_ALPHA_QUALITY,
  WEBP_EFFORT,
  writePreview,
  writeTiles,
} from './tiles.ts';

export const PREVIEW_FILE = `preview.${TILE_FORMAT}`;
/** Допустимое расхождение пропорций арта и size, дальше — предупреждение. */
const ASPECT_TOLERANCE = 0.01;

export interface BuildOptions {
  /** Корень проекта (в нём world/ и public/). */
  root: string;
  /** Только эти карты; пусто — все карты и уборка устаревших папок. */
  ids?: readonly string[];
  /** Пересобрать, даже если всё актуально. */
  force?: boolean;
  /** Качество WebP 1–100. */
  quality?: number;
  /** Сколько тайлов кодируется одновременно. */
  concurrency?: number;
  log?: Log;
}

export type MapStatus = 'built' | 'skipped' | 'no-source' | 'error';

export interface MapResult {
  id: string;
  status: MapStatus;
  /** Для built: число тайлов. */
  tiles?: number;
  message?: string;
  /** Сетка карты — по ней режутся врезки. */
  zoomBase?: number;
  maxNativeZoom?: number;
}

export interface BuildReport {
  results: MapResult[];
  /** Удалённые папки public/generated/maps/<dir>. */
  removed: string[];
  warnings: string[];
  errors: string[];
  ok: boolean;
}

/** Всё, что влияет на результат нарезки, — входит в хеш вместе с байтами исходника. */
function hashParams(source: SourceInfo, size: readonly [number, number], quality: number): string {
  return JSON.stringify({
    algorithm: TILES_ALGORITHM_VERSION,
    sourceFile: source.name,
    tileSize: TILE_SIZE,
    format: TILE_FORMAT,
    quality,
    alphaQuality: WEBP_ALPHA_QUALITY,
    effort: WEBP_EFFORT,
    kernel: RESIZE_KERNEL,
    preview: [PREVIEW_MAX_SIDE, PREVIEW_QUALITY],
    size,
    vector: source.vector,
  });
}

async function readMeta(file: string): Promise<TilesMeta | null> {
  try {
    const parsed = TilesMetaSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Актуальна ли готовая нарезка: тот же хеш, на месте превью и тайлы самого детального уровня. */
async function isUpToDate(outDir: string, hash: string, plan: PyramidPlan): Promise<boolean> {
  const meta = await readMeta(path.join(outDir, TILES_META_FILE));
  if (!meta || meta.sourceHash !== hash || meta.maxNativeZoom !== plan.maxNativeZoom) return false;
  const top = plan.levels[plan.levels.length - 1];
  if (!top) return false;
  const tile = (x: number, y: number) => path.join(outDir, String(top.z), String(x), `${y}.${TILE_FORMAT}`);
  return (
    (await isFile(path.join(outDir, PREVIEW_FILE))) &&
    (await isFile(tile(0, 0))) &&
    (await isFile(tile(top.cols - 1, top.rows - 1)))
  );
}

const TEMP_DIR_RE = /^\.(.+)\.tmp-(\d+)-[a-z0-9]+(?:-old)?$/;

function tempDirName(id: string): string {
  return `.${id}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

interface BuildContext {
  root: string;
  outRoot: string;
  force: boolean;
  quality: number;
  concurrency: number;
  log: Log;
  warnings: string[];
  /** Ошибка в отчёт и в лог. */
  fail: (message: string) => void;
}

/** Врезки карты режутся на её сетке; у карты без арта сетка считается по size из map.json. */
async function buildMapInsets(ctx: BuildContext, id: string, result: MapResult): Promise<void> {
  let { zoomBase, maxNativeZoom } = result;
  if (zoomBase === undefined) {
    const size = (await loadMap(ctx.root, id)).config.size;
    if (!size) return;
    zoomBase = zoomBaseFor(size[0], size[1]);
    maxNativeZoom = zoomBase;
  }
  const errors: string[] = [];
  await buildInsets({
    root: ctx.root,
    mapId: id,
    mapDir: path.join(ctx.root, 'world', 'maps', id),
    zoomBase,
    mapMaxNativeZoom: maxNativeZoom ?? zoomBase,
    force: ctx.force,
    quality: ctx.quality,
    concurrency: ctx.concurrency,
    log: ctx.log,
    warnings: ctx.warnings,
    errors,
  });
  for (const message of errors) ctx.fail(message);
}

async function buildOne(ctx: BuildContext, id: string): Promise<MapResult> {
  const { root, log } = ctx;
  const timer = stopwatch();
  const map = await loadMap(root, id);
  const source = await probeSource(root, map);
  if (!source) return { id, status: 'no-source' };

  const { size, written } = await ensureMapSize(map, source);
  if (written) log(`  ${id}: size не был задан — записан [${size.join(', ')}] в ${relPath(root, map.configFile)}`);
  const sourceSize: [number, number] = [source.width, source.height];
  if (!source.vector && aspectDifference(size, sourceSize) > ASPECT_TOLERANCE) {
    const warning =
      `карта ${id}: пропорции арта ${formatSize(sourceSize)} не совпадают с size ${formatSize(size)} ` +
      `(${(aspectDifference(size, sourceSize) * 100).toFixed(1)} %) — картинка будет растянута`;
    ctx.warnings.push(warning);
    log(`  предупреждение: ${warning}`);
  }

  const plan = planPyramid({ size, sourceSize, vector: source.vector });
  const hash = await hashFile(source.file, hashParams(source, size, ctx.quality));
  const outDir = path.join(ctx.outRoot, id);
  if (!ctx.force && (await isUpToDate(outDir, hash, plan))) {
    log(`  ${id}: актуально`);
    return { id, status: 'skipped', zoomBase: plan.zoomBase, maxNativeZoom: plan.maxNativeZoom };
  }

  const tempDir = path.join(ctx.outRoot, tempDirName(id));
  try {
    await fs.mkdir(tempDir, { recursive: true });
    const raster = await decodeRaster(source.file, source.vector ? svgDensity(sourceSize, plan) : undefined);
    const tiles = await writeTiles(raster, plan, tempDir, { quality: ctx.quality, concurrency: ctx.concurrency });
    await writePreview(raster, size, path.join(tempDir, PREVIEW_FILE));
    const base = `${GENERATED_MAPS_URL}/${id}`;
    const meta: TilesMeta = {
      version: 1,
      sourceFile: source.name,
      sourceHash: hash,
      sourceSize,
      size,
      zoomBase: plan.zoomBase,
      maxNativeZoom: plan.maxNativeZoom,
      tileSize: TILE_SIZE,
      format: TILE_FORMAT,
      preview: `${base}/${PREVIEW_FILE}`,
      tiles: `${base}/{z}/{x}/{y}.${TILE_FORMAT}`,
    };
    // meta.json — последним: его появление означает, что нарезка готова целиком.
    await fs.writeFile(path.join(tempDir, TILES_META_FILE), formatJson(TilesMetaSchema.parse(meta)));
    await publishDir(tempDir, outDir, TILES_META_FILE);
    const zooms = plan.maxNativeZoom > 0 ? `z 0–${plan.maxNativeZoom}` : 'z 0';
    log(
      `  ${id}: ${source.name} ${formatSize(sourceSize)} → ${formatSize(size)}, ${zooms}, ` +
        `${formatInt(tiles)} ${plural(tiles, ['тайл', 'тайла', 'тайлов'])} — ${formatDuration(timer.elapsed())}`,
    );
    return { id, status: 'built', tiles, zoomBase: plan.zoomBase, maxNativeZoom: plan.maxNativeZoom };
  } finally {
    await removePath(tempDir);
  }
}

/** Удаляет папки карт, которых больше нет (или у которых нет арта), и брошенные временные папки. */
async function cleanup(ctx: BuildContext, keep: ReadonlySet<string>): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(ctx.outRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || keep.has(e.name)) continue;
    const temp = TEMP_DIR_RE.exec(e.name);
    if (temp && isProcessAlive(Number(temp[2]))) continue; // параллельный запуск ещё работает
    await removePath(path.join(ctx.outRoot, e.name));
    removed.push(e.name);
  }
  return removed;
}

export async function buildMaps(options: BuildOptions): Promise<BuildReport> {
  const log = options.log ?? silentLog;
  const quality = options.quality ?? DEFAULT_QUALITY;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new MapError(`качество WebP должно быть целым числом от 1 до 100, получено ${quality}`);
  }
  // Кеш libvips копит декодированные картинки между вызовами — для пакетной нарезки он вреден.
  sharp.cache(false);

  const ctx: BuildContext = {
    root: options.root,
    outRoot: path.join(options.root, GENERATED_MAPS_DIR),
    force: options.force ?? false,
    quality,
    concurrency: options.concurrency ?? 8,
    log,
    warnings: [],
    fail: (message) => fail(message),
  };
  const report: BuildReport = { results: [], removed: [], warnings: ctx.warnings, errors: [], ok: true };
  const fail = (message: string) => {
    report.errors.push(message);
    log(`  ошибка: ${message}`);
  };

  const scan = await scanMaps(ctx.root);
  const selected = options.ids?.length ? [...new Set(options.ids)] : null;
  if (!selected) {
    for (const name of scan.invalidNames) fail(`папка world/maps/${name}: id карты — только a-z, 0-9 и дефисы`);
    for (const name of scan.missingConfig) {
      const warning = `папка world/maps/${name} без map.json — пропущена`;
      ctx.warnings.push(warning);
      log(`  предупреждение: ${warning}`);
    }
  }

  const ids = selected ?? scan.ids;
  // Папки, которые уборка не трогает: карты с артом и карты с ошибками (старая нарезка остаётся).
  const keep = new Set<string>();
  for (const id of ids) {
    if (!scan.ids.includes(id)) {
      fail(`карта «${id}» не найдена (нет world/maps/${id}/map.json)`);
      continue;
    }
    try {
      const result = await buildOne(ctx, id);
      report.results.push(result);
      if (result.status !== 'no-source') keep.add(id);
      await buildMapInsets(ctx, id, result);
    } catch (error) {
      keep.add(id);
      const message = error instanceof MapError ? error.message : `карта ${id}: ${errorMessage(error)}`;
      report.results.push({ id, status: 'error', message });
      fail(message);
    }
  }

  if (!selected) {
    await pruneInsetMaps(ctx.root, new Set(scan.ids));
    report.removed = await cleanup(ctx, keep);
    if (report.removed.length) log(`  удалены устаревшие папки: ${report.removed.join(', ')}`);
  }
  report.ok = report.errors.length === 0;
  return report;
}
