/** Значки типов сущностей (SVG 24×24, заливка currentColor) и HTML маркеров карты. */
import type { Kind } from '../../shared/kinds';

const GLYPHS: Record<Kind, string> = {
  state: '<path d="M3 18.5 4.5 7.5l4.8 4.2L12 4.5l2.7 7.2 4.8-4.2L21 18.5zM3 20h18v2H3z"/>',
  region: '<path d="M1.5 20.5 9 8l3.6 6 2.4-3.5 7.5 10z"/>',
  district: '<path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>',
  water:
    '<path d="M2 8.5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2V11c-2.5 0-2.5-2-5-2s-2.5 2-5 2-2.5-2-5-2-2.5 2-5 2zm0 6.5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2v2.5c-2.5 0-2.5-2-5-2s-2.5 2-5 2-2.5-2-5-2-2.5 2-5 2z"/>',
  capital: '<path d="M12 2.5l2.35 6.26 6.69.3-5.24 4.18 1.78 6.45L12 16l-5.58 3.69 1.78-6.45-5.24-4.18 6.69-.3z"/>',
  city: '<path d="M3 21V10h3V7.5h2V10h2V5h4v5h2V7.5h2V10h3v11h-7v-4.5a2 2 0 0 0-4 0V21z"/>',
  town: '<path d="M12 3.5l8.5 7.5H18v9.5h-4.5V15h-3v5.5H6V11H3.5z"/>',
  village: '<circle cx="12" cy="12" r="4.5"/>',
  fortress: '<path d="M12 2.5l8 3v6.2c0 4.7-3.3 8.6-8 9.8-4.7-1.2-8-5.1-8-9.8V5.5z"/>',
  temple: '<path d="M12 2.5l9 5H3zM4.5 9h2.6v8.5H4.5zm4.3 0h2.6v8.5H8.8zm4.2 0h2.6v8.5H13zm4.2 0h2.6v8.5h-2.6zM3 19h18v2.5H3z"/>',
  ruin: '<path d="M4.5 19.5V9.5l2.6-1.2v11.2zm4.9 0V12l1.4-1 1.2 1.6v6.9zm4.6 0v-8l2.6-1.4v9.4zm4.6 0v-4l1.4-.8 1 .9v3.9zM3 20h18v2H3z"/>',
  dungeon: '<path d="M4 21V11a8 8 0 0 1 16 0v10h-5v-6.5a3 3 0 0 0-6 0V21z"/>',
  landmark: '<path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6-2.6 7.9-2.6-7.9L1.5 12l7.9-2.6z"/>',
  poi: '<path d="M12 2.5a7 7 0 0 1 7 7c0 5.2-7 12-7 12s-7-6.8-7-12a7 7 0 0 1 7-7zm0 4.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z"/>',
  route: '<path d="M3 19.5c3.5 0 4-2.5 6.5-5s5-1.5 7-4S19 5 21 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3 3.5"/>',
  party: '<path d="M4 2h2v20H4zm3 1h13l-2.5 4L20 11H7zM9.5 16.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm5 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 21c0-2.2 1.2-3.5 2.5-3.5s2.5 1.3 2.5 3.5zm5 0c0-2.2 1.2-3.5 2.5-3.5S17 18.8 17 21z"/>',
  character: '<path d="M12 11.5a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5zM3.5 21c0-4.6 3.8-7.5 8.5-7.5s8.5 2.9 8.5 7.5z"/>',
  people:
    '<path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.6 2.9-6.2 6.5-6.2S15 16.4 15 20zm14.2 0c-.2-2.3-1.1-4.2-2.6-5.5.9-.4 1.9-.6 2.9-.6 3.1 0 5.5 2.2 5.5 6.1z"/>',
  faction: '<path d="M5 2h2.2v20H5zm3.5 1H20l-3 4.5 3 4.5H8.5z"/>',
  note: '<path d="M6 2h8.5L20 7.5V22H6zm8 1v5h5"/>',
};

export function kindSvg(kind: Kind, className = 'kind-svg'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${GLYPHS[kind]}</svg>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Инициалы для кружка без аватара: «Вечный Легион Древних» → «ВЛ». */
export function initials(name: string): string {
  const words = name.replace(/[«»"()]/g, ' ').split(/[\s-]+/).filter(Boolean);
  const letters = words.length > 1 ? [...words[0]!][0]! + [...words[1]!][0]! : [...(words[0] ?? '?')].slice(0, 2).join('');
  return letters.toUpperCase();
}

/** Цвет фона инициалов — стабильный для имени. */
export function initialsColor(name: string): string {
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.codePointAt(0)!) % 360;
  return `hsl(${hue} 38% 34%)`;
}

export interface PinItem {
  /** id кружка (pin-<id сущности>). */
  id: string;
  entity: string;
  name: string;
  /** URL миниатюры аватара; null — инициалы. */
  avatar: string | null;
  /** Группа игроков: знамя в цвете группы и ряд участников под ним. */
  party?: { color: string | null; members: { name: string; avatar: string | null }[] };
}

function face(name: string, avatar: string | null): string {
  return avatar
    ? `<img class="pin-img" src="${escapeHtml(avatar)}" alt="" loading="lazy" draggable="false">`
    : `<span class="pin-initials" style="background:${initialsColor(name)}">${escapeHtml(initials(name))}</span>`;
}

/** Участники группы мини-кружками; больше 6 — «+N». */
function partyMembersHtml(members: { name: string; avatar: string | null }[]): string {
  if (!members.length) return '';
  const shown = members.length > 6 ? members.slice(0, 5) : members;
  const extra = members.length - shown.length;
  const items = shown.map((m) => `<span class="pin-member" title="${escapeHtml(m.name)}">${face(m.name, m.avatar)}</span>`);
  if (extra > 0) items.push(`<span class="pin-member"><span class="pin-initials">+${extra}</span></span>`);
  return `<span class="pin-members">${items.join('')}</span>`;
}

/**
 * Ряд кружков одного места (аватар или инициалы + имя под ним). Маркер стоит в точке места,
 * ряд центрирован над значком места или под подписью области (map.css); раскладку делает браузер,
 * поэтому имена не налезают друг на друга. more > 0 — в конце кружок «+N» (список — в статье места).
 */
export function pinGroupHtml(items: PinItem[], more: number, placement: 'above' | 'below'): string {
  const pins = items.map((p) => {
    const cls = p.party ? 'pin pin-party' : 'pin';
    const style = p.party?.color ? ` style="--party:${escapeHtml(p.party.color)}"` : '';
    return (
      `<div class="${cls}"${style} data-pin="${escapeHtml(p.id)}" data-entity="${escapeHtml(p.entity)}" tabindex="0" role="button" aria-label="${escapeHtml(p.name)}">` +
      `<span class="pin-avatar">${face(p.name, p.avatar)}</span><span class="pin-name">${escapeHtml(p.name)}</span>` +
      (p.party ? partyMembersHtml(p.party.members) : '') +
      `</div>`
    );
  });
  if (more > 0) {
    pins.push(
      `<div class="pin pin-more" data-more="1" tabindex="0" role="button" aria-label="Ещё ${more}" title="Ещё ${more} — список в статье места">` +
        `<span class="pin-avatar"><span class="pin-initials">+${more}</span></span><span class="pin-name">ещё</span></div>`,
    );
  }
  return `<div class="pin-group pin-${placement}">${pins.join('')}</div>`;
}

/**
 * Внутренность divIcon маркера: круглый значок + подпись. Контейнер маркера нулевого размера
 * стоит ровно в точке; значок центрируется на ней через CSS (см. map.css).
 * textOnly (водоёмы, надписи без статьи) — без значка, только подпись курсивом.
 * color — цвет места (фракция, культура): им красится значок вместо цвета типа.
 */
export function markerHtml(kind: Kind, name: string, icon: string | null, textOnly = kind === 'water', color: string | null = null): string {
  const label = name ? `<span class="mk-label">${escapeHtml(name)}</span>` : '';
  if (textOnly) return label;
  const glyph = icon ? `<span class="mk-emoji">${escapeHtml(icon)}</span>` : kindSvg(kind, 'mk-svg');
  const themed = color ? ` mk-themed" style="--ring:${escapeHtml(color)}` : '';
  return `<span class="mk-badge${themed}">${glyph}</span>${label}`;
}
