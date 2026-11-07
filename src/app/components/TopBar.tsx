import { useRef, useState } from 'react';
import { LAYER_LABELS, LAYER_ORDER } from '../layers';
import { mapChain } from '../model';
import { useApp } from '../store';
import { openInCodeEditor, useDismiss } from './common';
import { SearchBox } from './SearchBox';

function MapCrumbs() {
  const world = useApp((s) => s.world);
  const mapId = useApp((s) => s.mapId);
  const chain = mapChain(world, mapId);
  if (chain.length < 2) return null;
  return (
    <nav className="crumbs" aria-label="Карты">
      {chain.map((map, i) => {
        const last = i === chain.length - 1;
        // Возвращаясь на родительскую карту, подлетаем к объекту дочерней (например, к городу).
        const focus = chain[i + 1]?.entity ?? null;
        return last ? (
          <span key={map.id} className="crumb is-current" aria-current="page">
            {map.title}
          </span>
        ) : (
          <button key={map.id} type="button" className="crumb" onClick={() => useApp.getState().openMap(map.id, focus)}>
            {map.title}
          </button>
        );
      })}
    </nav>
  );
}

function LayersMenu() {
  const layers = useApp((s) => s.layers);
  const insetDebug = useApp((s) => s.insetDebug);
  const hasInsets = useApp((s) => (s.world.maps[s.mapId]?.insets.length ?? 0) > 0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-btn" aria-expanded={open} aria-label="Слои карты" title="Слои карты" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 2 8.5l10 5.5 10-5.5zM4.6 12.6 2 14l10 5.5L22 14l-2.6-1.4L12 16.7z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          <div className="menu-title">Слои</div>
          {LAYER_ORDER.map((key) => (
            <label key={key} className="menu-check">
              <input type="checkbox" checked={layers[key]} onChange={() => useApp.getState().toggleLayer(key)} />
              <span>{LAYER_LABELS[key]}</span>
            </label>
          ))}
          {import.meta.env.DEV && hasInsets && (
            <label className="menu-check menu-check-dev" title="Контуры врезок и их полупрозрачный арт — чтобы проверить, ровно ли он лёг">
              <input type="checkbox" checked={insetDebug} onChange={() => useApp.getState().toggleInsetDebug()} />
              <span>Врезки: проверка совмещения</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** Список проблем в данных — только в dev, где они видны автору. */
function IssuesMenu() {
  const issues = useApp((s) => s.world.issues);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  if (!import.meta.env.DEV || issues.length === 0) return null;
  const errors = issues.filter((i) => i.level === 'error').length;
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={`issues-btn${errors ? ' has-errors' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Проблемы в данных мира"
      >
        ⚠ {issues.length}
      </button>
      {open && (
        <div className="menu-popover issues-popover">
          <div className="menu-title">
            Проблемы в данных: {errors} ошибок, {issues.length - errors} предупреждений
          </div>
          <ul className="issues-list">
            {issues.map((issue, i) => (
              <li key={i} className={`issue issue-${issue.level}`}>
                <span className="issue-message">{issue.message}</span>
                {issue.file && (
                  <button type="button" className="issue-file" onClick={() => openInCodeEditor(issue.file!)}>
                    {issue.file}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const title = useApp((s) => s.world.title);
  const subtitle = useApp((s) => s.world.subtitle);
  const mode = useApp((s) => s.world.mode);
  const defaultMap = useApp((s) => s.world.defaultMap);
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <button type="button" className="brand" onClick={() => useApp.getState().openMap(defaultMap)} title="К карте мира">
          <span className="brand-title">{title}</span>
          {subtitle && <span className="brand-subtitle">{subtitle}</span>}
        </button>
        <MapCrumbs />
      </div>
      <div className="topbar-tools">
        {mode === 'dm' && (
          <span className="badge badge-dm" title="Версия мастера: видны секреты. Игрокам публикуйте npm run build.">
            мастер
          </span>
        )}
        <IssuesMenu />
        <SearchBox />
        <LayersMenu />
      </div>
    </header>
  );
}
