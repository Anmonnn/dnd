/** Вывод в консоль: короткие русские сообщения, длительности, склонения. */

export type Log = (line: string) => void;

export const silentLog: Log = () => {};

/** 850 мс, 1,3 с, 2 мин 05 с. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} мс`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)} мин ${String(totalSec % 60).padStart(2, '0')} с`;
}

/** plural(5, ['тайл', 'тайла', 'тайлов']) → 'тайлов'. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/** 1234567 → «1 234 567» (обычные пробелы — читаются в любой консоли). */
export function formatInt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatSize([w, h]: readonly [number, number]): string {
  return `${formatInt(w)}×${formatInt(h)}`;
}

/** Секундомер: elapsed() — сколько прошло с создания. */
export function stopwatch(): { elapsed: () => number } {
  const start = performance.now();
  return { elapsed: () => performance.now() - start };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
