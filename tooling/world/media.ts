/**
 * Картинки мира (аватары, иллюстрации, картинки в тексте): поиск файла и уменьшенные копии.
 *
 * Компилятор только находит файл и считает хеш содержимого — URL копий известен сразу
 * (generated/media/<хеш>-<вариант>.webp). Сами копии делает generateMedia (sharp) — его зовёт
 * Vite-плагин после компиляции. Имя по хешу: заменили картинку — сменился URL, кеш браузера не мешает.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { GENERATED_MEDIA_DIR, GENERATED_MEDIA_URL, WORLD_DIR } from '../../src/shared/paths.ts';
import type { EntityImage } from '../../src/shared/types.ts';

export const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
/** Меняется при смене параметров копий — все URL станут новыми. */
const MEDIA_VERSION = 1;

/** s — квадрат 128 px (кружок на карте), m — до 800 px по большей стороне (панель). */
export const MEDIA_VARIANTS = ['s', 'm'] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

export interface MediaJob {
  /** Абсолютный путь к исходнику. */
  source: string;
  hash: string;
}

export function mediaFileName(hash: string, variant: MediaVariant): string {
  return `${hash}-${variant}.webp`;
}

const toPosix = (p: string) => p.split(path.sep).join('/');
const isInside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Ссылка на картинку как её пишут в статье: "[[файл.png|200]]", "файл.png", "папка/файл%20с%20пробелом.png". */
export function imageRefPath(ref: string): string {
  let value = ref.trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '');
  value = value.split('|')[0]!.split('#')[0]!.trim().replace(/^\/+/, '');
  try {
    value = decodeURIComponent(value);
  } catch {
    /* оставляем как есть */
  }
  return value;
}

export function isExternalUrl(ref: string): boolean {
  return /^(https?:)?\/\//i.test(ref.trim()) || /^data:image\//i.test(ref.trim());
}

/**
 * Библиотека картинок: живёт всё время работы dev-сервера, чтобы не пересчитывать хеши
 * неизменных файлов при каждой перекомпиляции (кеш по mtime и размеру).
 */
export class MediaLibrary {
  private readonly hashes = new Map<string, { mtimeMs: number; size: number; hash: string }>();
  private readonly jobs = new Map<string, MediaJob>();
  private index: Map<string, string[]> | null = null;

  constructor(readonly root: string) {}

  /** Начало компиляции: индекс файлов и список заданий строятся заново. */
  begin(): void {
    this.index = null;
    this.jobs.clear();
  }

  /** Задания на копии для всех картинок, найденных в последней компиляции. */
  pending(): MediaJob[] {
    return [...this.jobs.values()];
  }

  /**
   * Найти файл: относительно папки статьи → от world/ → от public/ → по имени файла во всём world/
   * (как ссылки на вложения в Obsidian). null — не найден.
   */
  async resolve(ref: string, fromDir: string): Promise<string | null> {
    const rel = imageRefPath(ref);
    if (!rel || !IMAGE_EXT_RE.test(rel)) return null;
    const candidates = [path.resolve(fromDir, rel), path.resolve(this.root, WORLD_DIR, rel), path.resolve(this.root, 'public', rel)];
    for (const file of candidates) {
      if (isInside(this.root, file) && (await isFile(file))) return file;
    }
    const byName = (await this.buildIndex()).get(path.basename(rel).toLowerCase());
    return byName?.[0] ?? null;
  }

  /** URL копий картинки; регистрирует задание на их создание. */
  async register(file: string): Promise<EntityImage> {
    const hash = await this.hashOf(file);
    this.jobs.set(hash, { source: file, hash });
    return {
      thumb: `${GENERATED_MEDIA_URL}/${mediaFileName(hash, 's')}`,
      full: `${GENERATED_MEDIA_URL}/${mediaFileName(hash, 'm')}`,
    };
  }

  /** Путь файла относительно корня проекта (для сообщений). */
  relative(file: string): string {
    return toPosix(path.relative(this.root, file));
  }

  private async hashOf(file: string): Promise<string> {
    const stat = await fs.stat(file);
    const cached = this.hashes.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.hash;
    const bytes = await fs.readFile(file);
    const hash = createHash('sha1').update(`media-v${MEDIA_VERSION}\0`).update(bytes).digest('hex').slice(0, 16);
    this.hashes.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
    return hash;
  }

  private async buildIndex(): Promise<Map<string, string[]>> {
    if (this.index) return this.index;
    const index = new Map<string, string[]>();
    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (IMAGE_EXT_RE.test(e.name)) {
          const key = e.name.toLowerCase();
          index.set(key, [...(index.get(key) ?? []), full]);
        }
      }
    };
    await walk(path.join(this.root, WORLD_DIR));
    this.index = index;
    return index;
  }
}

/** Делает недостающие копии. Возвращает число созданных файлов и ошибки (битые картинки и т. п.). */
export async function generateMedia(root: string, jobs: MediaJob[]): Promise<{ generated: number; errors: string[] }> {
  // Кеш libvips держит файлы открытыми: на Windows исходник аватара нельзя было бы заменить, пока идёт dev-сервер.
  sharp.cache(false);
  const outDir = path.join(root, GENERATED_MEDIA_DIR);
  await fs.mkdir(outDir, { recursive: true });
  let generated = 0;
  const errors: string[] = [];
  for (const job of jobs) {
    for (const variant of MEDIA_VARIANTS) {
      const target = path.join(outDir, mediaFileName(job.hash, variant));
      if (await isFile(target)) continue;
      try {
        const input = sharp(job.source, { density: /\.svg$/i.test(job.source) ? 300 : undefined, animated: false }).rotate();
        const image =
          variant === 's'
            ? input.resize(128, 128, { fit: 'cover', position: sharp.strategy.attention })
            : input.resize(800, 800, { fit: 'inside', withoutEnlargement: true });
        const temp = `${target}.${process.pid}.tmp`;
        await image.webp({ quality: variant === 's' ? 82 : 85 }).toFile(temp);
        await fs.rename(temp, target);
        generated++;
      } catch (error) {
        errors.push(`${toPosix(path.relative(root, job.source))}: ${(error as Error).message}`);
        break;
      }
    }
  }
  return { generated, errors };
}

/** Удаляет из dir файлы копий, которых нет в keep (имена файлов). Возвращает число удалённых. */
export async function pruneMedia(dir: string, keep: ReadonlySet<string>): Promise<number> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (keep.has(name) || !/^[0-9a-f]{16}-[a-z]\.webp$/.test(name)) continue;
    await fs.rm(path.join(dir, name), { force: true });
    removed++;
  }
  return removed;
}

/** Имена файлов копий для заданий (для pruneMedia). */
export function mediaFileNames(jobs: MediaJob[]): Set<string> {
  return new Set(jobs.flatMap((j) => MEDIA_VARIANTS.map((v) => mediaFileName(j.hash, v))));
}
