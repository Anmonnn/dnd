/** Заготовка статьи для новой сущности, созданной из редактора. */
import type { CreateEntityRequest } from '../../src/shared/schemas.ts';

/** Безопасная YAML-строка: всегда в двойных кавычках. */
export function yamlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
  return `"${escaped}"`;
}

/** Типы, где живут: у них в заготовке есть факт «Расы» (пустой факт на сайте не показывается). */
const POPULATED_KINDS = new Set<CreateEntityRequest['kind']>(['state', 'region', 'district', 'capital', 'city', 'town', 'village', 'fortress']);

export function entityStub(req: CreateEntityRequest): string {
  const lines = ['---', `name: ${yamlString(req.name.trim())}`, `kind: ${req.kind}`];
  if (req.parent) lines.push(`parent: ${yamlString(req.parent)}`);
  if (req.location) lines.push(`location: ${yamlString(req.location)}`);
  if (req.summary?.trim()) lines.push(`summary: ${yamlString(req.summary.trim())}`);
  if (req.visibility === 'dm') lines.push('visibility: dm');
  if (POPULATED_KINDS.has(req.kind)) lines.push('facts:', '  Расы:   # преобладающие расы, первыми — самых многочисленных');
  lines.push('---', '', 'Описание пока не написано.', '');
  return lines.join('\n');
}
