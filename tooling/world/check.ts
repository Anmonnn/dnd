/** CLI `npm run check`: компиляция мира в обоих режимах и отчёт о проблемах. --strict — предупреждения тоже ошибка. */
import { KINDS } from '../../src/shared/kinds.ts';
import type { WorldMode } from '../../src/shared/types.ts';
import { compileWorld } from './compile.ts';
import { formatIssues } from './report.ts';

const strict = process.argv.includes('--strict');
let failed = false;
for (const mode of ['dm', 'public'] as WorldMode[]) {
  const data = await compileWorld({ root: process.cwd(), mode, dev: false });
  const errors = data.issues.filter((i) => i.level === 'error');
  const counts = new Map<string, number>();
  for (const e of Object.values(data.entities)) counts.set(KINDS[e.kind].plural, (counts.get(KINDS[e.kind].plural) ?? 0) + 1);
  const maps = Object.values(data.maps).map((m) => `${m.id} (${m.features.length} объектов)`);
  console.log(`\n── режим ${mode === 'dm' ? 'мастера' : 'игроков'}: ${Object.keys(data.entities).length} статей — ${[...counts].map(([k, n]) => `${k}: ${n}`).join(', ')}`);
  console.log(`   карты: ${maps.join(', ') || 'нет'}`);
  if (data.issues.length) console.log(formatIssues(data.issues));
  if (errors.length || (strict && data.issues.length)) failed = true;
}
console.log(failed ? '\nЕсть проблемы — исправьте их перед сборкой.' : '\nДанные мира в порядке.');
process.exitCode = failed ? 1 : 0;
