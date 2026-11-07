/** Текстовый отчёт о проблемах в данных (консоль, сборка). */
import type { Issue } from '../../src/shared/types.ts';

const color = (code: number, text: string) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);

export function formatIssues(issues: Issue[]): string {
  const byFile = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = issue.file ?? '(общее)';
    byFile.set(key, [...(byFile.get(key) ?? []), issue]);
  }
  const lines: string[] = [];
  for (const [file, list] of byFile) {
    lines.push(color(1, file));
    for (const i of list) lines.push(`  ${i.level === 'error' ? color(31, 'ошибка') : color(33, 'предупр.')} ${i.message}`);
  }
  return lines.join('\n');
}
