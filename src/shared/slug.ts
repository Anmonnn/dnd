/** Транслитерация кириллицы и генерация id (slug) из человекочитаемых названий. */

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
  // украинский / белорусский
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u',
};

export function transliterate(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) out += TRANSLIT[ch] ?? ch;
  return out;
}

/**
 * «Златоград-на-Скалах» → "zlatograd-na-skalakh". Пустая строка, если букв/цифр нет.
 * Транслитерация идёт до NFKD: иначе «й» распадётся на «и» + бреве.
 */
export function slugify(text: string, maxLength = 64): string {
  return transliterate(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/** Уникальный slug: при коллизии добавляет -2, -3, … */
export function uniqueSlug(text: string, taken: (id: string) => boolean, fallback = 'item'): string {
  const base = slugify(text) || fallback;
  if (!taken(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken(candidate)) return candidate;
  }
}
