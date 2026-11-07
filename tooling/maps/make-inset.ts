/**
 * `npm run maps:inset -- <mapId> <insetId> [--entity=id1,id2] [--bounds=x,y,w,h] [--aspect=auto|3:2|1:1|2:3]
 *                        [--margin=0.05] [--size=1536] [--title=…] [--force]`
 *
 * Готовит детальную врезку: рамку вокруг региона (по объектам сущностей на карте или по --bounds),
 * inset.json с точными координатами, reference.png — вырезку арта карты в этой рамке (образец для
 * нейросети) и prompt.txt. Детальный арт, нарисованный по образцу, кладётся в ту же папку как source.png —
 * `npm run maps` (или запущенный `npm run dev`) нарежет его, и он встанет ровно на своё место.
 * Без --entity и --bounds регион ищется по id врезки: `npm run maps:inset -- world ostrova-varlordov`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Geometry, Position } from 'geojson';
import { INSET_CONFIG_FILE, SLUG_RE } from '../../src/shared/paths.ts';
import { compileWorld } from '../world/compile.ts';
import { fitInsetBounds, parseAspect, pickAspect, referenceSize, unionRect, type Rect } from './inset-geometry.ts';
import { insetsDirOf } from './insets.ts';
import { formatJson, writeFileAtomic } from './lib/fs.ts';
import { errorMessage } from './lib/log.ts';
import { loadMap, probeSource } from './map-config.ts';

function geometryRect(geometry: Geometry): Rect | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      xs.push((c as Position)[0]!);
      ys.push((c as Position)[1]!);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  if (geometry.type !== 'GeometryCollection') visit(geometry.coordinates);
  if (!xs.length) return null;
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0 || 1, Math.max(...ys) - y0 || 1];
}

function promptText(bounds: Rect, size: [number, number]): string {
  return [
    'Образец: reference.png (вырезка карты мира). Готовый арт сохраните в эту папку как source.png',
    `(та же композиция и пропорции ${size[0]}×${size[1]}; можно крупнее, например после апскейла ×4).`,
    '',
    '--- Промпт (RU) ---',
    'Перерисуй этот фрагмент фэнтези-карты в высоком разрешении с гораздо большей детализацией.',
    'Сохрани ТОЧНО: береговую линию, положение гор, лесов, рек, озёр и островов, общую композицию и палитру.',
    'Тот же рисованный стиль, строго вид сверху. Никаких надписей, значков, рамок, границ и сетки.',
    `Размер ${size[0]}×${size[1]}.`,
    '',
    '--- Prompt (EN) ---',
    'Redraw this fragment of a fantasy map at high resolution with much finer detail.',
    'Keep EXACTLY the same coastline, positions of mountains, forests, rivers, lakes and islands, the composition and the palette.',
    'Same painted style, strictly top-down. No text, labels, icons, borders, frames or grid.',
    `Output size ${size[0]}x${size[1]}.`,
    '',
    `Рамка врезки на карте (inset.json → bounds): [${bounds.join(', ')}]`,
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const [mapId, insetId] = args.filter((a) => !a.startsWith('--'));
  if (!mapId || !insetId) throw new Error('использование: npm run maps:inset -- <mapId> <insetId> [--entity=id1,id2] [--bounds=x,y,w,h]');
  if (!SLUG_RE.test(insetId)) throw new Error(`id врезки «${insetId}»: только a-z, 0-9 и дефисы`);
  const root = process.cwd();
  const map = await loadMap(root, mapId);
  const size = map.config.size;
  if (!size) throw new Error(`у карты ${mapId} ещё нет size — сначала npm run maps`);
  const source = await probeSource(root, map);
  if (!source) throw new Error(`у карты ${mapId} нет арта (source в map.json)`);

  // Регион: явная рамка, объекты сущностей или сущность с тем же id, что и врезка.
  let region: Rect;
  let title = insetId;
  const boundsArg = flag('bounds');
  if (boundsArg) {
    const n = boundsArg.split(',').map(Number);
    if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || n[2]! <= 0 || n[3]! <= 0) throw new Error('--bounds: ожидалось x,y,ширина,высота');
    region = n as Rect;
  } else {
    const ids = (flag('entity') ?? insetId).split(',').map((s) => s.trim()).filter(Boolean);
    const world = await compileWorld({ root, mode: 'dm', dev: false });
    const def = world.maps[mapId];
    if (!def) throw new Error(`карта ${mapId} не скомпилировалась — npm run check`);
    const rects: Rect[] = [];
    for (const id of ids) {
      const found = def.features.filter((f) => f.entity === id).map((f) => geometryRect(f.display)).filter((r): r is Rect => r !== null);
      if (!found.length) throw new Error(`у «${id}» нет объектов на карте ${mapId} — укажите --entity или --bounds`);
      rects.push(...found);
    }
    region = unionRect(rects);
    title = ids.map((id) => world.entities[id]?.name ?? id).join(', ');
  }
  title = flag('title') ?? title;

  const aspectArg = flag('aspect') ?? 'auto';
  const aspect = parseAspect(aspectArg) ?? pickAspect(region[2], region[3]).ratio;
  const margin = Number(flag('margin') ?? 0.05);
  const { bounds, clipped } = fitInsetBounds(region, size, aspect, margin);
  if (clipped) console.log('  внимание: регион больше карты в этих пропорциях — рамка обрезана, часть региона не войдёт');

  const dir = path.join(insetsDirOf(root, mapId), insetId);
  const configFile = path.join(dir, INSET_CONFIG_FILE);
  const exists = await fs.stat(configFile).then(() => true, () => false);
  if (exists && !args.includes('--force')) throw new Error(`врезка ${insetId} уже есть (${path.relative(root, configFile)}); --force — пересоздать рамку и образец`);
  await fs.mkdir(dir, { recursive: true });
  // При --force поля, которые автор поменял руками (showFrom, feather, source), сохраняются.
  const previous = exists ? (JSON.parse(await fs.readFile(configFile, 'utf8')) as Record<string, unknown>) : {};
  await writeFileAtomic(configFile, formatJson({ ...previous, title, bounds }));

  // Образец — вырезка исходника карты (в пикселях арта, а не единицах карты) в размере для нейросети.
  const longSide = Number(flag('size') ?? 1536);
  const [outW, outH] = referenceSize(bounds, longSide);
  const scaleX = source.width / size[0];
  const scaleY = source.height / size[1];
  const input = sharp(source.file, { limitInputPixels: false, ...(source.vector ? { density: 72 * Math.max(1, outW / (bounds[2] * scaleX)) } : {}) });
  const meta = await input.metadata();
  const k = source.vector ? (meta.width ?? source.width) / source.width : 1;
  const left = Math.max(0, Math.round(bounds[0] * scaleX * k));
  const top = Math.max(0, Math.round(bounds[1] * scaleY * k));
  const width = Math.min((meta.width ?? 0) - left, Math.round(bounds[2] * scaleX * k));
  const height = Math.min((meta.height ?? 0) - top, Math.round(bounds[3] * scaleY * k));
  await input.extract({ left, top, width, height }).resize(outW, outH, { fit: 'fill', kernel: 'lanczos3' }).png().toFile(path.join(dir, 'reference.png'));
  await writeFileAtomic(path.join(dir, 'prompt.txt'), promptText(bounds, [outW, outH]));

  const rel = (p: string) => path.relative(root, p).split(path.sep).join('/');
  console.log(`Врезка «${title}»: рамка [${bounds.join(', ')}], пропорции ${(bounds[2] / bounds[3]).toFixed(3)}`);
  console.log(`  ${rel(configFile)}`);
  console.log(`  ${rel(path.join(dir, 'reference.png'))} — ${outW}×${outH}, образец для нейросети`);
  console.log(`  ${rel(path.join(dir, 'prompt.txt'))} — готовый промпт`);
  console.log(`Дальше: нарисуйте детальный арт по образцу и положите его как ${rel(path.join(dir, 'source.png'))}`);
}

main().catch((error: unknown) => {
  console.error(`Ошибка: ${errorMessage(error)}`);
  process.exitCode = 1;
});
