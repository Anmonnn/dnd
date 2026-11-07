/**
 * Точечная правка одного поля верхнего уровня во фронтматтере .md — без пересборки всего YAML,
 * чтобы не потерять комментарии, порядок и оформление, которые написал автор.
 */
import { yamlString } from './stub.ts';

const FENCE_RE = /^---\s*$/;
const CLOSE_RE = /^(---|\.\.\.)\s*$/;

/**
 * Поставить поле key = value (строка в кавычках) или убрать его (value = null).
 * Многострочные значения (списки, вложенные объекты) удаляются целиком.
 */
export function setFrontmatterField(text: string, key: string, value: string | null): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const lines = text.slice(bom.length).split(/\r?\n/);
  const line = value === null ? null : `${key}: ${yamlString(value)}`;

  if (!FENCE_RE.test(lines[0] ?? '')) {
    if (line === null) return text;
    return `${bom}---${eol}${line}${eol}---${eol}${lines.join(eol)}`;
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (CLOSE_RE.test(lines[i]!)) {
      close = i;
      break;
    }
  }
  if (close < 0) throw new Error('Фронтматтер не закрыт строкой ---');

  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
  const start = lines.findIndex((l, i) => i > 0 && i < close && keyRe.test(l));
  if (start < 0) {
    if (line !== null) lines.splice(close, 0, line);
  } else {
    // Продолжение значения: строки с отступом и элементы списка «- …» на нулевом отступе.
    let end = start + 1;
    while (end < close && (/^[ \t]/.test(lines[end]!) || /^-(\s|$)/.test(lines[end]!) || lines[end]!.trim() === '')) end++;
    while (end > start + 1 && lines[end - 1]!.trim() === '') end--;
    lines.splice(start, end - start, ...(line === null ? [] : [line]));
  }
  return bom + lines.join(eol);
}
