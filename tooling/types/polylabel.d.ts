/** polylabel@2 не поставляет типы. */
declare module 'polylabel' {
  /** Полюс недоступности многоугольника: [x, y] и расстояние до ближайшего края. */
  export default function polylabel(polygon: number[][][], precision?: number, debug?: boolean): [number, number] & { distance: number };
}
