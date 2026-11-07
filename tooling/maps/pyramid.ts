/**
 * План пирамиды тайлов: какие уровни зума нарезать и сколько тайлов на каждом.
 * Чистые функции поверх src/shared/zoom.ts — та же математика, что у просмотрщика.
 */
import { TILE_SIZE, levelSize, maxNativeZoomFor, zoomBaseFor } from '../../src/shared/zoom.ts';

/** Во сколько раз векторный исходник (SVG) детальнее пространства координат. */
export const VECTOR_OVERSAMPLE = 4;

export interface PyramidInput {
  /** Пространство координат [ширина, высота] в единицах карты. */
  size: readonly [number, number];
  /** Размер растрового исходника в пикселях (для SVG не важен). */
  sourceSize: readonly [number, number];
  /** SVG: считаем исходник в VECTOR_OVERSAMPLE раз детальнее пространства координат. */
  vector?: boolean;
}

export interface PyramidLevel {
  z: number;
  /** Размер картинки уровня в пикселях: ровно size × 2^(z − zoomBase), округлённо. */
  width: number;
  height: number;
  /** Число тайлов по горизонтали и вертикали. */
  cols: number;
  rows: number;
}

export interface PyramidPlan {
  zoomBase: number;
  maxNativeZoom: number;
  /** Уровни z = 0..maxNativeZoom по возрастанию. */
  levels: PyramidLevel[];
}

function assertSize(name: string, [w, h]: readonly [number, number]): void {
  if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)) {
    throw new Error(`${name}: ожидались положительные числа, получено [${w}, ${h}]`);
  }
}

export function planPyramid({ size, sourceSize, vector = false }: PyramidInput): PyramidPlan {
  assertSize('size', size);
  const [w, h] = size;
  const zoomBase = zoomBaseFor(w, h);
  let maxNativeZoom: number;
  if (vector) {
    maxNativeZoom = maxNativeZoomFor(w, h, w * VECTOR_OVERSAMPLE, h * VECTOR_OVERSAMPLE);
  } else {
    assertSize('sourceSize', sourceSize);
    maxNativeZoom = maxNativeZoomFor(w, h, sourceSize[0], sourceSize[1]);
  }

  const levels: PyramidLevel[] = [];
  for (let z = 0; z <= maxNativeZoom; z++) {
    const [width, height] = levelSize(w, h, z, zoomBase);
    levels.push({ z, width, height, cols: Math.ceil(width / TILE_SIZE), rows: Math.ceil(height / TILE_SIZE) });
  }
  return { zoomBase, maxNativeZoom, levels };
}

/** Общее число тайлов в пирамиде. */
export function tileCount(plan: PyramidPlan): number {
  return plan.levels.reduce((sum, l) => sum + l.cols * l.rows, 0);
}

/** Самый детальный уровень (его размер — разрешение, до которого растеризуется SVG). */
export function topLevel(plan: PyramidPlan): PyramidLevel {
  const level = plan.levels.at(-1);
  if (!level) throw new Error('пустой план пирамиды');
  return level;
}
