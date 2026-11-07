import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { entityStub } from './stub.ts';

describe('entityStub', () => {
  it('у мест есть пустой факт «Расы»', () => {
    const fm = matter(entityStub({ name: 'Новый город', kind: 'city' })).data;
    expect(fm.facts).toEqual({ Расы: null });
  });

  it('у персонажей и фракций фактов нет', () => {
    expect(matter(entityStub({ name: 'Некто', kind: 'character' })).data.facts).toBeUndefined();
    expect(matter(entityStub({ name: 'Орден', kind: 'faction' })).data.facts).toBeUndefined();
  });
});
