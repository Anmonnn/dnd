import { lazy, Suspense, useEffect, useRef, type MouseEvent } from 'react';
import { KINDS } from '../../shared/kinds';
import type { Entity, WorldData } from '../../shared/types';
import { ancestors, groupByKind } from '../model';
import { useApp } from '../store';
import { assetUrl, isTypingTarget, KindIcon, openInCodeEditor } from './common';

// Инструменты мастера (привязка к месту, аватар) — только в dev-сборке.
const PanelTools = import.meta.env.DEV ? lazy(() => import('../editor/PanelTools')) : null;

/** Перейти к сущности из текста статьи: если она есть на текущей карте — ещё и подлететь к ней. */
function openEntity(id: string): void {
  const state = useApp.getState();
  const entity = state.world.entities[id];
  if (!entity) return;
  if (entity.locations.some((l) => l.map === state.mapId)) state.showOnMap(id);
  else state.select(id);
}

function EntityLink({ entity }: { entity: Entity }) {
  return (
    <button type="button" className="chip" onClick={() => openEntity(entity.id)} title={entity.summary || undefined}>
      {entity.avatar ? <img className="chip-avatar" src={assetUrl(entity.avatar.thumb)} alt="" /> : <KindIcon kind={entity.kind} />}
      <span>{entity.name}</span>
    </button>
  );
}

function resolve(world: WorldData, ids: string[]): Entity[] {
  return ids.map((id) => world.entities[id]).filter((e): e is Entity => Boolean(e));
}

/** Правая панель со статьёй о выбранной сущности (на телефоне — шторка снизу). */
export function EntityPanel() {
  const selectedId = useApp((s) => s.selectedId);
  const world = useApp((s) => s.world);
  const mapId = useApp((s) => s.mapId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const entity = selectedId ? world.entities[selectedId] : undefined;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { editing, picking, select } = useApp.getState();
      if (e.key === 'Escape' && !isTypingTarget(e.target) && !editing && !picking) select(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!entity) return null;

  const chain = ancestors(world, entity.id);
  const detailMap = entity.map ? world.maps[entity.map] : undefined;
  // Кто привязан к месту — в «Здесь находятся», а не дублируется среди вложенных.
  const residents = resolve(world, entity.residents);
  const children = groupByKind(resolve(world, entity.children.filter((id) => !entity.residents.includes(id))));
  const backlinks = resolve(world, entity.backlinks);
  const place = entity.location ? world.entities[entity.location] : undefined;
  const onCurrentMap = entity.locations.some((l) => l.map === mapId);
  const otherMaps = [...new Set(entity.locations.map((l) => l.map))].filter((m) => m !== mapId);

  // Вики-ссылки в тексте ведут на #/e/<id>; перехватываем, чтобы не терять текущую карту.
  const onArticleClick = (e: MouseEvent<HTMLElement>) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.wikilink[data-entity]');
    if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openEntity(link.dataset.entity!);
  };

  return (
    <aside className="panel" aria-label={`Статья: ${entity.name}`}>
      <div className="panel-scroll" ref={scrollRef}>
        <header className="panel-header">
          <div className="panel-kind">
            <KindIcon kind={entity.kind} />
            <span>{KINDS[entity.kind].label}</span>
            {entity.visibility === 'dm' && (
              <span className="badge badge-dm" title="Игроки этого не видят">
                только мастер
              </span>
            )}
          </div>
          <button type="button" className="icon-btn panel-close" onClick={() => useApp.getState().select(null)} aria-label="Закрыть" title="Закрыть (Esc)">
            ×
          </button>
        </header>

        {entity.avatar && <img className="panel-portrait" src={assetUrl(entity.avatar.full)} alt={entity.name} />}

        {chain.length > 0 && (
          <nav className="panel-crumbs" aria-label="Иерархия">
            {chain.map((a) => (
              <button key={a.id} type="button" onClick={() => openEntity(a.id)}>
                {a.name}
              </button>
            ))}
          </nav>
        )}
        <h1 className="panel-title">{entity.name}</h1>
        {entity.aliases.length > 0 && <div className="panel-aliases">Также: {entity.aliases.join(', ')}</div>}
        {place && (
          <div className="panel-place">
            <span aria-hidden="true">📍</span>
            <button type="button" onClick={() => openEntity(place.id)} title="Открыть статью места">
              {place.name}
            </button>
          </div>
        )}

        {entity.image && <img className="panel-image" src={assetUrl(entity.image)} alt={entity.name} />}

        {detailMap && (
          <button type="button" className="map-card" onClick={() => useApp.getState().openMap(detailMap.id)}>
            {detailMap.base ? (
              <img src={assetUrl(detailMap.base.preview, detailMap.base.version)} alt="" />
            ) : (
              <div className="map-card-empty">арт не нарезан</div>
            )}
            <span className="map-card-label">
              <span>Подробная карта</span>
              <strong>{detailMap.title} →</strong>
            </span>
          </button>
        )}

        <div className="panel-actions">
          {entity.locations.length > 0 && (
            <button type="button" className="btn" onClick={() => useApp.getState().showOnMap(entity.id)}>
              {onCurrentMap ? 'Показать на карте' : `На карте «${world.maps[otherMaps[0]!]?.title ?? otherMaps[0]}»`}
            </button>
          )}
          {import.meta.env.DEV && entity.source && (
            <button type="button" className="btn btn-ghost" onClick={() => openInCodeEditor(entity.source!)} title={entity.source}>
              Открыть .md
            </button>
          )}
        </div>

        {PanelTools && world.mode === 'dm' && entity.source && (
          <Suspense fallback={null}>
            <PanelTools key={entity.id} entity={entity} />
          </Suspense>
        )}

        {entity.facts.length > 0 && (
          <dl className="facts" onClick={onArticleClick}>
            {entity.facts.map((fact) => (
              <div key={fact.label} className="fact">
                <dt>{fact.label}</dt>
                <dd dangerouslySetInnerHTML={{ __html: fact.html }} />
              </div>
            ))}
          </dl>
        )}

        {entity.html ? (
          <article className="prose" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: entity.html }} />
        ) : (
          entity.summary && <p className="prose-summary">{entity.summary}</p>
        )}

        {residents.length > 0 && (
          <section className="panel-section">
            <h2>Здесь находятся</h2>
            <div className="chips">
              {residents.map((r) => (
                <EntityLink key={r.id} entity={r} />
              ))}
            </div>
          </section>
        )}

        {children.map((group) => (
          <section key={group.kind} className="panel-section">
            <h2>{KINDS[group.kind].plural}</h2>
            <div className="chips">
              {group.items.map((child) => (
                <EntityLink key={child.id} entity={child} />
              ))}
            </div>
          </section>
        ))}

        {backlinks.length > 0 && (
          <section className="panel-section">
            <h2>Упоминается в</h2>
            <div className="chips">
              {backlinks.map((b) => (
                <EntityLink key={b.id} entity={b} />
              ))}
            </div>
          </section>
        )}

        {entity.tags.length > 0 && (
          <div className="tags">
            {entity.tags.map((tag) => (
              <span key={tag} className="tag">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
