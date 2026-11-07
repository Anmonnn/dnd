import { useEffect } from 'react';
import { EntityPanel } from './components/EntityPanel';
import { HoverCard } from './components/HoverCard';
import { TopBar } from './components/TopBar';
import { MapView } from './map/MapView';
import { useApp } from './store';

/** Подсказка режима «выберите место на карте» (привязка персонажа к месту). */
function PickBanner() {
  const picking = useApp((s) => s.picking);
  const name = useApp((s) => (s.picking ? s.world.entities[s.picking.entityId]?.name : undefined));

  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useApp.getState().cancelPicking();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [picking]);

  if (!picking) return null;
  return (
    <div className="pick-banner" role="status">
      <span>
        Кликните по месту на карте, к которому привязать «{name ?? picking.entityId}»
      </span>
      <button type="button" className="btn btn-ghost" onClick={() => useApp.getState().cancelPicking()}>
        Отмена (Esc)
      </button>
    </div>
  );
}

export function App() {
  const title = useApp((s) => s.world.title);
  const mapTitle = useApp((s) => s.world.maps[s.mapId]?.title);
  const entityName = useApp((s) => (s.selectedId ? s.world.entities[s.selectedId]?.name : undefined));
  const hasPanel = useApp((s) => s.selectedId !== null);
  const editing = useApp((s) => s.editing);
  const picking = useApp((s) => s.picking !== null);

  useEffect(() => {
    document.title = [entityName, mapTitle !== title ? mapTitle : undefined, title].filter(Boolean).join(' — ');
  }, [title, mapTitle, entityName]);

  return (
    <div className={`app${hasPanel ? ' has-panel' : ''}${editing ? ' is-editing' : ''}${picking ? ' is-picking' : ''}`}>
      <TopBar />
      <MapView />
      <HoverCard />
      <EntityPanel />
      <PickBanner />
    </div>
  );
}
