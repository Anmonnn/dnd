/**
 * Математика системы координат и зума. Общая для генератора тайлов (Node) и просмотрщика (браузер),
 * поэтому любые изменения здесь требуют перегенерации тайлов (`npm run maps -- --force`).
 *
 * Координаты карты — «единицы карты»: x вправо, y вниз, (0,0) — левый верхний угол.
 * Размер пространства (width × height) фиксируется в map.json один раз и не зависит
 * от разрешения картинки: можно заменить арт на апскейл ×4, и все объекты останутся на местах.
 *
 * Зум z: 1 единица карты = 2^(z − zoomBase) экранных пикселей.
 * Уровень тайлов z содержит картинку, отмасштабированную ровно до этого размера.
 */
import type { DetailLevel } from './kinds.ts';

export const TILE_SIZE = 256;

/** Сколько уровней можно приближать сверх нативного разрешения арта (картинка начнёт мылиться). */
export const OVERZOOM_LEVELS = 2;

/** Зум, на котором 1 единица карты = 1 пиксель. На зуме 0 вся карта ≤ 256 px. */
export function zoomBaseFor(width: number, height: number): number {
  return Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / TILE_SIZE)));
}

/** Пикселей на единицу карты на зуме z. */
export function scaleAtZoom(zoom: number, zoomBase: number): number {
  return 2 ** (zoom - zoomBase);
}

/** Размер картинки уровня тайлов z в пикселях. */
export function levelSize(width: number, height: number, zoom: number, zoomBase: number): [number, number] {
  const s = scaleAtZoom(zoom, zoomBase);
  return [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))];
}

/**
 * Максимальный нативный уровень тайлов для исходника sourceWidth × sourceHeight px:
 * картинка в 4 раза больше пространства координат даёт zoomBase + 2.
 */
export function maxNativeZoomFor(width: number, height: number, sourceWidth: number, sourceHeight: number): number {
  const ratio = Math.min(sourceWidth / width, sourceHeight / height);
  return zoomBaseFor(width, height) + Math.max(0, Math.round(Math.log2(ratio)));
}

/** На скольких уровнях зума врезка плавно проявляется до showFrom (там она уже видна полностью). */
export const INSET_FADE = 0.75;

/**
 * Самый мелкий уровень тайлов врезки: ниже начала проявления она не нужна. Leaflet берёт тайлы
 * уровня round(зум), поэтому запас — целый уровень вниз от начала проявления.
 */
export function insetMinZoom(showFrom: number): number {
  return Math.max(0, Math.floor(showFrom - INSET_FADE));
}

/** showFrom по умолчанию: врезка проявляется там, где основной арт карты начинает мылиться. */
export function defaultInsetShowFrom(mapMaxNativeZoom: number): number {
  return mapMaxNativeZoom + 0.25;
}

/** Смещение от zoomBase, начиная с которого показываются объекты уровня детализации. */
export const DETAIL_ZOOM_OFFSET: Record<DetailLevel, number> = { 0: -Infinity, 1: -0.75, 2: 0.25 };

export function minZoomForDetail(detail: DetailLevel, zoomBase: number): number {
  return zoomBase + DETAIL_ZOOM_OFFSET[detail];
}
