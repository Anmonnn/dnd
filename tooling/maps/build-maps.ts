/** CLI: npm run maps [-- <mapId>…] [--force] [--quality=82] */
import { buildMaps } from './build.ts';
import { errorMessage } from './lib/log.ts';

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('--'));
const qualityArg = args.find((a) => a.startsWith('--quality='));

try {
  console.log('Карты: нарезка тайлов');
  const report = await buildMaps({
    root: process.cwd(),
    ids,
    force: args.includes('--force'),
    quality: qualityArg ? Number(qualityArg.split('=')[1]) : undefined,
    log: (line) => console.log(line),
  });
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Ошибка: ${errorMessage(error)}`);
  process.exitCode = 1;
}
