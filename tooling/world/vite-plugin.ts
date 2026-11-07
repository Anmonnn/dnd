/**
 * Vite-плагин мира: виртуальный модуль `virtual:world` (скомпилированная папка world/),
 * уменьшенные копии картинок, перекомпиляция и HMR при правках, dev-API редактора (контракт — src/shared/api.ts).
 */
import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import matter from 'gray-matter';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { AVATAR_MAX_BYTES, AVATAR_TYPES, DEV_API_PREFIX } from '../../src/shared/api.ts';
import { KINDS } from '../../src/shared/kinds.ts';
import { FEATURES_FILE, GENERATED_INSETS_DIR, GENERATED_MAPS_URL, GENERATED_MEDIA_URL, LORE_DIR, MAPS_DIR, SLUG_RE, WORLD_AVATARS_DIR, WORLD_DIR } from '../../src/shared/paths.ts';
import {
  CreateEntityRequestSchema,
  FeatureCollectionSchema,
  LoreFrontmatterSchema,
  UpdateEntityRequestSchema,
} from '../../src/shared/schemas.ts';
import { uniqueSlug } from '../../src/shared/slug.ts';
import type { WorldData, WorldMode } from '../../src/shared/types.ts';
import { buildMaps } from '../maps/build.ts';
import { compileWorld } from './compile.ts';
import { formatFeatureCollection } from './format.ts';
import { setFrontmatterField } from './frontmatter-edit.ts';
import { generateMedia, MediaLibrary, mediaFileNames, pruneMedia } from './media.ts';
import { formatIssues } from './report.ts';
import { entityStub } from './stub.ts';

const VIRTUAL_ID = 'virtual:world';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const MAX_JSON_BODY = 5 * 1024 * 1024;
/** Арт карты или врезки: world/maps/<mapId>/source.* и world/maps/<mapId>/insets/<id>/source.* (группа 1 — mapId). */
export const ART_FILE_RE = /[\\/]maps[\\/]([^\\/]+)[\\/](?:insets[\\/][^\\/]+[\\/])?source\.[a-z]+$/i;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, `Слишком большое тело запроса (больше ${Math.round(limit / 1024 / 1024)} МБ)`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Нужен Content-Type: application/json');
  const body = await readBody(req, MAX_JSON_BODY);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Некорректный JSON');
  }
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, data);
  await fs.rename(temp, file);
}

/** Тип картинки по первым байтам — расширению из Content-Type не доверяем вслепую. */
function sniffImage(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  return null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function worldPlugin(options: { root?: string } = {}): Plugin {
  let root = options.root ?? process.cwd();
  let mode: WorldMode = 'dm';
  let dev = false;
  let outDir = '';
  let data: WorldData | null = null;
  let json = '';
  let server: ViteDevServer | null = null;
  let media: MediaLibrary | null = null;

  const log = (message: string) => server?.config.logger.info(`\x1b[36m[world]\x1b[0m ${message}`, { timestamp: true });

  const compile = async (): Promise<boolean> => {
    media ??= new MediaLibrary(root);
    const next = await compileWorld({ root, mode, dev, media });
    // Копии картинок должны лежать на диске до того, как браузер получит новые данные.
    const result = await generateMedia(root, media.pending());
    if (result.generated) log(`картинки: создано копий ${result.generated}`);
    for (const message of result.errors) next.issues.push({ level: 'error', message: `Не удалось обработать картинку ${message}`, file: null });
    const nextJson = JSON.stringify(next);
    const changed = nextJson !== json;
    data = next;
    json = nextJson;
    return changed;
  };

  const summary = () => {
    if (!data) return '';
    const errors = data.issues.filter((i) => i.level === 'error').length;
    return `мир: ${Object.keys(data.entities).length} статей, ${Object.keys(data.maps).length} карт, ошибок ${errors}, предупреждений ${data.issues.length - errors}`;
  };

  const pushUpdate = async () => {
    if (!server) return;
    const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
    if (mod) await server.reloadModule(mod);
  };

  const recompileAndPush = async () => {
    try {
      if (await compile()) {
        log(summary());
        await pushUpdate();
      }
    } catch (e) {
      server?.config.logger.error(`[world] ошибка компиляции: ${(e as Error).stack ?? e}`);
    }
  };

  /** Файл статьи по id (в dev данные мастера содержат пути к исходникам). */
  const entityFile = (id: string): string => {
    const source = data?.entities[id]?.source;
    if (!source) throw new HttpError(404, `Статья «${id}» не найдена`);
    return path.join(root, source);
  };

  /** Правка полей фронтматтера с проверкой, что статья осталась валидной. */
  const updateFrontmatter = async (file: string, fields: Record<string, string | null>): Promise<void> => {
    let text = await fs.readFile(file, 'utf8');
    for (const [key, value] of Object.entries(fields)) text = setFrontmatterField(text, key, value);
    const check = LoreFrontmatterSchema.safeParse(matter(text).data);
    if (!check.success) throw new HttpError(400, `После правки фронтматтер некорректен: ${check.error.issues[0]?.message ?? ''}`);
    await writeAtomic(file, text);
  };

  async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (mode !== 'dm') throw new HttpError(403, 'Редактор работает только в режиме мастера (npm run dev)');
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Запрос с чужого сайта отклонён');
    const url = new URL(req.url ?? '', 'http://localhost');
    const route = url.pathname.slice(DEV_API_PREFIX.length);

    const featuresMatch = /^\/maps\/([^/]+)\/features$/.exec(route);
    if (featuresMatch && req.method === 'PUT') {
      const mapId = decodeURIComponent(featuresMatch[1]!);
      const dir = path.join(root, MAPS_DIR, mapId);
      if (!SLUG_RE.test(mapId) || !(await fs.stat(dir).catch(() => null))?.isDirectory()) throw new HttpError(404, `Карта «${mapId}» не найдена`);
      const parsed = FeatureCollectionSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) throw new HttpError(400, `Некорректная FeatureCollection: ${parsed.error.issues[0]?.message ?? ''}`);
      const ids = new Set<string>();
      for (const f of parsed.data.features) {
        const id = typeof f.id === 'string' ? f.id.trim() : '';
        if (!id || ids.has(id)) throw new HttpError(400, `У каждого объекта должен быть уникальный строковый id (проблема: «${String(f.id)}»)`);
        ids.add(id);
      }
      await writeAtomic(path.join(dir, FEATURES_FILE), formatFeatureCollection(parsed.data));
      log(`сохранено ${parsed.data.features.length} объектов → ${MAPS_DIR}/${mapId}/${FEATURES_FILE}`);
      await recompileAndPush();
      return send(res, 200, { ok: true, count: parsed.data.features.length, file: `${MAPS_DIR}/${mapId}/${FEATURES_FILE}` });
    }

    if (route === '/lore' && req.method === 'POST') {
      const parsed = CreateEntityRequestSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) throw new HttpError(400, `Некорректный запрос: ${parsed.error.issues[0]?.message ?? ''}`);
      const body = parsed.data;
      // Занятые id — включая скрытые от игроков.
      const full = await compileWorld({ root, mode: 'dm', dev: false });
      const taken = (id: string) => Boolean(full.entities[id]);
      if (body.id && taken(body.id)) throw new HttpError(409, `id «${body.id}» уже занят`);
      if (body.location && !full.entities[body.location]) throw new HttpError(400, `Место «${body.location}» не найдено`);
      const id = body.id ?? uniqueSlug(body.name, taken, 'statya');
      const relFile = `${LORE_DIR}/${KINDS[body.kind].folder}/${id}.md`;
      const file = path.join(root, relFile);
      if (await fs.stat(file).catch(() => null)) throw new HttpError(409, `Файл ${relFile} уже существует`);
      await writeAtomic(file, entityStub(body));
      log(`создана статья ${relFile}`);
      await recompileAndPush();
      return send(res, 201, { ok: true, id, file: relFile });
    }

    const loreMatch = /^\/lore\/([^/]+)(\/avatar)?$/.exec(route);
    if (loreMatch) {
      const id = decodeURIComponent(loreMatch[1]!);
      if (!SLUG_RE.test(id)) throw new HttpError(404, `Статья «${id}» не найдена`);
      const file = entityFile(id);
      const relFile = path.relative(root, file).split(path.sep).join('/');

      if (!loreMatch[2] && req.method === 'PATCH') {
        const parsed = UpdateEntityRequestSchema.safeParse(await readJsonBody(req));
        if (!parsed.success) throw new HttpError(400, `Некорректный запрос: ${parsed.error.issues[0]?.message ?? ''}`);
        const fields: Record<string, string | null> = {};
        if (parsed.data.location !== undefined) {
          const location = parsed.data.location;
          if (location === id) throw new HttpError(400, 'Нельзя привязать статью саму к себе');
          if (location !== null && !data?.entities[location]) throw new HttpError(400, `Место «${location}» не найдено`);
          fields.location = location;
        }
        if (parsed.data.avatar !== undefined) fields.avatar = parsed.data.avatar;
        await updateFrontmatter(file, fields);
        log(`обновлена статья ${relFile}: ${Object.keys(fields).join(', ')}`);
        await recompileAndPush();
        return send(res, 200, { ok: true, id, file: relFile });
      }

      if (loreMatch[2] && req.method === 'POST') {
        const declared = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        if (!AVATAR_TYPES[declared]) throw new HttpError(415, 'Нужна картинка PNG, JPEG, WebP или GIF');
        const bytes = await readBody(req, AVATAR_MAX_BYTES);
        const actual = sniffImage(bytes);
        if (!actual) throw new HttpError(415, 'Файл не похож на картинку PNG, JPEG, WebP или GIF');
        const ext = AVATAR_TYPES[actual]!;
        const dir = path.join(root, WORLD_AVATARS_DIR);
        // Старый аватар с другим расширением не нужен.
        for (const old of Object.values(AVATAR_TYPES)) if (old !== ext) await fs.rm(path.join(dir, `${id}.${old}`), { force: true });
        await writeAtomic(path.join(dir, `${id}.${ext}`), bytes);
        const avatar = path.relative(path.join(root, WORLD_DIR), path.join(dir, `${id}.${ext}`)).split(path.sep).join('/');
        await updateFrontmatter(file, { avatar });
        log(`аватар ${WORLD_AVATARS_DIR}/${id}.${ext} → ${relFile}`);
        await recompileAndPush();
        return send(res, 200, { ok: true, id, avatar });
      }
    }

    throw new HttpError(404, 'Неизвестный метод API');
  }

  return {
    name: 'dnd-world',
    configResolved(config: ResolvedConfig) {
      root = options.root ?? config.root;
      dev = config.command === 'serve';
      mode = dev ? (config.mode === 'public' ? 'public' : 'dm') : config.mode === 'dm' ? 'dm' : 'public';
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async buildStart() {
      await compile();
      if (dev || !data) return;
      const errors = data.issues.filter((i) => i.level === 'error');
      if (errors.length) this.error(`Ошибки в данных мира:\n${formatIssues(errors)}`);
      const warnings = data.issues.filter((i) => i.level === 'warning');
      if (warnings.length) this.warn(`Предупреждения в данных мира:\n${formatIssues(warnings)}`);
      data = { ...data, issues: [] };
      json = JSON.stringify(data);
    },
    async closeBundle() {
      // В сборку попадает весь public/: убираем копии картинок и тайлы, которых нет в данных этой сборки
      // (например, портреты и карты «только для мастера» в версии для игроков).
      if (dev || !data || !media || !outDir) return;
      await pruneMedia(path.join(outDir, GENERATED_MEDIA_URL), mediaFileNames(media.pending()));
      const mapsOut = path.join(outDir, GENERATED_MAPS_URL);
      for (const name of await fs.readdir(mapsOut).catch(() => [] as string[])) {
        if (!data.maps[name]) await fs.rm(path.join(mapsOut, name), { recursive: true, force: true });
      }
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return undefined;
      if (!data) await compile();
      return `export default JSON.parse(${JSON.stringify(json)});`;
    },
    async configureServer(devServer) {
      server = devServer;
      await compile();
      devServer.config.logger.info(`\x1b[36m[world]\x1b[0m ${summary()} (режим ${mode})`);

      const worldDir = path.join(root, WORLD_DIR);
      const generatedDir = path.join(root, 'public', 'generated', 'maps');
      const generatedInsetsDir = path.join(root, GENERATED_INSETS_DIR);
      devServer.watcher.add([worldDir, generatedDir, generatedInsetsDir]);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const relevant = (file: string) => {
        const p = path.resolve(file);
        if (p.startsWith(generatedDir) || p.startsWith(generatedInsetsDir)) return path.basename(p) === 'meta.json';
        return p.startsWith(worldDir) && !ART_FILE_RE.test(p) && !p.endsWith('.tmp');
      };

      // Новый арт карты или врезки — перенарезка этой карты прямо в dev; её meta.json потом
      // перекомпилирует мир через наблюдатель выше. Сборки идут по очереди, повторы схлопываются.
      const pendingMaps = new Set<string>();
      let building: Promise<void> = Promise.resolve();
      let buildTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleMapBuild = (mapId: string) => {
        pendingMaps.add(mapId);
        if (buildTimer) clearTimeout(buildTimer);
        buildTimer = setTimeout(() => {
          const ids = [...pendingMaps];
          pendingMaps.clear();
          building = building.then(async () => {
            log(`арт изменился — нарезка: ${ids.join(', ')}`);
            const report = await buildMaps({ root, ids, log: (line) => log(line.trim()) }).catch((e: unknown) => {
              devServer.config.logger.error(`[world] нарезка: ${(e as Error).message}`);
              return null;
            });
            if (report && !report.ok) for (const message of report.errors) devServer.config.logger.error(`[world] ${message}`);
          });
        }, 400);
      };

      devServer.watcher.on('all', (_event, file) => {
        const art = ART_FILE_RE.exec(path.resolve(file));
        if (art || /[\\/]insets[\\/][^\\/]+[\\/]inset\.json$/i.test(file)) {
          const mapId = art?.[1] ?? /[\\/]maps[\\/]([^\\/]+)[\\/]insets[\\/]/i.exec(file)?.[1];
          if (mapId && mode === 'dm') scheduleMapBuild(mapId);
        }
        if (!relevant(file)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void recompileAndPush(), 150);
      });

      devServer.middlewares.use(DEV_API_PREFIX, (req, res) => {
        req.url = `${DEV_API_PREFIX}${req.url ?? ''}`;
        handleApi(req, res).catch((e: unknown) => {
          const status = e instanceof HttpError ? e.status : 500;
          if (status === 500) devServer.config.logger.error(`[world] ${(e as Error).stack ?? e}`);
          send(res, status, { error: (e as Error).message });
        });
      });
    },
  };
}
