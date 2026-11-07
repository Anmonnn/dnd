/** Форматирование чисел и русские формы множественного числа для интерфейса редактора. */

/** toFixed без «-0.0». */
export function formatNumber(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0(?:\.0+)?$/.test(text) ? text.slice(1) : text;
}

/** «[x, y]» — формат, в котором координаты удобно вставлять в features.geojson. */
export function formatPoint(x: number, y: number, digits = 1): string {
  return `[${formatNumber(x, digits)}, ${formatNumber(y, digits)}]`;
}

/** 1 объект, 2 объекта, 5 объектов, 21 объект, 11 объектов. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function countObjects(n: number): string {
  return `${n} ${pluralRu(n, 'объект', 'объекта', 'объектов')}`;
}
