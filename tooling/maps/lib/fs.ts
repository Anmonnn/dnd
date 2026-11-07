/** Файловые утилиты сборщика карт: JSON, атомарная запись, публикация папки, хеш. */
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

const NUM = String.raw`-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`;
/** Многострочный массив чисел от JSON.stringify: внутри JSON-строк перевода строки быть не может. */
const MULTILINE_NUMBER_ARRAY = new RegExp(String.raw`\[\n\s*(${NUM}(?:,\n\s*${NUM})*)\n\s*\]`, 'g');

/** JSON с отступом 2 и переводом строки в конце; короткие числовые массивы — в одну строку: [1461, 1077]. */
export function formatJson(value: unknown): string {
  return (
    JSON.stringify(value, null, 2).replace(MULTILINE_NUMBER_ARRAY, (_, body: string) => `[${body.split(/,\s*/).join(', ')}]`) +
    '\n'
  );
}

/** Ошибки Windows, которые обычно временные: файл открыт антивирусом, папку держит наблюдатель. */
export function isBusyError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOTEMPTY' || code === 'EEXIST';
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** rename с повторами при временных ошибках (attempts попыток, пауза растёт: 25, 50, 100… мс). */
export async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      if (i >= attempts || !isBusyError(error)) throw error;
      await delay(25 * 2 ** (i - 1));
    }
  }
}

export async function removePath(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

/**
 * Атомарная запись файла: во временный файл рядом, затем rename поверх.
 * Наблюдатель (dev-сервер) никогда не увидит наполовину записанный файл.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(temp, data);
  try {
    await renameWithRetry(temp, file);
  } catch (error) {
    // Файл держит другой процесс без права удаления — пишем напрямую.
    await fs.rm(temp, { force: true });
    if (!isBusyError(error)) throw error;
    await fs.writeFile(file, data);
  }
}

/** Все файлы папки рекурсивно: относительные пути с «/». */
export async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => toPosix(path.relative(dir, path.join(e.parentPath, e.name))))
    .sort();
}

/** Удаляет пустые подпапки (снизу вверх). Сама папка dir остаётся. */
async function removeEmptyDirs(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(dir, e.name);
    await removeEmptyDirs(sub);
    if ((await fs.readdir(sub)).length === 0) await fs.rmdir(sub).catch(() => {});
  }
}

export type PublishMode = 'renamed' | 'merged';

/**
 * Заменяет finalDir содержимым готовой папки tempDir (лежит рядом, тот же диск).
 *
 * Обычно — двумя rename (старая папка уходит в сторону, новая встаёт на её место).
 * На Windows папку, за которой следит dev-сервер или в которой открыт файл, переименовать
 * нельзя (EPERM) — тогда файлы переносятся по одному (каждый rename атомарен), `lastFile`
 * (meta.json) — последним, после него удаляются устаревшие файлы. В любой момент meta.json
 * ссылается только на существующие файлы.
 */
export async function publishDir(tempDir: string, finalDir: string, lastFile: string): Promise<PublishMode> {
  const oldDir = `${tempDir}-old`;
  if (!(await pathExists(finalDir))) {
    try {
      await renameWithRetry(tempDir, finalDir);
      return 'renamed';
    } catch (error) {
      if (!isBusyError(error)) throw error;
    }
  } else {
    let movedAway = false;
    try {
      await renameWithRetry(finalDir, oldDir, 3);
      movedAway = true;
    } catch (error) {
      if (!isBusyError(error)) throw error;
    }
    if (movedAway) {
      try {
        await renameWithRetry(tempDir, finalDir);
        await removePath(oldDir);
        return 'renamed';
      } catch (error) {
        // Вернуть старую версию на место; если и это не вышло — слияние создаст папку заново.
        await renameWithRetry(oldDir, finalDir).catch(() => {});
        if (!isBusyError(error)) throw error;
      }
    }
  }
  await mergeDir(tempDir, finalDir, lastFile);
  await removePath(oldDir);
  return 'merged';
}

async function mergeDir(tempDir: string, finalDir: string, lastFile: string): Promise<void> {
  const files = await listFiles(tempDir);
  const fresh = new Set(files);
  await fs.mkdir(finalDir, { recursive: true });
  const move = async (rel: string) => {
    const target = path.join(finalDir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await renameWithRetry(path.join(tempDir, rel), target);
  };
  for (const rel of files) if (rel !== lastFile) await move(rel);
  if (fresh.has(lastFile)) await move(lastFile);
  for (const rel of await listFiles(finalDir)) {
    if (!fresh.has(rel)) await removePath(path.join(finalDir, rel));
  }
  await removeEmptyDirs(finalDir);
  await removePath(tempDir);
}

/** sha256 содержимого файла и строки параметров (hex). */
export async function hashFile(file: string, extra: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  hash.update('\0');
  hash.update(extra);
  return hash.digest('hex');
}

/** Жив ли процесс (для уборки временных папок, брошенных упавшим запуском). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
