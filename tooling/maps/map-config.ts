/**
 * Карты на диске: поиск папок world/maps/<id>/, чтение и проверка map.json,
 * сведения об исходнике арта, пространство координат (size).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import type { z } from 'zod';
import { MAP_CONFIG_FILE, MAPS_DIR, SLUG_RE } from '../../src/shared/paths.ts';
import { MapConfigSchema, type MapConfig } from '../../src/shared/schemas.ts';
import { formatJson, isFile, pathExists, toPosix, writeFileAtomic } from './lib/fs.ts';

/** Ошибка в данных карты: сообщение для пользователя, без стека. */
export class MapError extends Error {
  override name = 'MapError';
}

export interface MapScan {
  /** id карт с map.json (по алфавиту). */
  ids: string[];
  /** Папки с недопустимым именем: id карты — только a-z, 0-9 и дефисы. */
  invalidNames: string[];
  /** Папки без map.json. */
  missingConfig: string[];
}

/** Папки карт. Имена на «_» и «.» пропускаются (черновики, служебные папки). */
export async function scanMaps(root: string): Promise<MapScan> {
  const scan: MapScan = { ids: [], invalidNames: [], missingConfig: [] };
  const mapsDir = path.join(root, MAPS_DIR);
  if (!(await pathExists(mapsDir))) return scan;
  const entries = await fs.readdir(mapsDir, { withFileTypes: true });
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    if (!SLUG_RE.test(e.name)) scan.invalidNames.push(e.name);
    else if (!(await isFile(path.join(mapsDir, e.name, MAP_CONFIG_FILE)))) scan.missingConfig.push(e.name);
    else scan.ids.push(e.name);
  }
  return scan;
}

export interface LoadedMap {
  id: string;
  /** Абсолютный путь к папке карты. */
  dir: string;
  configFile: string;
  /** map.json как есть — для перезаписи без потери порядка ключей и лишних полей. */
  raw: Record<string, unknown>;
  config: MapConfig;
}

/** Путь относительно корня проекта (для сообщений). */
export function relPath(root: string, file: string): string {
  return toPosix(path.relative(root, file));
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(корень)'}: ${i.message}`).join('; ');
}

export async function loadMap(root: string, id: string): Promise<LoadedMap> {
  const dir = path.join(root, MAPS_DIR, id);
  const configFile = path.join(dir, MAP_CONFIG_FILE);
  const rel = relPath(root, configFile);
  let text: string;
  try {
    text = await fs.readFile(configFile, 'utf8');
  } catch {
    throw new MapError(`${rel}: файл не найден`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new MapError(`${rel}: некорректный JSON — ${(error as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new MapError(`${rel}: ожидался JSON-объект`);
  const parsed = MapConfigSchema.safeParse(raw);
  if (!parsed.success) throw new MapError(`${rel}: ${formatIssues(parsed.error)}`);
  return { id, dir, configFile, raw: raw as Record<string, unknown>, config: parsed.data };
}

export interface SourceInfo {
  /** Абсолютный путь к файлу арта. */
  file: string;
  /** Имя файла, как записано в map.json. */
  name: string;
  /** SVG: растеризуется с запасом детализации. */
  vector: boolean;
  /** Размер в пикселях с учётом EXIF-ориентации; у SVG — собственный размер (72 dpi). */
  width: number;
  height: number;
}

/** Сведения об исходнике; null — у карты нет арта (карта только с данными). */
export async function probeSource(root: string, map: LoadedMap): Promise<SourceInfo | null> {
  const name = map.config.source;
  if (!name) return null;
  const file = path.resolve(map.dir, name);
  const inside = path.relative(map.dir, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new MapError(`${relPath(root, map.configFile)}: source должен лежать в папке карты, а не «${name}»`);
  }
  if (!(await isFile(file))) throw new MapError(`карта ${map.id}: не найден файл арта ${relPath(root, file)}`);
  let meta: Metadata;
  try {
    meta = await sharp(file, { limitInputPixels: false }).metadata();
  } catch (error) {
    throw new MapError(`карта ${map.id}: не удалось прочитать ${relPath(root, file)} — ${(error as Error).message}`);
  }
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new MapError(`карта ${map.id}: у ${relPath(root, file)} не удалось определить размер`);
  return { file, name, vector: meta.format === 'svg', width, height };
}

/** Относительное расхождение пропорций двух прямоугольников (0.01 = 1 %). */
export function aspectDifference(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.abs((a[0] / a[1]) / (b[0] / b[1]) - 1);
}

/** Объект с новым ключом сразу после `after` (или в конце); существующий ключ меняется на месте. */
function withKey(obj: Record<string, unknown>, key: string, value: unknown, after: string): Record<string, unknown> {
  if (Object.hasOwn(obj, key) || !Object.hasOwn(obj, after)) return { ...obj, [key]: value };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v;
    if (k === after) out[key] = value;
  }
  return out;
}

/**
 * Пространство координат карты: size из map.json, а если его нет — размер исходника,
 * который тут же записывается в map.json (дальше он не меняется, даже при замене арта).
 */
export async function ensureMapSize(map: LoadedMap, source: SourceInfo): Promise<{ size: [number, number]; written: boolean }> {
  if (map.config.size) return { size: [map.config.size[0], map.config.size[1]], written: false };
  const size: [number, number] = [source.width, source.height];
  map.raw = withKey(map.raw, 'size', size, 'source');
  map.config = { ...map.config, size };
  await writeFileAtomic(map.configFile, formatJson(map.raw));
  return { size, written: true };
}
