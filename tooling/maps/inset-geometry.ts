/** Геометрия врезок: рамка вокруг региона в пропорциях, которые понимают нейросети-художники. */

/** [x, y, ширина, высота] в единицах карты. */
export type Rect = [number, number, number, number];

/** Пропорции, в которых генерируют картинки ChatGPT и подобные: подгоняем рамку под них, чтобы арт лёг без растяжения. */
export const AI_ASPECTS: ReadonlyArray<{ name: string; ratio: number }> = [
  { name: '3:2', ratio: 3 / 2 },
  { name: '1:1', ratio: 1 },
  { name: '2:3', ratio: 2 / 3 },
];

/** "3:2" → 1.5; "auto" → null. */
export function parseAspect(value: string): number | null {
  if (value === 'auto') return null;
  const m = /^(\d+(?:\.\d+)?)[:x/](\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!m || !Number(m[1]) || !Number(m[2])) throw new Error(`пропорции «${value}»: ожидалось вроде 3:2, 1:1, 2:3 или auto`);
  return Number(m[1]) / Number(m[2]);
}

/** Ближайшие к пропорциям прямоугольника стандартные (по логарифму отношения сторон). */
export function pickAspect(width: number, height: number): { name: string; ratio: number } {
  const target = Math.log(width / height);
  return AI_ASPECTS.reduce((best, a) => (Math.abs(Math.log(a.ratio) - target) < Math.abs(Math.log(best.ratio) - target) ? a : best));
}

/** Описывающий прямоугольник набора прямоугольников. */
export function unionRect(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r[0]));
  const y0 = Math.min(...rects.map((r) => r[1]));
  const x1 = Math.max(...rects.map((r) => r[0] + r[2]));
  const y1 = Math.max(...rects.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

/**
 * Рамка врезки: регион + поля (margin — доля большей стороны), расширенная до пропорций aspect
 * и вписанная в карту. Если рамка больше карты, она уменьшается целиком (пропорции важнее полей) —
 * тогда clipped = true: регион может не влезть полностью.
 */
export function fitInsetBounds(region: Rect, mapSize: readonly [number, number], aspect: number, margin: number): { bounds: Rect; clipped: boolean } {
  const [mapW, mapH] = mapSize;
  const pad = margin * Math.max(region[2], region[3]);
  let [x, y, w, h] = [region[0] - pad, region[1] - pad, region[2] + 2 * pad, region[3] + 2 * pad];
  if (w / h < aspect) {
    const nw = h * aspect;
    x -= (nw - w) / 2;
    w = nw;
  } else {
    const nh = w / aspect;
    y -= (nh - h) / 2;
    h = nh;
  }
  let clipped = false;
  const scale = Math.min(1, mapW / w, mapH / h);
  if (scale < 1) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    w *= scale;
    h *= scale;
    x = cx - w / 2;
    y = cy - h / 2;
    clipped = w < region[2] || h < region[3];
  }
  x = Math.min(Math.max(0, x), mapW - w);
  y = Math.min(Math.max(0, y), mapH - h);
  const r = (n: number) => Math.round(n * 10) / 10;
  return { bounds: [r(x), r(y), r(w), r(h)], clipped };
}

/** Размер картинки-образца: длинная сторона = longSide, пропорции — как у рамки. */
export function referenceSize(bounds: Rect, longSide: number): [number, number] {
  const ratio = bounds[2] / bounds[3];
  return ratio >= 1 ? [longSide, Math.round(longSide / ratio)] : [Math.round(longSide * ratio), longSide];
}
