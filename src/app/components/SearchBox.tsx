import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { KINDS } from '../../shared/kinds';
import type { Entity } from '../../shared/types';
import { searchEntities } from '../model';
import { useApp } from '../store';
import { assetUrl, isTypingTarget, KindIcon, useDismiss } from './common';

function choose(entity: Entity): void {
  const state = useApp.getState();
  if (entity.locations.length > 0) state.showOnMap(entity.id);
  else state.select(entity.id);
}

/** Поиск по всем сущностям; пустой запрос показывает каталог, сгруппированный по типам. Горячая клавиша «/». */
export function SearchBox() {
  const world = useApp((s) => s.world);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => searchEntities(world, query), [world, query]);
  const catalog = query.trim() === '';

  useDismiss(rootRef, open, () => setOpen(false));
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const pick = (entity: Entity) => {
    choose(entity);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="search" ref={rootRef}>
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        placeholder="Поиск по миру…  /"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        aria-label="Поиск по миру"
      />
      {open && (
        <ul className="search-results" id={listId} role="listbox">
          {results.length === 0 && <li className="search-empty">Ничего не найдено</li>}
          {results.map((entity, i) => {
            const groupStart = catalog && (i === 0 || results[i - 1]!.kind !== entity.kind);
            const parent = entity.parent ? world.entities[entity.parent] : undefined;
            return (
              <li key={entity.id} role="presentation">
                {groupStart && <div className="search-group">{KINDS[entity.kind].plural}</div>}
                <button
                  type="button"
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`search-item${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(entity)}
                >
                  {entity.avatar ? <img className="search-avatar" src={assetUrl(entity.avatar.thumb)} alt="" /> : <KindIcon kind={entity.kind} />}
                  <span className="search-item-name">{entity.name}</span>
                  <span className="search-item-meta">
                    {catalog ? (parent?.name ?? '') : `${KINDS[entity.kind].label}${parent ? ` · ${parent.name}` : ''}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
