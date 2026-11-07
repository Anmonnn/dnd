import { describe, expect, it } from 'vitest';
import { KINDS, KIND_IDS, isKind } from './kinds.ts';
import { LoreFrontmatterSchema } from './schemas.ts';
import { slugify, transliterate, uniqueSlug } from './slug.ts';
import { levelSize, maxNativeZoomFor, minZoomForDetail, scaleAtZoom, zoomBaseFor } from './zoom.ts';

describe('slug', () => {
  it('транслитерирует кириллицу', () => {
    expect(transliterate('Щука и Ёж')).toBe('shchuka i ezh');
    expect(slugify('Златоград-на-Скалах')).toBe('zlatograd-na-skalakh');
    expect(slugify('Чайная «Под Ивой»')).toBe('chaynaya-pod-ivoy');
    expect(slugify('Київ, Ґанок')).toBe('kiyiv-ganok');
    expect(slugify('Café Noël')).toBe('cafe-noel');
    expect(slugify('!!!')).toBe('');
  });

  it('делает уникальные slug', () => {
    const taken = new Set(['zlatograd', 'zlatograd-2']);
    expect(uniqueSlug('Златоград', (id) => taken.has(id))).toBe('zlatograd-3');
    expect(uniqueSlug('???', () => false, 'f')).toBe('f');
  });
});

describe('zoom', () => {
  it('считает zoomBase и масштабы', () => {
    expect(zoomBaseFor(1461, 1077)).toBe(3);
    expect(zoomBaseFor(256, 100)).toBe(0);
    expect(zoomBaseFor(1200, 900)).toBe(3);
    expect(scaleAtZoom(3, 3)).toBe(1);
    expect(levelSize(1461, 1077, 3, 3)).toEqual([1461, 1077]);
    expect(levelSize(1461, 1077, 5, 3)).toEqual([5844, 4308]);
    expect(levelSize(1461, 1077, 0, 3)).toEqual([183, 135]);
  });

  it('нативный максимум зависит от разрешения арта', () => {
    expect(maxNativeZoomFor(1461, 1077, 1461, 1077)).toBe(3);
    expect(maxNativeZoomFor(1461, 1077, 5844, 4308)).toBe(5);
    expect(maxNativeZoomFor(1461, 1077, 700, 500)).toBe(3);
  });

  it('уровни детализации', () => {
    expect(minZoomForDetail(0, 3)).toBe(-Infinity);
    expect(minZoomForDetail(1, 3)).toBe(2.25);
    expect(minZoomForDetail(2, 3)).toBe(3.25);
  });
});

describe('kinds & schemas', () => {
  it('реестр согласован', () => {
    expect(KIND_IDS.length).toBe(Object.keys(KINDS).length);
    expect(isKind('city')).toBe(true);
    expect(isKind('toString')).toBe(false);
    const folders = new Set(Object.values(KINDS).map((k) => k.folder));
    for (const folder of folders) expect(folder).toMatch(/^[a-z]+$/);
  });

  it('фронтматтер принимает null от Obsidian и одиночные строки', () => {
    const parsed = LoreFrontmatterSchema.parse({ kind: 'city', parent: null, tags: 'торговля', aliases: ['A'], extra: 1 });
    expect(parsed.tags).toEqual(['торговля']);
    expect(parsed.parent).toBeNull();
    expect(LoreFrontmatterSchema.safeParse({ kind: 'castle' }).success).toBe(false);
    expect(LoreFrontmatterSchema.safeParse({ kind: 'city', color: 'red' }).success).toBe(false);
  });
});
