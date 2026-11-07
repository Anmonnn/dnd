/** Цвета редактируемых объектов (свои для редактора: просмотрщик рисует объекты по-своему). */
import type { Kind } from '../../shared/kinds';

/** Акцент темы — цвет «черновых» объектов, которые ещё не подтверждены в диалоге. */
export const ACCENT_COLOR = '#e3b55a';
/** Объект ссылается на несуществующую статью. */
export const BROKEN_COLOR = '#e0625a';

export const KIND_COLORS: Record<Kind, string> = {
  state: '#e3b55a',
  region: '#7fb0d9',
  district: '#b294d6',
  water: '#5fa8d3',
  capital: '#f2c14e',
  city: '#eadfc8',
  town: '#cdbf9f',
  village: '#9cc77a',
  fortress: '#c48b6a',
  temple: '#d6a3e0',
  ruin: '#a39a8f',
  dungeon: '#9a7fd1',
  landmark: '#e8935a',
  poi: '#6cc4c0',
  route: '#d8b07a',
  party: '#e3b55a',
  character: '#9aa3b5',
  people: '#9aa3b5',
  faction: '#9aa3b5',
  note: '#9aa3b5',
};

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

/** #abc → #aabbcc (формат для <input type="color">), всё в нижнем регистре. */
export function toLongHex(color: string): string {
  const c = color.toLowerCase();
  return c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
}
