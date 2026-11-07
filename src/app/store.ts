/**
 * Глобальное состояние приложения (zustand). Источник правды для UI и карты;
 * src/app/router.ts синхронизирует его с адресной строкой.
 */
import { create } from 'zustand';
import initialWorld from 'virtual:world';
import type { WorldData } from '../shared/types';

/** Группы слоёв, которые можно включать/выключать (см. src/app/layers.ts). */
export type LayerKey = 'areas' | 'settlements' | 'places' | 'characters' | 'routes' | 'labels';

export interface HoverInfo {
  mapId: string;
  featureId: string;
  entityId: string | null;
  /** Позиция курсора в пикселях окна — для всплывающей карточки. */
  x: number;
  y: number;
}

/** Одноразовая просьба к карте «подлети к сущности»; nonce отличает повторные просьбы. */
export interface FocusRequest {
  entityId: string;
  nonce: number;
}

/** Режим «выберите место на карте» (dev: привязка персонажа к месту). */
export interface PickRequest {
  /** Кого привязываем — для подсказки. */
  entityId: string;
  onPick(locationId: string): void;
}

export interface AppState {
  world: WorldData;
  mapId: string;
  selectedId: string | null;
  hover: HoverInfo | null;
  focus: FocusRequest | null;
  layers: Record<LayerKey, boolean>;
  /** Включён режим редактирования (только dev). */
  editing: boolean;
  /** В редакторе есть несохранённые изменения. */
  editorDirty: boolean;
  /** Ждём клика по месту на карте. */
  picking: PickRequest | null;
  /** Проверка совмещения детальных врезок (dev): контуры и полупрозрачный арт. */
  insetDebug: boolean;

  /** Новые данные мира (HMR после правки файлов). */
  setWorld(world: WorldData): void;
  /** Перейти на карту; focusEntity — сразу выделить сущность и подлететь к ней. */
  openMap(mapId: string, focusEntity?: string | null): boolean;
  select(entityId: string | null): void;
  /** Выделить сущность и показать её на карте (при необходимости переключив карту). */
  showOnMap(entityId: string): void;
  setHover(hover: HoverInfo | null): void;
  toggleLayer(key: LayerKey): void;
  setEditing(editing: boolean): void;
  setEditorDirty(dirty: boolean): void;
  startPicking(request: PickRequest): void;
  /** Клик по месту в режиме выбора; true — клик обработан. */
  completePicking(locationId: string): boolean;
  cancelPicking(): void;
  toggleInsetDebug(): void;
}

let focusNonce = 0;

function confirmLeaveEditor(state: AppState): boolean {
  return !state.editorDirty || window.confirm('В редакторе есть несохранённые изменения. Уйти без сохранения?');
}

export const useApp = create<AppState>()((set, get) => ({
  world: initialWorld,
  mapId: initialWorld.maps[initialWorld.defaultMap] ? initialWorld.defaultMap : (Object.keys(initialWorld.maps)[0] ?? ''),
  selectedId: null,
  hover: null,
  focus: null,
  layers: { areas: true, settlements: true, places: true, characters: true, routes: true, labels: true },
  editing: false,
  editorDirty: false,
  picking: null,
  insetDebug: false,

  setWorld(world) {
    const { mapId, selectedId } = get();
    set({
      world,
      mapId: world.maps[mapId] ? mapId : world.defaultMap,
      selectedId: selectedId && world.entities[selectedId] ? selectedId : null,
      hover: null,
    });
  },

  openMap(mapId, focusEntity = null) {
    const state = get();
    if (!state.world.maps[mapId]) return false;
    if (mapId !== state.mapId && !confirmLeaveEditor(state)) return false;
    const entityOk = focusEntity && state.world.entities[focusEntity];
    set({
      mapId,
      hover: null,
      editing: mapId === state.mapId ? state.editing : false,
      editorDirty: mapId === state.mapId ? state.editorDirty : false,
      selectedId: entityOk ? focusEntity : mapId === state.mapId ? state.selectedId : null,
      focus: entityOk ? { entityId: focusEntity, nonce: ++focusNonce } : null,
    });
    return true;
  },

  select(entityId) {
    if (entityId !== null && !get().world.entities[entityId]) return;
    set({ selectedId: entityId });
  },

  showOnMap(entityId) {
    const { world, mapId } = get();
    const entity = world.entities[entityId];
    if (!entity) return;
    // Сначала текущая карта, затем любая другая, где сущность нарисована.
    const here = entity.locations.find((l) => l.map === mapId);
    const target = here ?? entity.locations[0];
    if (!target) {
      set({ selectedId: entityId });
      return;
    }
    if (target.map === mapId) set({ selectedId: entityId, focus: { entityId, nonce: ++focusNonce } });
    else get().openMap(target.map, entityId);
  },

  setHover(hover) {
    const prev = get().hover;
    if (prev === hover) return;
    if (prev && hover && prev.featureId === hover.featureId && prev.x === hover.x && prev.y === hover.y) return;
    set({ hover });
  },

  toggleLayer(key) {
    set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } }));
  },

  setEditing(editing) {
    const state = get();
    if (!editing && !confirmLeaveEditor(state)) return;
    set({ editing, editorDirty: editing ? state.editorDirty : false, hover: null });
  },

  setEditorDirty(editorDirty) {
    if (get().editorDirty !== editorDirty) set({ editorDirty });
  },

  startPicking(picking) {
    set({ picking, hover: null });
  },

  completePicking(locationId) {
    const { picking } = get();
    if (!picking) return false;
    if (locationId !== picking.entityId) {
      set({ picking: null });
      picking.onPick(locationId);
    }
    return true;
  },

  cancelPicking() {
    if (get().picking) set({ picking: null });
  },

  toggleInsetDebug() {
    set((s) => ({ insetDebug: !s.insetDebug }));
  },
}));

// Правки в world/ прилетают через HMR без перезагрузки страницы.
if (import.meta.hot) {
  import.meta.hot.accept('virtual:world', (mod) => {
    if (mod) useApp.getState().setWorld(mod.default as WorldData);
  });
}
