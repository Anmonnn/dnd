/**
 * Форма свойств объекта и «дифф» с исходными свойствами: в props попадают только поля,
 * которые пользователь действительно поменял; «авто» удаляет ключ (значение берётся из статьи).
 */
import { isKind, type DetailLevel, type Kind } from '../../shared/kinds';
import type { AuthoredFeatureProps, Visibility } from '../../shared/types';
import type { EntityRef } from './features';
import { isHexColor, toLongHex } from './palette';

export const AUTO = 'auto';
export type Auto = typeof AUTO;

export type KindChoice = Auto | Kind;
export type DetailChoice = Auto | '0' | '1' | '2';
export type VisibilityChoice = Auto | Visibility;

export interface PropsForm {
  /** id связанной статьи; null — подпись без статьи. */
  entity: string | null;
  /** Своё название; пустая строка — из статьи. */
  name: string;
  kind: KindChoice;
  detail: DetailChoice;
  /** Свой цвет #rrggbb; пустая строка — из статьи или по типу. */
  color: string;
  visibility: VisibilityChoice;
}

const DETAIL_CHOICE: Record<DetailLevel, DetailChoice> = { 0: '0', 1: '1', 2: '2' };
const DETAIL_VALUE: Record<Exclude<DetailChoice, Auto>, DetailLevel> = { '0': 0, '1': 1, '2': 2 };

export function formFromProps(props: AuthoredFeatureProps): PropsForm {
  const { entity, name, kind, detail, color, visibility } = props;
  return {
    entity: typeof entity === 'string' && entity.trim() ? entity.trim() : null,
    name: typeof name === 'string' ? name : '',
    kind: isKind(kind) ? kind : AUTO,
    detail: detail === 0 || detail === 1 || detail === 2 ? DETAIL_CHOICE[detail] : AUTO,
    color: isHexColor(color) ? toLongHex(color) : '',
    visibility: visibility === 'public' || visibility === 'dm' ? visibility : AUTO,
  };
}

type FieldDiff = { [K in keyof PropsForm]: boolean };

function diff(initial: PropsForm, next: PropsForm): FieldDiff {
  return {
    entity: next.entity !== initial.entity,
    name: next.name.trim() !== initial.name.trim(),
    kind: next.kind !== initial.kind,
    detail: next.detail !== initial.detail,
    color: next.color.toLowerCase() !== initial.color.toLowerCase(),
    visibility: next.visibility !== initial.visibility,
  };
}

export function formChanged(initial: PropsForm, next: PropsForm): boolean {
  return Object.values(diff(initial, next)).some(Boolean);
}

/** Новые props: исходные + изменённые поля. Неизвестные ключи и нетронутые поля сохраняются как есть. */
export function applyForm(props: AuthoredFeatureProps, initial: PropsForm, next: PropsForm): AuthoredFeatureProps {
  const changed = diff(initial, next);
  const out: AuthoredFeatureProps = { ...props };
  if (changed.entity) {
    if (next.entity) out.entity = next.entity;
    else delete out.entity;
  }
  if (changed.name) {
    const name = next.name.trim();
    if (name) out.name = name;
    else delete out.name;
  }
  if (changed.kind) {
    if (next.kind === AUTO) delete out.kind;
    else out.kind = next.kind;
  }
  if (changed.detail) {
    if (next.detail === AUTO) delete out.detail;
    else out.detail = DETAIL_VALUE[next.detail];
  }
  if (changed.color) {
    if (next.color) out.color = next.color.toLowerCase();
    else delete out.color;
  }
  if (changed.visibility) {
    if (next.visibility === AUTO) delete out.visibility;
    else out.visibility = next.visibility;
  }
  return out;
}

/**
 * Отвязать статью, не потеряв вид объекта: если своего названия/типа/цвета не было,
 * они переносятся из статьи (иначе подпись осталась бы без имени).
 */
export function unlinkForm(form: PropsForm, entity: EntityRef | null): PropsForm {
  return {
    ...form,
    entity: null,
    name: form.name.trim() ? form.name : (entity?.name ?? ''),
    kind: form.kind !== AUTO ? form.kind : (entity?.kind ?? AUTO),
    color: form.color || (isHexColor(entity?.color) ? toLongHex(entity.color) : ''),
  };
}

/** Проблемы, из-за которых форму нельзя применить. */
export function formProblems(form: PropsForm): string[] {
  const problems: string[] = [];
  if (!form.entity && !form.name.trim()) problems.push('У подписи без статьи должно быть название.');
  return problems;
}
