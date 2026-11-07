/**
 * Компиляция папки world/ в WorldData (src/shared/types.ts): лор, карты, объекты, связи.
 * Чистая функция от файлов на диске; проблемы в данных копятся в issues, исключений не бросает.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import polygonClipping, { type MultiPolygon as ClipMultiPolygon, type Polygon as ClipPolygon } from 'polygon-clipping';
import polylabel from 'polylabel';
import type { Geometry, Position } from 'geojson';
import type { z } from 'zod';
import { KINDS, isAreaKind, type Kind } from '../../src/shared/kinds.ts';
import {
  FEATURES_FILE,
  GENERATED_INSETS_DIR,
  GENERATED_MAPS_DIR,
  INSET_CONFIG_FILE,
  INSETS_DIR,
  LAND_FILE,
  LORE_DIR,
  MAP_CONFIG_FILE,
  MAPS_DIR,
  SLUG_RE,
  TILES_META_FILE,
  WORLD_CONFIG_FILE,
} from '../../src/shared/paths.ts';
import {
  FeatureSchema,
  INSET_DEFAULT_FEATHER,
  InsetConfigSchema,
  InsetMetaSchema,
  LandSchema,
  LoreFrontmatterSchema,
  MapConfigSchema,
  TilesMetaSchema,
  WorldConfigSchema,
  type LoreFrontmatter,
  type MapConfig,
} from '../../src/shared/schemas.ts';
import { slugify } from '../../src/shared/slug.ts';
import type {
  AuthoredFeatureProps,
  Entity,
  EntityImage,
  Issue,
  MapDef,
  MapFeature,
  MapInset,
  MapPin,
  Vec2,
  Visibility,
  WorldData,
  WorldMode,
} from '../../src/shared/types.ts';
import { defaultInsetShowFrom, zoomBaseFor } from '../../src/shared/zoom.ts';
import { collectImageRefs, renderInline, renderMarkdown, type LinkTarget, type RenderContext } from './markdown.ts';
import { imageRefPath, isExternalUrl, MediaLibrary } from './media.ts';

export interface CompileOptions {
  root: string;
  mode: WorldMode;
  /** dev — в данные попадают пути к исходникам и список проблем. */
  dev: boolean;
  /** Библиотека картинок; переиспользуется между компиляциями ради кеша хешей. Задания на копии — media.pending(). */
  media?: MediaLibrary;
}

const AREA_PALETTE = ['#c9a227', '#3f8f5a', '#b5523b', '#4a7fb5', '#8a5fb0', '#c27c2c', '#2f8f8a', '#a8455f'];

const toPosix = (p: string) => p.split(path.sep).join('/');
const skipName = (name: string) => name.startsWith('_') || name.startsWith('.');
const normalizeKey = (s: string) => s.normalize('NFC').toLowerCase().replace(/ё/g, 'е').trim();
const round2 = (n: number) => Math.round(n * 100) / 100 || 0;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(корень)'}: ${i.message}`).join('; ');
}

async function readText(file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file, 'utf8')).replace(/^﻿/, '');
  } catch {
    return null;
  }
}

async function listMarkdown(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const e of entries) {
    if (skipName(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await listMarkdown(full)));
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) files.push(full);
  }
  return files;
}

interface LoreRecord {
  id: string;
  file: string;
  basename: string;
  fm: LoreFrontmatter;
  body: string;
  visibility: Visibility;
}

/** Обрезает геометрию координат: 2D, 2 знака после запятой. */
function cleanGeometry(geometry: Geometry): Geometry {
  const fix = (c: unknown): unknown =>
    Array.isArray(c) && typeof c[0] === 'number' ? [round2(c[0] as number), round2(c[1] as number)] : (c as unknown[]).map(fix);
  if (geometry.type === 'GeometryCollection') return geometry;
  return { ...geometry, coordinates: fix(geometry.coordinates) } as Geometry;
}

function forEachPosition(geometry: Geometry, fn: (p: Position) => void): void {
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') fn(c as Position);
    else if (Array.isArray(c)) c.forEach(visit);
  };
  if (geometry.type !== 'GeometryCollection') visit(geometry.coordinates);
}

/** Точка, к которой крепятся кружки: сама точка, подпись области или середина линии. */
function anchorPoint(f: MapFeature): Vec2 | null {
  const g = f.display;
  if (g.type === 'Point') return [g.coordinates[0]!, g.coordinates[1]!];
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return f.labelAt;
  const line = g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' ? g.coordinates[0] : undefined;
  const mid = line?.[Math.floor(line.length / 2)];
  return mid ? [mid[0]!, mid[1]!] : null;
}

function ringArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j]![0]! + ring[i]![0]!) * (ring[j]![1]! - ring[i]![1]!);
  return Math.abs(a / 2);
}

export async function compileWorld({ root, mode, dev, media = new MediaLibrary(root) }: CompileOptions): Promise<WorldData> {
  media.begin();
  const issues: Issue[] = [];
  const rel = (file: string) => toPosix(path.relative(root, file));
  const error = (message: string, file: string | null = null) => issues.push({ level: 'error', message, file });
  const warn = (message: string, file: string | null = null) => issues.push({ level: 'warning', message, file });

  // ─── карты: список папок (нужен заранее — для проверки map в лоре) ──────────
  const mapsDir = path.join(root, MAPS_DIR);
  const mapDirs: string[] = [];
  try {
    for (const e of await fs.readdir(mapsDir, { withFileTypes: true })) {
      if (!e.isDirectory() || skipName(e.name)) continue;
      if (!SLUG_RE.test(e.name)) error(`Недопустимое имя папки карты «${e.name}»: только a-z, 0-9 и дефисы`, `${MAPS_DIR}/${e.name}`);
      else mapDirs.push(e.name);
    }
  } catch {
    /* карт нет */
  }
  mapDirs.sort();

  const mapConfigs = new Map<string, MapConfig>();
  for (const id of mapDirs) {
    const file = path.join(mapsDir, id, MAP_CONFIG_FILE);
    const text = await readText(file);
    if (text === null) {
      error(`Нет ${MAP_CONFIG_FILE} — карта пропущена`, rel(file));
      continue;
    }
    try {
      const parsed = MapConfigSchema.safeParse(JSON.parse(text));
      if (!parsed.success) error(`Некорректный ${MAP_CONFIG_FILE}: ${zodMessage(parsed.error)}`, rel(file));
      else if (mode === 'public' && parsed.data.visibility === 'dm') continue;
      else mapConfigs.set(id, parsed.data);
    } catch (e) {
      error(`Некорректный JSON: ${(e as Error).message}`, rel(file));
    }
  }

  // ─── world.json ──────────────────────────────────────────────────────────
  let title = 'Мир';
  let subtitle = '';
  let defaultMap = [...mapConfigs.keys()][0] ?? '';
  const worldText = await readText(path.join(root, WORLD_CONFIG_FILE));
  if (worldText === null) warn('Нет world/world.json — использованы значения по умолчанию', WORLD_CONFIG_FILE);
  else {
    try {
      const parsed = WorldConfigSchema.safeParse(JSON.parse(worldText));
      if (!parsed.success) error(`Некорректный world.json: ${zodMessage(parsed.error)}`, WORLD_CONFIG_FILE);
      else {
        title = parsed.data.title;
        subtitle = parsed.data.subtitle ?? '';
        if (mapConfigs.has(parsed.data.defaultMap)) defaultMap = parsed.data.defaultMap;
        else error(`defaultMap «${parsed.data.defaultMap}» — такой карты нет`, WORLD_CONFIG_FILE);
      }
    } catch (e) {
      error(`Некорректный JSON: ${(e as Error).message}`, WORLD_CONFIG_FILE);
    }
  }

  // ─── лор ─────────────────────────────────────────────────────────────────
  const files = (await listMarkdown(path.join(root, LORE_DIR))).sort((a, b) => rel(a).localeCompare(rel(b)));
  const records: LoreRecord[] = [];
  const allIds = new Map<string, LoreRecord>();
  for (const file of files) {
    const text = (await readText(file)) ?? '';
    let parsedMatter: matter.GrayMatterFile<string>;
    try {
      parsedMatter = matter(text);
    } catch (e) {
      error(`Ошибка YAML во фронтматтере: ${(e as Error).message}`, rel(file));
      continue;
    }
    const fm = LoreFrontmatterSchema.safeParse(parsedMatter.data);
    if (!fm.success) {
      error(`Фронтматтер: ${zodMessage(fm.error)}`, rel(file));
      continue;
    }
    const basename = path.basename(file, path.extname(file));
    const id = fm.data.id ?? slugify(basename);
    if (!id) {
      error('Не удалось получить id из имени файла — задайте id во фронтматтере', rel(file));
      continue;
    }
    const existing = allIds.get(id);
    if (existing) {
      error(`id «${id}» уже занят файлом ${rel(existing.file)}`, rel(file));
      continue;
    }
    const record: LoreRecord = { id, file, basename, fm: fm.data, body: parsedMatter.content, visibility: fm.data.visibility ?? 'public' };
    allIds.set(id, record);
    if (mode === 'public' && record.visibility === 'dm') continue;
    records.push(record);
  }

  // Поиск по id, имени файла, названию, алиасам.
  const byId = new Map(records.map((r) => [r.id, r]));
  const hiddenKeys = new Set<string>();
  const lookup = new Map<string, LoreRecord[]>();
  const addKey = (key: string, r: LoreRecord) => {
    const k = normalizeKey(key);
    if (!k) return;
    const list = lookup.get(k) ?? [];
    if (!list.includes(r)) list.push(r);
    lookup.set(k, list);
  };
  for (const r of records) {
    addKey(r.id, r);
    addKey(r.basename, r);
    if (r.fm.name) addKey(r.fm.name, r);
    for (const a of r.fm.aliases ?? []) addKey(a, r);
  }
  for (const r of allIds.values()) {
    if (byId.has(r.id)) continue;
    for (const key of [r.id, r.basename, r.fm.name ?? '', ...(r.fm.aliases ?? [])]) if (key) hiddenKeys.add(normalizeKey(key));
  }

  const stripLink = (ref: string) => {
    const m = /^\[\[([^\]]+)\]\]$/.exec(ref.trim());
    return m ? m[1]!.split('|')[0]!.split('#')[0]!.trim() : ref.trim();
  };
  const find = (ref: string, file: string): LoreRecord | 'hidden' | null => {
    const target = stripLink(ref);
    const direct = byId.get(target);
    if (direct) return direct;
    const list = lookup.get(normalizeKey(target));
    if (list?.length) {
      if (list.length > 1) warn(`Неоднозначная ссылка «${target}»: ${list.map((r) => r.id).join(', ')} — выбрана ${list[0]!.id}`, rel(file));
      return list[0]!;
    }
    return hiddenKeys.has(normalizeKey(target)) ? 'hidden' : null;
  };

  const entities: Record<string, Entity> = {};
  const outgoing = new Map<string, Set<string>>();
  for (const r of records) {
    const file = rel(r.file);
    // Картинки в тексте находим заранее: рендер Markdown синхронный.
    const mdDir = path.dirname(r.file);
    const bodyImages = new Map<string, string>();
    for (const ref of collectImageRefs(r.body)) {
      const key = imageRefPath(ref);
      if (bodyImages.has(key) || isExternalUrl(ref)) continue;
      const found = await media.resolve(ref, mdDir);
      if (found) bodyImages.set(key, (await media.register(found)).full);
    }
    const ctx: RenderContext = {
      mode,
      warn: (m) => warn(m, file),
      resolveImage: (ref) => (isExternalUrl(ref) ? ref.trim() : (bodyImages.get(imageRefPath(ref)) ?? null)),
      resolve: (target): LinkTarget => {
        const found = find(target, r.file);
        if (found === 'hidden' || found === null) return found;
        return { id: found.id, name: found.fm.name ?? found.basename };
      },
    };
    const rendered = renderMarkdown(r.body, ctx);
    const links = new Set(rendered.links);
    const facts: Entity['facts'] = [];
    for (const [label, value] of Object.entries(r.fm.facts ?? {})) {
      if (value === null || value === undefined) continue;
      const text =
        value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'boolean' ? (value ? 'да' : 'нет') : String(value);
      facts.push({ label, html: renderInline(text, ctx, links) });
    }
    links.delete(r.id);
    outgoing.set(r.id, links);

    let summary = r.fm.summary?.trim() ?? '';
    if (!summary) summary = rendered.firstParagraph.length > 240 ? `${rendered.firstParagraph.slice(0, 239).trimEnd()}…` : rendered.firstParagraph;

    const resolveImage = async (ref: string | null | undefined, what: string): Promise<EntityImage | null> => {
      if (!ref?.trim()) return null;
      if (isExternalUrl(ref)) return { thumb: ref.trim(), full: ref.trim() };
      const found = await media.resolve(ref, mdDir);
      if (found) return media.register(found);
      warn(`${what}: файл «${imageRefPath(ref)}» не найден (ищется рядом со статьёй, в world/ и в public/)`, file);
      return null;
    };
    const image = (await resolveImage(r.fm.image, 'Картинка'))?.full ?? null;
    const avatar = await resolveImage(r.fm.avatar, 'Аватар');

    let map = r.fm.map ?? null;
    if (map && !mapConfigs.has(map)) {
      if (!(mode === 'public' && mapDirs.includes(map))) warn(`Карта «${map}» не найдена (world/maps/${map})`, file);
      map = null;
    }

    entities[r.id] = {
      id: r.id,
      name: r.fm.name ?? r.basename,
      kind: r.fm.kind ?? 'note',
      summary,
      html: rendered.html,
      parent: null,
      map,
      color: r.fm.color ?? null,
      icon: r.fm.icon ?? null,
      image,
      avatar,
      location: null,
      residents: [],
      aliases: [...new Set(r.fm.aliases ?? [])],
      tags: [...new Set((r.fm.tags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean))],
      facts,
      visibility: r.visibility,
      children: [],
      backlinks: [],
      locations: [],
      source: dev ? file : null,
    };
  }

  // Родители: разрешение и разрыв циклов.
  for (const r of records) {
    if (!r.fm.parent) continue;
    const found = find(r.fm.parent, r.file);
    if (found === 'hidden') continue;
    if (!found) warn(`Родитель «${r.fm.parent}» не найден`, rel(r.file));
    else if (found.id === r.id) error('Сущность не может быть родителем самой себя', rel(r.file));
    else entities[r.id]!.parent = found.id;
  }
  for (const id of Object.keys(entities).sort()) {
    const seen = new Set<string>([id]);
    let cur = entities[id]!.parent;
    while (cur) {
      if (seen.has(cur)) {
        error(`Цикл в иерархии родителей через «${id}» — связь разорвана`, entities[id]!.source ?? null);
        entities[id]!.parent = null;
        break;
      }
      seen.add(cur);
      cur = entities[cur]?.parent ?? null;
    }
  }

  // Привязка к месту на карте (кружок с аватаром).
  for (const r of records) {
    if (!r.fm.location) continue;
    const found = find(r.fm.location, r.file);
    if (found === 'hidden') continue;
    if (!found) warn(`Место «${r.fm.location}» не найдено`, rel(r.file));
    else if (found.id === r.id) error('Сущность не может быть привязана сама к себе', rel(r.file));
    else entities[r.id]!.location = found.id;
  }

  const collator = new Intl.Collator('ru', { numeric: true });
  const byKindName = (a: string, b: string) =>
    KINDS[entities[a]!.kind].order - KINDS[entities[b]!.kind].order || collator.compare(entities[a]!.name, entities[b]!.name);
  for (const e of Object.values(entities)) if (e.parent) entities[e.parent]!.children.push(e.id);
  for (const e of Object.values(entities)) if (e.location) entities[e.location]!.residents.push(e.id);
  for (const [from, links] of outgoing) for (const to of links) if (entities[to]) entities[to].backlinks.push(from);
  for (const e of Object.values(entities)) {
    e.children.sort(byKindName);
    e.residents.sort((a, b) => collator.compare(entities[a]!.name, entities[b]!.name));
    e.backlinks = [...new Set(e.backlinks)].sort(byKindName);
  }

  // ─── карты и объекты ─────────────────────────────────────────────────────
  const maps: Record<string, MapDef> = {};
  for (const [id, config] of mapConfigs) {
    const dir = path.join(mapsDir, id);
    const configFile = rel(path.join(dir, MAP_CONFIG_FILE));

    let meta: z.infer<typeof TilesMetaSchema> | null = null;
    const metaText = await readText(path.join(root, GENERATED_MAPS_DIR, id, TILES_META_FILE));
    if (metaText !== null) {
      try {
        const parsed = TilesMetaSchema.safeParse(JSON.parse(metaText));
        if (parsed.success) meta = parsed.data;
      } catch {
        /* битый meta — как будто нет */
      }
    }
    const size = config.size ?? meta?.size;
    if (!size) {
      error('Не задан размер карты: запустите npm run maps', configFile);
      continue;
    }
    const [width, height] = size;
    const fresh = meta && meta.size[0] === width && meta.size[1] === height;
    if (config.source && !fresh) warn(`Тайлы карты «${id}» не сгенерированы или устарели — запустите npm run maps`, configFile);

    // Суша для обрезки областей по берегу.
    let land: ClipMultiPolygon | null = null;
    const landFile = path.join(dir, LAND_FILE);
    const landText = config.clipAreasToLand === false ? null : await readText(landFile);
    if (landText !== null) {
      try {
        const parsed = LandSchema.safeParse(JSON.parse(landText));
        if (!parsed.success) error(`Некорректный ${LAND_FILE}: ${zodMessage(parsed.error)}`, rel(landFile));
        else {
          const polys: ClipPolygon[] = [];
          for (const f of parsed.data.features) {
            if (f.geometry.type === 'Polygon') polys.push(f.geometry.coordinates as ClipPolygon);
            else polys.push(...(f.geometry.coordinates as ClipPolygon[]));
          }
          if (polys.length) land = polygonClipping.union(polys[0]!, ...polys.slice(1));
        }
      } catch (e) {
        error(`Некорректный JSON: ${(e as Error).message}`, rel(landFile));
      }
    }

    const featuresFile = path.join(dir, FEATURES_FILE);
    const features: MapFeature[] = [];
    const featuresText = await readText(featuresFile);
    let rawFeatures: unknown[] = [];
    if (featuresText !== null) {
      try {
        const json = JSON.parse(featuresText) as { type?: unknown; features?: unknown };
        if (json.type !== 'FeatureCollection' || !Array.isArray(json.features)) error('Ожидалась FeatureCollection', rel(featuresFile));
        else rawFeatures = json.features;
      } catch (e) {
        error(`Некорректный JSON: ${(e as Error).message}`, rel(featuresFile));
      }
    }
    const usedIds = new Set<string>();
    rawFeatures.forEach((raw, index) => {
      const ffile = rel(featuresFile);
      const parsed = FeatureSchema.safeParse(raw);
      if (!parsed.success) {
        error(`Объект №${index + 1}: ${zodMessage(parsed.error)}`, ffile);
        return;
      }
      const f = parsed.data;
      let fid = f.id === null || f.id === undefined || f.id === '' ? '' : String(f.id);
      if (!fid) {
        fid = `f-${index}`;
        warn(`Объект №${index + 1} без id — назначен «${fid}»`, ffile);
      }
      if (usedIds.has(fid)) {
        let n = 2;
        while (usedIds.has(`${fid}-${n}`)) n++;
        error(`Повторный id объекта «${fid}» — переименован в «${fid}-${n}»`, ffile);
        fid = `${fid}-${n}`;
      }
      usedIds.add(fid);
      const props = (f.properties ?? {}) as AuthoredFeatureProps;

      let entity: Entity | undefined;
      if (props.entity) {
        entity = entities[props.entity];
        if (!entity) {
          const found = find(props.entity, featuresFile);
          if (found === 'hidden') return;
          if (found) {
            entity = entities[found.id];
            warn(`Объект «${fid}»: ссылайтесь на сущность по id («${found.id}»), а не «${props.entity}»`, ffile);
          } else warn(`Объект «${fid}»: сущность «${props.entity}» не найдена`, ffile);
        }
      }
      const visibility = props.visibility ?? entity?.visibility ?? 'public';
      if (mode === 'public' && visibility === 'dm') return;

      const geometry = cleanGeometry(f.geometry as Geometry);
      const fallbackKind: Kind =
        geometry.type === 'Point' ? 'poi' : geometry.type === 'LineString' || geometry.type === 'MultiLineString' ? 'route' : 'region';
      const kind = props.kind ?? entity?.kind ?? fallbackKind;
      const name = props.name ?? entity?.name ?? '';
      if (!entity && !name) warn(`Объект «${fid}» без сущности и без подписи`, ffile);

      let outside = false;
      forEachPosition(geometry, ([x, y]) => {
        if (x! < -width * 0.02 || x! > width * 1.02 || y! < -height * 0.02 || y! > height * 1.02) outside = true;
      });
      if (outside) warn(`Объект «${fid}» выходит за пределы карты ${width}×${height}`, ffile);

      const polygonal = geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';
      let display: Geometry = geometry;
      if (polygonal && land && isAreaKind(kind)) {
        const coords = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as ClipMultiPolygon;
        const clipped = polygonClipping.intersection(coords, land);
        if (!clipped.length) warn(`Область «${fid}» целиком в море — обрезка по берегу пропущена`, ffile);
        else
          display = cleanGeometry(
            clipped.length === 1 ? { type: 'Polygon', coordinates: clipped[0]! } : { type: 'MultiPolygon', coordinates: clipped },
          );
      }

      let labelAt: [number, number] | null = null;
      if ((display.type === 'Polygon' || display.type === 'MultiPolygon') && props.labelAt) {
        labelAt = [round2(props.labelAt[0]), round2(props.labelAt[1])];
      } else if (display.type === 'Polygon' || display.type === 'MultiPolygon') {
        const polys = display.type === 'Polygon' ? [display.coordinates] : display.coordinates;
        const largest = polys.reduce((a, b) => (ringArea(b[0]!) > ringArea(a[0]!) ? b : a));
        const p = polylabel(largest as number[][][], Math.max(width, height) / 1000);
        labelAt = [round2(p[0]), round2(p[1])];
      }

      const color =
        props.color ?? entity?.color ?? (isAreaKind(kind) ? AREA_PALETTE[hash(entity?.id ?? fid) % AREA_PALETTE.length]! : null);
      features.push({
        id: fid,
        entity: entity?.id ?? null,
        kind,
        name,
        detail: props.detail ?? KINDS[kind].detail,
        color,
        geometry,
        display,
        labelAt,
        props,
      });
      if (entity) entity.locations.push({ map: id, feature: fid });
    });

    // Детальные врезки. Папка без inset.json — черновик; врезка без арта просто не видна.
    const mapNativeZoom = meta && fresh ? meta.maxNativeZoom : zoomBaseFor(width, height);
    const insets: MapInset[] = [];
    const insetsDir = path.join(dir, INSETS_DIR);
    const insetNames = await fs
      .readdir(insetsDir, { withFileTypes: true })
      .then((list) => list.filter((e) => e.isDirectory() && !skipName(e.name)).map((e) => e.name).sort())
      .catch(() => [] as string[]);
    for (const insetId of insetNames) {
      const configPath = path.join(insetsDir, insetId, INSET_CONFIG_FILE);
      const insetText = await readText(configPath);
      if (insetText === null) continue;
      const insetFile = rel(configPath);
      if (!SLUG_RE.test(insetId)) {
        error(`Недопустимое имя папки врезки «${insetId}»: только a-z, 0-9 и дефисы`, insetFile);
        continue;
      }
      let parsed: ReturnType<typeof InsetConfigSchema.safeParse>;
      try {
        parsed = InsetConfigSchema.safeParse(JSON.parse(insetText));
      } catch (e) {
        error(`Некорректный JSON: ${(e as Error).message}`, insetFile);
        continue;
      }
      if (!parsed.success) {
        error(`Некорректный ${INSET_CONFIG_FILE}: ${zodMessage(parsed.error)}`, insetFile);
        continue;
      }
      const cfg = parsed.data;
      const [bx, by, bw, bh] = cfg.bounds;
      if (bx < -width * 0.02 || by < -height * 0.02 || bx + bw > width * 1.02 || by + bh > height * 1.02) {
        warn(`Врезка «${insetId}» выходит за пределы карты ${width}×${height}`, insetFile);
      }
      let insetMeta: z.infer<typeof InsetMetaSchema> | null = null;
      const insetMetaText = await readText(path.join(root, GENERATED_INSETS_DIR, id, insetId, TILES_META_FILE));
      if (insetMetaText !== null) {
        try {
          const m = InsetMetaSchema.safeParse(JSON.parse(insetMetaText));
          if (m.success) insetMeta = m.data;
        } catch {
          /* битый meta — как будто нет */
        }
      }
      // Тайлы нарезаны под конкретные bounds: сдвинули врезку — нужна перенарезка, иначе арт встанет криво.
      const insetFresh =
        insetMeta !== null &&
        insetMeta.bounds.every((v, i) => Math.abs(v - cfg.bounds[i]!) < 1e-6) &&
        insetMeta.feather === (cfg.feather ?? INSET_DEFAULT_FEATHER);
      if (insetMeta && !insetFresh) warn(`Врезка «${insetId}» изменилась — тайлы устарели, запустите npm run maps`, insetFile);
      insets.push({
        id: insetId,
        title: cfg.title ?? insetId,
        bounds: [bx, by, bw, bh],
        showFrom: cfg.showFrom ?? defaultInsetShowFrom(mapNativeZoom),
        tiles:
          insetMeta && insetFresh
            ? { url: insetMeta.tiles, tileSize: insetMeta.tileSize, minNativeZoom: insetMeta.minZoom, maxNativeZoom: insetMeta.maxNativeZoom }
            : null,
        version: insetMeta && insetFresh ? insetMeta.sourceHash.slice(0, 12) : null,
      });
    }
    // Крупные снизу, мелкие поверх: мелкая врезка обычно детальнее.
    insets.sort((a, b) => b.bounds[2] * b.bounds[3] - a.bounds[2] * a.bounds[3] || a.id.localeCompare(b.id));

    maps[id] = {
      id,
      title: config.title,
      width,
      height,
      zoomBase: zoomBaseFor(width, height),
      background: config.background ?? '#0b1220',
      base:
        meta && fresh
          ? {
              preview: meta.preview,
              tiles: { url: meta.tiles, tileSize: meta.tileSize, maxNativeZoom: meta.maxNativeZoom },
              version: meta.sourceHash.slice(0, 12),
            }
          : null,
      entity: null,
      parent: null,
      visibility: config.visibility ?? 'public',
      features,
      pins: [],
      insets,
      source: dev ? rel(featuresFile) : null,
    };
  }

  // Связи карт: какую сущность изображает и чья она дочка.
  for (const [id, config] of mapConfigs) {
    const map = maps[id];
    if (!map) continue;
    const configFile = `${MAPS_DIR}/${id}/${MAP_CONFIG_FILE}`;
    if (config.entity) {
      const found = find(config.entity, path.join(root, configFile));
      if (found && found !== 'hidden') map.entity = found.id;
      else if (!found) warn(`entity «${config.entity}» не найдена`, configFile);
    } else {
      map.entity = Object.values(entities).find((e) => e.map === id)?.id ?? null;
    }
    if (config.parent) {
      if (maps[config.parent]) map.parent = config.parent;
      else warn(`Родительская карта «${config.parent}» не найдена`, configFile);
    } else if (map.entity) {
      map.parent = entities[map.entity]!.locations.find((l) => l.map !== id)?.map ?? null;
    }
  }
  for (const id of Object.keys(maps)) {
    const seen = new Set([id]);
    let cur = maps[id]!.parent;
    while (cur) {
      if (seen.has(cur)) {
        error(`Цикл в родителях карт через «${id}» — связь разорвана`, `${MAPS_DIR}/${id}/${MAP_CONFIG_FILE}`);
        maps[id]!.parent = null;
        break;
      }
      seen.add(cur);
      cur = maps[cur]?.parent ?? null;
    }
  }

  // Кружки сущностей с location: у объекта места на карте, а если места на ней нет — у ближайшего предка.
  const pinned = Object.values(entities)
    .filter((e) => e.location)
    .sort((a, b) => collator.compare(a.name, b.name));
  for (const map of Object.values(maps)) {
    const featureOf = new Map<string, MapFeature>();
    for (const f of map.features) if (f.entity && !featureOf.has(f.entity)) featureOf.set(f.entity, f);
    for (const e of pinned) {
      if (featureOf.has(e.id)) continue; // сущность нарисована на этой карте сама
      const seen = new Set<string>();
      for (let cur: string | null = e.location; cur && !seen.has(cur); cur = entities[cur]?.parent ?? null) {
        seen.add(cur);
        const f = featureOf.get(cur);
        if (!f) continue;
        const at = anchorPoint(f);
        if (!at) break;
        const pin: MapPin = {
          id: `pin-${e.id}`,
          entity: e.id,
          anchor: cur,
          feature: f.id,
          at,
          detail: f.detail,
          placement: f.display.type === 'Point' ? 'above' : 'below',
        };
        map.pins.push(pin);
        e.locations.push({ map: map.id, feature: pin.id });
        break;
      }
    }
  }

  const ordered = (list: Issue[], level: Issue['level']) =>
    list.filter((i) => i.level === level).sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || a.message.localeCompare(b.message));
  const sortedEntities = Object.fromEntries(Object.keys(entities).sort().map((k) => [k, entities[k]!]));

  return {
    mode,
    title,
    subtitle,
    defaultMap,
    maps,
    entities: sortedEntities,
    issues: [...ordered(issues, 'error'), ...ordered(issues, 'warning')],
  };
}
