/**
 * Markdown статей: комментарии Obsidian %%…%%, callout-блоки (> [!dm] вырезаются в версии для игроков),
 * вики-ссылки [[id|текст]], картинки ![[файл.png]] и ![](файл.png). Код (``` и `…`) не трогается.
 */
import { Marked, type TokenizerAndRendererExtension } from 'marked';
import type { WorldMode } from '../../src/shared/types.ts';

/** Результат разрешения вики-ссылки. hidden — цель скрыта режимом (не ошибка, но и не ссылка). */
export type LinkTarget = { id: string; name: string } | 'hidden' | null;

export interface RenderContext {
  mode: WorldMode;
  resolve(target: string): LinkTarget;
  warn(message: string): void;
  /** URL уменьшенной копии картинки по ссылке из текста; null — файл не найден. */
  resolveImage?(ref: string): string | null;
}

export interface RenderResult {
  html: string;
  /** id сущностей, на которые есть ссылки. */
  links: string[];
  /** Текст первого абзаца без разметки — запасной summary. */
  firstParagraph: string;
}

const SECRET_CALLOUTS = new Set(['dm', 'secret']);
const CALLOUT_TITLES: Record<string, string> = {
  dm: 'Секрет мастера',
  secret: 'Секрет мастера',
  note: 'Заметка',
  info: 'Инфо',
  tip: 'Совет',
  warning: 'Внимание',
  danger: 'Опасность',
  quote: 'Цитата',
  example: 'Пример',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

const FENCE_RE = /^\s*(```|~~~)/;
const CALLOUT_RE = /^>\s*\[!([\w-]+)\][+-]?\s*(.*)$/;

/** Построчная предобработка вне блоков кода: комментарии %%…%% и callout-блоки. */
export function preprocess(src: string, mode: WorldMode): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    const fenceMatch = FENCE_RE.exec(line);
    if (!inComment && fenceMatch) {
      if (fence === null) fence = fenceMatch[1]!;
      else if (fenceMatch[1] === fence) fence = null;
      out.push(line);
      continue;
    }
    if (fence !== null) {
      out.push(line);
      continue;
    }
    // Комментарии %%…%% (в том числе многострочные).
    let kept = '';
    let rest = line;
    for (;;) {
      const idx = rest.indexOf('%%');
      if (idx < 0) {
        if (!inComment) kept += rest;
        break;
      }
      if (!inComment) kept += rest.slice(0, idx);
      inComment = !inComment;
      rest = rest.slice(idx + 2);
    }
    if (kept.trim() === '' && line.trim() !== '' && line.includes('%%')) continue;
    line = kept;

    const callout = CALLOUT_RE.exec(line);
    if (callout) {
      const type = callout[1]!.toLowerCase();
      const body: string[] = [];
      while (i + 1 < lines.length && /^>/.test(lines[i + 1]!)) body.push(lines[++i]!.replace(/^>\s?/, ''));
      if (SECRET_CALLOUTS.has(type) && mode === 'public') continue;
      const title = callout[2]!.trim() || CALLOUT_TITLES[type] || type;
      const cls = SECRET_CALLOUTS.has(type) ? 'dm' : type.replace(/[^a-z0-9-]/g, '');
      out.push(`<aside class="callout callout-${cls}"><div class="callout-title">${escapeHtml(title)}</div>`, '', ...body, '', '</aside>', '');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

const IMAGE_REF_EXT = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

/** Все ссылки на картинки в тексте: ![[файл.png|300]] и ![подпись](файл.png). */
export function collectImageRefs(src: string): string[] {
  const refs: string[] = [];
  for (const m of src.matchAll(/!\[\[([^\]\n]+?)\]\]/g)) refs.push(m[1]!);
  for (const m of src.matchAll(/!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g)) refs.push(m[1]!);
  return refs;
}

/** Разбор цели ссылки: «id#раздел|текст» → цель и подпись. */
export function parseWikiTarget(inner: string): { target: string; label: string | null } {
  const [left, label] = inner.split('|', 2) as [string, string | undefined];
  const target = left.split('#')[0]!.trim();
  return { target, label: label?.trim() || null };
}

function wikilinkExtension(ctx: RenderContext, links: Set<string>): TokenizerAndRendererExtension {
  return {
    name: 'wikilink',
    level: 'inline',
    start: (src) => src.match(/!?\[\[/)?.index,
    tokenizer(src) {
      const match = /^(!?)\[\[([^\]\n]+?)\]\]/.exec(src);
      if (!match) return undefined;
      return { type: 'wikilink', raw: match[0], embed: match[1] === '!', inner: match[2] };
    },
    renderer(token) {
      const { target, label } = parseWikiTarget(token.inner as string);
      if (token.embed) {
        const url = ctx.resolveImage?.(token.inner as string) ?? null;
        if (url) {
          // ![[файл.png|300]] или |300x200 — размер, как в Obsidian.
          const size = label && /^\d+(x\d+)?$/.test(label) ? label.split('x') : null;
          const dims = size ? ` width="${size[0]}"${size[1] ? ` height="${size[1]}"` : ''}` : '';
          return `<img class="embed" src="${escapeHtml(url)}" alt="${escapeHtml(size ? target : (label ?? target))}"${dims} loading="lazy">`;
        }
        ctx.warn(
          IMAGE_REF_EXT.test(target)
            ? `Картинка ![[${token.inner}]] не найдена (ищется рядом со статьёй, в world/ и в public/)`
            : `Встраивание статей ![[${token.inner}]] пока не поддерживается`,
        );
        return escapeHtml(label ?? target);
      }
      const resolved = ctx.resolve(target);
      if (resolved === 'hidden') return `<span class="wikilink-plain">${escapeHtml(label ?? target)}</span>`;
      if (!resolved) {
        ctx.warn(`Вики-ссылка [[${target}]] ведёт на несуществующую статью`);
        return `<span class="wikilink wikilink-missing" title="Статья не найдена">${escapeHtml(label ?? target)}</span>`;
      }
      links.add(resolved.id);
      return `<a class="wikilink" href="#/e/${encodeURIComponent(resolved.id)}" data-entity="${escapeHtml(resolved.id)}">${escapeHtml(label ?? resolved.name)}</a>`;
    },
  };
}

function createMarked(ctx: RenderContext, links: Set<string>): Marked {
  return new Marked({
    gfm: true,
    async: false,
    extensions: [wikilinkExtension(ctx, links)],
    renderer: {
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href);
        const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}${attrs}>${text}</a>`;
      },
      image({ href, title, text }) {
        let src = href;
        if (!/^(https?:)?\/\/|^data:/i.test(href)) {
          const url = ctx.resolveImage?.(href) ?? null;
          if (url) src = url;
          else ctx.warn(`Картинка «${href}» не найдена (ищется рядом со статьёй, в world/ и в public/)`);
        }
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`;
      },
    },
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderMarkdown(src: string, ctx: RenderContext): RenderResult {
  const links = new Set<string>();
  const html = createMarked(ctx, links).parse(preprocess(src, ctx.mode)) as string;
  // Первый абзац с текстом (абзац из одной картинки пропускаем).
  let firstParagraph = '';
  for (const m of html.replace(/<aside[\s\S]*?<\/aside>/g, '').matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    firstParagraph = htmlToText(m[1]!);
    if (firstParagraph) break;
  }
  return { html: html.trim(), links: [...links], firstParagraph };
}

export function renderInline(src: string, ctx: RenderContext, links: Set<string>): string {
  return createMarked(ctx, links).parseInline(src) as string;
}
