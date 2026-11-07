import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { MapController } from './MapController';

// Редактор существует только в dev-сборке: в production и импорт, и Geoman вырезаются целиком.
const Editor = import.meta.env.DEV ? lazy(() => import('../editor/Editor')) : null;

/** Geoman вешает map.pm в init-хуке Leaflet, поэтому должен загрузиться ДО создания карты. */
async function loadEditorDeps(): Promise<void> {
  if (import.meta.env.DEV && useApp.getState().world.mode === 'dm') {
    await import('@geoman-io/leaflet-geoman-free');
  }
}

export function MapView() {
  const mapId = useApp((s) => s.mapId);
  const def = useApp((s) => s.world.maps[s.mapId]);
  const world = useApp((s) => s.world);
  const layers = useApp((s) => s.layers);
  const selectedId = useApp((s) => s.selectedId);
  const focus = useApp((s) => s.focus);
  const insetDebug = useApp((s) => s.insetDebug);
  const containerRef = useRef<HTMLDivElement>(null);
  const [controller, setController] = useState<MapController | null>(null);

  // Пересоздаём Leaflet-карту, только когда меняется то, что задаёт её CRS и пределы зума.
  const geometryKey = def ? `${def.id}|${def.width}x${def.height}|${def.zoomBase}|${def.base?.tiles.maxNativeZoom ?? '-'}` : '';

  useEffect(() => {
    if (!geometryKey) return;
    let cancelled = false;
    let created: MapController | null = null;
    void loadEditorDeps().then(() => {
      const container = containerRef.current;
      const state = useApp.getState();
      const current = state.world.maps[state.mapId];
      if (cancelled || !container || !current) return;
      created = new MapController(container, current, state.world, state.layers);
      created.setSelected(state.selectedId);
      setController(created);
    });
    return () => {
      cancelled = true;
      created?.destroy();
      setController(null);
    };
  }, [geometryKey]);

  useEffect(() => {
    if (controller && def) controller.update(def, world);
  }, [controller, def, world]);

  useEffect(() => controller?.setLayers(layers), [controller, layers]);
  useEffect(() => controller?.setSelected(selectedId), [controller, selectedId]);
  useEffect(() => controller?.setInsetDebug(insetDebug), [controller, insetDebug]);
  useEffect(() => {
    if (controller && focus) controller.focusEntity(focus.entityId);
  }, [controller, focus]);

  if (!def) {
    return (
      <main className="map-root map-empty">
        <p>Нет ни одной карты. Создайте папку world/maps/&lt;id&gt;/ с map.json и артом.</p>
      </main>
    );
  }

  return (
    <main className="map-root">
      <div ref={containerRef} className="map-container" />
      {!def.base && (
        <div className="map-notice" role="status">
          Подложка карты «{def.title}» ещё не нарезана — запустите <code>npm run maps</code>.
        </div>
      )}
      {Editor && world.mode === 'dm' && controller && controller.mapId === mapId && (
        <Suspense fallback={null}>
          <Editor key={controller.mapId} host={controller} />
        </Suspense>
      )}
    </main>
  );
}
