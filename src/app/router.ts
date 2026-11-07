/**
 * Синхронизация состояния с адресом (формат — src/app/route.ts).
 * Хеш-роутинг работает на любом статическом хостинге без настройки сервера.
 * Каждый переход по карте или статье — запись в истории, «Назад» в браузере работает как ожидается.
 */
import { preferredMap } from './model';
import { buildHash, parseHash, type Route } from './route';
import { useApp } from './store';

/** Применить маршрут к стору. false — переход отменён (несохранённые правки в редакторе). */
function applyRoute(route: Route): boolean {
  const state = useApp.getState();
  const entity = route.entityId ? state.world.entities[route.entityId] : undefined;
  let mapId = route.mapId && state.world.maps[route.mapId] ? route.mapId : null;
  if (!mapId && entity) mapId = preferredMap(entity, state.mapId);
  mapId ??= state.mapId;

  if (mapId !== state.mapId) return state.openMap(mapId, entity?.id ?? null);
  const entityId = entity?.id ?? null;
  if (entityId === state.selectedId) return true;
  if (entityId && entity?.locations.some((l) => l.map === mapId)) state.showOnMap(entityId);
  else state.select(entityId);
  return true;
}

let applying = false;

function currentHash(): string {
  const { mapId, selectedId } = useApp.getState();
  return buildHash({ mapId, entityId: selectedId });
}

function onLocationChange(): void {
  if (location.hash === currentHash()) return;
  applying = true;
  const ok = applyRoute(parseHash(location.hash));
  applying = false;
  // Переход отменён или адрес неполный — приводим адрес к фактическому состоянию.
  if (!ok || location.hash !== currentHash()) history.replaceState(null, '', currentHash());
}

export function startRouter(): void {
  applying = true;
  applyRoute(parseHash(location.hash));
  applying = false;
  history.replaceState(null, '', currentHash());

  window.addEventListener('popstate', onLocationChange);
  window.addEventListener('hashchange', onLocationChange);

  useApp.subscribe((state, prev) => {
    if (applying || (state.mapId === prev.mapId && state.selectedId === prev.selectedId)) return;
    const hash = currentHash();
    if (hash !== location.hash) history.pushState(null, '', hash);
  });
}
