/** Стабильная, удобная для git-diff запись JSON/GeoJSON: позиции [x, y] в строку, 2 знака после запятой. */
import type { AuthoredFeatureCollection } from '../../src/shared/schemas.ts';

const KNOWN_PROPS = ['entity', 'kind', 'name', 'detail', 'color', 'visibility', 'labelAt'];

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const num = (n: number) => String(Math.round(n * 100) / 100 || 0);
const pos = (p: number[]) => `[${num(p[0]!)}, ${num(p[1]!)}]`;

/** Линия/кольцо: по 6 позиций в строке. */
function line(points: number[][], indent: string): string {
  if (points.length <= 6) return `[${points.map(pos).join(', ')}]`;
  const rows: string[] = [];
  for (let i = 0; i < points.length; i += 6) rows.push(points.slice(i, i + 6).map(pos).join(', '));
  return `[\n${indent}  ${rows.join(`,\n${indent}  `)}\n${indent}]`;
}

function coords(value: unknown, depth: number, indent: string): string {
  const arr = value as unknown[];
  if (depth === 0) return pos(arr as number[]);
  if (depth === 1) return line(arr as number[][], indent);
  return `[\n${arr.map((c) => `${indent}  ${coords(c, depth - 1, `${indent}  `)}`).join(',\n')}\n${indent}]`;
}

const DEPTH: Record<string, number> = { Point: 0, LineString: 1, Polygon: 2, MultiLineString: 2, MultiPolygon: 3 };

function orderedProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KNOWN_PROPS) if (props[k] !== undefined && props[k] !== null) out[k] = props[k];
  for (const k of Object.keys(props).sort()) if (!KNOWN_PROPS.includes(k) && props[k] !== undefined && props[k] !== null) out[k] = props[k];
  return out;
}

export function formatFeatureCollection(fc: AuthoredFeatureCollection): string {
  const features = fc.features.map((f) => {
    const g = f.geometry;
    const props = JSON.stringify(orderedProps((f.properties ?? {}) as Record<string, unknown>));
    return [
      '    {',
      '      "type": "Feature",',
      ...(f.id !== null && f.id !== undefined ? [`      "id": ${JSON.stringify(f.id)},`] : []),
      `      "properties": ${props},`,
      `      "geometry": { "type": "${g.type}", "coordinates": ${coords(g.coordinates, DEPTH[g.type]!, '      ')} }`,
      '    }',
    ].join('\n');
  });
  return `{\n  "type": "FeatureCollection",\n  "features": [${features.length ? `\n${features.join(',\n')}\n  ` : ''}]\n}\n`;
}
