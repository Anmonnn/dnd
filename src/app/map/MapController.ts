/**
 * Императивный движок карты на Leaflet: подложка (превью + тайлы), слои объектов, наведение,
 * выделение, перелёты к объектам, видимость по уровню детализации.
 * Один экземпляр на одну карту — при переходе на другую карту создаётся новый (у карт разные CRS).
 * React-обёртка — MapView.tsx; связь с UI — через zustand-стор.
 */
import L from 'leaflet';
import { isAreaKind } from '../../shared/kinds';
import type { MapDef, MapFeature, MapInset, MapPin, WorldData } from '../../shared/types';
import { INSET_FADE, OVERZOOM_LEVELS, minZoomForDetail } from '../../shared/zoom';
import { LAYER_ORDER, layerOf } from '../layers';
import { useApp, type LayerKey } from '../store';
import { createCrs, geometryBounds, lineLatLngs, mapBounds, polygonLatLngs, toLatLng } from './crs';
import type { EditorHost } from './editor-host';
import { escapeHtml, markerHtml, pinGroupHtml } from './icons';

const BASE_URL = import.meta.env.BASE_URL;
/** Ширина правой панели (совпадает с --panel-w в CSS) и порог мобильной вёрстки. */
const PANEL_WIDTH = 420;
const MOBILE_MAX_WIDTH = 720;
const TOPBAR_HEIGHT = 60;
/** Кружков у одного места в ряд; если больше — последний превращается в «+N». */
const MAX_PINS = 5;

type VisualState = 'normal' | 'hover' | 'selected';

interface FeatureView {
  feature: MapFeature;
  group: LayerKey;
  /** Видимая фигура: маркер, полигон или линия. */
  shape: L.Marker | L.Path;
  /** Невидимая «толстая» линия для удобного наведения на дороги. */
  hit: L.Polyline | null;
  label: L.Marker | null;
  /** Для кружков: место, к которому кружок прикреплён на этой карте. */
  anchor?: string;
  /** Для кружков: id кружка в ряду (элемент [data-pin] внутри маркера места). */
  pinItem?: string;
}

/**
 * Предел зума: на OVERZOOM_LEVELS глубже нативного разрешения арта карты, но не мельче, чем нужно,
 * чтобы рассмотреть самую детальную врезку (её нативный уровень + 1).
 */
function maxZoomFor(def: MapDef): number {
  const native = Math.max(def.base?.tiles.maxNativeZoom ?? def.zoomBase, def.zoomBase);
  const insets = def.insets.map((i) => (i.tiles ? i.tiles.maxNativeZoom + 1 : -Infinity));
  return Math.max(native + OVERZOOM_LEVELS, ...insets);
}

interface InsetView {
  def: MapInset;
  layer: L.TileLayer | null;
  outline: L.Rectangle | null;
}

const mediaUrl = (url: string) => (/^(https?:)?\/\/|^data:/i.test(url) ? url : BASE_URL + url);

const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function areaStyle(feature: MapFeature, state: VisualState): L.PathOptions {
  const color = feature.color ?? '#e3b55a';
  let weight = 1.8;
  let fillOpacity = 0.1;
  let dashArray: string | undefined;
  if (feature.kind === 'region') {
    weight = 1.4;
    fillOpacity = 0.04;
    dashArray = '6 6';
  } else if (feature.kind === 'district') {
    weight = 1.4;
    fillOpacity = 0.14;
  }
  if (state === 'hover') return { color, fillColor: color, weight: weight + 1, opacity: 1, fillOpacity: fillOpacity + 0.16, dashArray };
  if (state === 'selected') return { color, fillColor: color, weight: weight + 1.6, opacity: 1, fillOpacity: fillOpacity + 0.22, dashArray };
  return { color, fillColor: color, weight, opacity: 0.85, fillOpacity, dashArray };
}

function routeStyle(feature: MapFeature, state: VisualState): L.PathOptions {
  // Пунктир — только у путей; линии других типов (стены, реки) сплошные.
  if (feature.kind !== 'route') {
    const color = feature.color ?? '#e6dcc4';
    const weight = state === 'normal' ? 3.2 : 4.6;
    return { color: state === 'selected' ? '#ffd27a' : color, weight, opacity: state === 'normal' ? 0.95 : 1, lineCap: 'round', lineJoin: 'round' };
  }
  const color = feature.color ?? '#f3e2b3';
  if (state === 'normal') return { color, weight: 2.6, opacity: 0.9, dashArray: '1 7', lineCap: 'round' };
  return { color: state === 'selected' ? '#ffd27a' : color, weight: 4, opacity: 1, dashArray: '1 8', lineCap: 'round' };
}

export class MapController implements EditorHost {
  readonly map: L.Map;
  readonly mapId: string;

  private def: MapDef;
  private world: WorldData;
  private readonly bounds: L.LatLngBounds;
  private readonly groups: Record<LayerKey, L.LayerGroup>;
  private baseLayers: L.Layer[] = [];
  private baseVersion: string | null = null;
  private insetViews: InsetView[] = [];
  private insetKey = '';
  private insetDebug = false;
  private views = new Map<string, FeatureView>();
  private byEntity = new Map<string, FeatureView[]>();
  private layerToggles: Record<LayerKey, boolean>;
  private viewLayersVisible = true;
  private selectedId: string | null = null;
  private hoveredFeature: string | null = null;
  private pointerFrame = 0;
  private destroyed = false;

  constructor(container: HTMLElement, def: MapDef, world: WorldData, layers: Record<LayerKey, boolean>) {
    this.def = def;
    this.world = world;
    this.mapId = def.id;
    this.layerToggles = { ...layers };
    this.bounds = mapBounds(def);

    this.map = L.map(container, {
      crs: createCrs(def.zoomBase),
      minZoom: def.zoomBase - 3,
      maxZoom: maxZoomFor(def),
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 100,
      zoomControl: false,
      attributionControl: false,
      maxBounds: this.bounds.pad(0.35),
      maxBoundsViscosity: 0.8,
      // Карте нужен map.pm (Geoman) для dev-редактора; слои просмотра помечены pmIgnore.
      pmIgnore: false,
    });
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(this.map);
    this.addHomeControl();

    this.map.createPane('basePreview').style.zIndex = '150';
    // Врезки — над тайлами карты (tilePane = 200), под всеми векторными слоями.
    this.map.createPane('insets').style.zIndex = '250';
    this.map.createPane('areas').style.zIndex = '410';
    this.map.createPane('routes').style.zIndex = '420';
    this.map.createPane('pins').style.zIndex = '640';
    const labelsPane = this.map.createPane('areaLabels');
    labelsPane.style.zIndex = '430';
    labelsPane.style.pointerEvents = 'none';

    this.groups = Object.fromEntries(LAYER_ORDER.map((k) => [k, L.layerGroup([], { pmIgnore: true })])) as Record<LayerKey, L.LayerGroup>;

    container.style.background = def.background;
    container.setAttribute('aria-label', `Карта: ${def.title}`);
    this.fitToMap();
    this.renderBase();
    this.renderInsets();
    this.renderFeatures();
    this.applyLayerVisibility();

    this.map.on('zoomend', this.onZoom);
    // Проявление врезок: zoomanim — сразу к целевому зуму (CSS-переход идёт вместе с анимацией),
    // zoom — по кадрам во время flyTo.
    this.map.on('zoomanim', (e: L.ZoomAnimEvent) => this.updateInsets(e.zoom, false));
    this.map.on('zoom', () => this.updateInsets(this.map.getZoom(), false));
    this.map.on('resize', this.updateMinZoom);
    this.map.on('click', this.onMapClick);
    L.DomEvent.on(container, 'mousemove', this.onPointerMove as L.DomEvent.EventHandlerFn);
    this.onZoom();
  }

  /** Новые данные той же карты (HMR): перерисовать подложку и объекты, сохранив вид. */
  update(def: MapDef, world: WorldData): void {
    if (this.destroyed || (def === this.def && world === this.world)) return;
    this.def = def;
    this.world = world;
    this.map.getContainer().style.background = def.background;
    this.map.setMaxZoom(maxZoomFor(def));
    this.renderBase();
    this.renderInsets();
    this.renderFeatures();
  }

  /** Режим проверки совмещения врезок (dev): контуры и полупрозрачный арт на любом зуме. */
  setInsetDebug(on: boolean): void {
    if (this.destroyed || on === this.insetDebug) return;
    this.insetDebug = on;
    this.updateInsets(this.map.getZoom(), true);
  }

  /** Показать карту целиком. */
  showWholeMap(): void {
    if (this.destroyed) return;
    const panelOpen = window.innerWidth > MOBILE_MAX_WIDTH && useApp.getState().selectedId !== null;
    this.map.flyToBounds(this.bounds, {
      paddingTopLeft: [16, TOPBAR_HEIGHT + 8],
      paddingBottomRight: [16 + (panelOpen ? PANEL_WIDTH : 0), 16],
      duration: 0.8,
    });
  }

  setLayers(layers: Record<LayerKey, boolean>): void {
    if (this.destroyed) return;
    this.layerToggles = { ...layers };
    this.applyLayerVisibility();
  }

  setViewLayersVisible(visible: boolean): void {
    if (this.destroyed) return;
    this.viewLayersVisible = visible;
    if (!visible) this.clearHover();
    this.applyLayerVisibility();
  }

  setSelected(entityId: string | null): void {
    if (this.destroyed || entityId === this.selectedId) return;
    const previous = this.selectedId;
    this.selectedId = entityId;
    for (const id of [previous, entityId]) {
      if (id) for (const view of this.byEntity.get(id) ?? []) this.restyle(view);
    }
  }

  /** Подлететь к объекту(ам) сущности с учётом панели справа и верхней шапки. */
  focusEntity(entityId: string): void {
    if (this.destroyed) return;
    const views = this.byEntity.get(entityId);
    if (!views?.length) return;

    // Если слой объекта выключен — включаем, иначе подлетать некуда.
    const store = useApp.getState();
    for (const view of views) if (!store.layers[view.group]) store.toggleLayer(view.group);

    const bounds = L.latLngBounds([]);
    for (const view of views) {
      const b = geometryBounds(view.feature.display);
      if (b) bounds.extend(b);
    }
    if (!bounds.isValid()) return;

    const panelOpen = window.innerWidth > MOBILE_MAX_WIDTH && store.selectedId !== null;
    const rightInset = panelOpen ? PANEL_WIDTH : 0;
    const sizePx = this.map.latLngToContainerPoint(bounds.getSouthEast()).distanceTo(this.map.latLngToContainerPoint(bounds.getNorthWest()));
    const isPointLike = sizePx < 40 || views.every((v) => v.feature.display.type === 'Point');

    if (isPointLike) {
      const detail = Math.max(...views.map((v) => v.feature.detail)) as 0 | 1 | 2;
      const targetZoom = Math.min(
        this.map.getMaxZoom() - 1,
        Math.max(this.map.getZoom(), this.def.zoomBase + 0.5, minZoomForDetail(detail, this.def.zoomBase) + 0.25),
      );
      // Смещаем центр так, чтобы точка оказалась в центре видимой (не закрытой панелью) области.
      const target = this.map.project(bounds.getCenter(), targetZoom).add([rightInset / 2, -TOPBAR_HEIGHT / 2]);
      this.map.flyTo(this.map.unproject(target, targetZoom), targetZoom, { duration: 0.8 });
    } else {
      this.flyToArea(bounds, rightInset);
    }
    for (const view of views) this.pulse(view);
  }

  /** Развернуть область на весь видимый экран (с учётом шапки и панели справа). */
  private flyToArea(bounds: L.LatLngBounds, rightInset: number): void {
    this.map.flyToBounds(bounds, {
      paddingTopLeft: [40, TOPBAR_HEIGHT + 30],
      paddingBottomRight: [40 + rightInset, 40],
      // Не глубже, чем есть детали: маленькую область не раздуваем до мыла.
      maxZoom: Math.min(this.map.getMaxZoom() - 0.25, this.def.zoomBase + 3),
      duration: 0.8,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.pointerFrame);
    L.DomEvent.off(this.map.getContainer(), 'mousemove', this.onPointerMove as L.DomEvent.EventHandlerFn);
    this.clearHover();
    this.map.off();
    this.map.remove();
  }

  // ─── подложка ──────────────────────────────────────────────────────────────

  private fitToMap(): void {
    this.updateMinZoom();
    this.map.fitBounds(this.bounds, { paddingTopLeft: [16, TOPBAR_HEIGHT + 8], paddingBottomRight: [16, 16], animate: false });
  }

  private updateMinZoom = (): void => {
    const fit = this.map.getBoundsZoom(this.bounds, false, L.point(32, TOPBAR_HEIGHT + 24));
    this.map.setMinZoom(Math.floor((fit - 0.75) * 4) / 4);
  };

  private renderBase(): void {
    const base = this.def.base;
    const version = base?.version ?? null;
    if (version === this.baseVersion && (this.baseLayers.length > 0 || !base)) return;
    for (const layer of this.baseLayers) layer.remove();
    this.baseLayers = [];
    this.baseVersion = version;
    this.map.getContainer().classList.toggle('no-art', !base);
    if (!base) return;

    const query = `?v=${encodeURIComponent(base.version)}`;
    // Превью всей карты под тайлами: мгновенная картинка, пока грузятся детали.
    const preview = L.imageOverlay(BASE_URL + base.preview + query, this.bounds, {
      pane: 'basePreview',
      interactive: false,
      className: 'map-preview',
      pmIgnore: true,
    });
    const tiles = L.tileLayer(BASE_URL + base.tiles.url + query, {
      tileSize: base.tiles.tileSize,
      minNativeZoom: 0,
      maxNativeZoom: base.tiles.maxNativeZoom,
      minZoom: -10,
      // Предел самой карты может вырасти (появилась детальная врезка) — слой не должен пропадать.
      maxZoom: 30,
      noWrap: true,
      bounds: this.bounds,
      keepBuffer: 3,
      className: 'map-tiles',
      pmIgnore: true,
    });
    preview.addTo(this.map);
    tiles.addTo(this.map);
    this.baseLayers = [preview, tiles];
  }

  private addHomeControl(): void {
    const control = new L.Control({ position: 'bottomright' });
    control.onAdd = () => {
      const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control map-home');
      const button = L.DomUtil.create('a', '', bar);
      button.href = '#';
      button.title = 'Вся карта';
      button.setAttribute('role', 'button');
      button.setAttribute('aria-label', 'Показать всю карту');
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(button, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        this.showWholeMap();
      });
      return bar;
    };
    control.addTo(this.map);
  }

  // ─── детальные врезки ─────────────────────────────────────────────────────

  private renderInsets(): void {
    const key = JSON.stringify(this.def.insets.map((i) => [i.id, i.bounds, i.version, i.showFrom, i.tiles?.url]));
    if (key === this.insetKey) return;
    this.insetKey = key;
    for (const view of this.insetViews) {
      view.layer?.remove();
      view.outline?.remove();
    }
    this.insetViews = this.def.insets.map((def) => ({ def, layer: null, outline: null }));
    this.updateInsets(this.map.getZoom(), true);
  }

  /**
   * Прозрачность врезок по зуму: 0 до (showFrom − INSET_FADE), 1 с showFrom. Слой создаётся, только когда
   * врезку пора показывать (иначе её тайлы грузились бы и на обзорной карте), и убирается в конце
   * анимации, когда она снова не видна (allowRemove) — раньше нельзя, оборвётся плавное исчезновение.
   */
  private updateInsets(zoom: number, allowRemove: boolean): void {
    if (this.destroyed) return;
    for (const view of this.insetViews) {
      const { tiles, bounds, showFrom, version, title } = view.def;
      const latLngs = L.latLngBounds([bounds[1], bounds[0]], [bounds[1] + bounds[3], bounds[0] + bounds[2]]);
      const opacity = !tiles ? 0 : this.insetDebug ? 0.6 : Math.min(1, Math.max(0, (zoom - (showFrom - INSET_FADE)) / INSET_FADE));
      if (tiles && opacity > 0) {
        if (!view.layer) {
          view.layer = L.tileLayer(BASE_URL + tiles.url + (version ? `?v=${encodeURIComponent(version)}` : ''), {
            tileSize: tiles.tileSize,
            minNativeZoom: tiles.minNativeZoom,
            maxNativeZoom: tiles.maxNativeZoom,
            minZoom: -10,
            maxZoom: 30,
            noWrap: true,
            bounds: latLngs,
            pane: 'insets',
            className: 'map-inset',
            opacity: 0,
            keepBuffer: 2,
            pmIgnore: true,
          }).addTo(this.map);
        }
        view.layer.setOpacity(opacity);
      } else if (view.layer) {
        if (allowRemove) {
          view.layer.remove();
          view.layer = null;
        } else view.layer.setOpacity(0);
      }

      if (this.insetDebug && !view.outline) {
        view.outline = L.rectangle(latLngs, {
          pane: 'areaLabels',
          color: tiles ? '#7fd1c7' : '#e8a94a',
          weight: 1.5,
          dashArray: '6 5',
          fill: false,
          interactive: false,
          pmIgnore: true,
        })
          .bindTooltip(`${title}${tiles ? '' : ' — арта ещё нет'}`, { permanent: true, direction: 'center', className: 'inset-label' })
          .addTo(this.map);
      } else if (!this.insetDebug && view.outline) {
        view.outline.remove();
        view.outline = null;
      }
    }
  }

  // ─── объекты ───────────────────────────────────────────────────────────────

  private renderFeatures(): void {
    for (const group of Object.values(this.groups)) group.clearLayers();
    this.views.clear();
    this.byEntity.clear();
    if (this.hoveredFeature) this.clearHover();

    for (const feature of this.def.features) {
      const view = this.createView(feature);
      if (!view) continue;
      this.views.set(feature.id, view);
      if (feature.entity) {
        const list = this.byEntity.get(feature.entity) ?? [];
        list.push(view);
        this.byEntity.set(feature.entity, list);
      }
      const group = this.groups[view.group];
      group.addLayer(view.shape);
      if (view.hit) group.addLayer(view.hit);
      if (view.label) group.addLayer(view.label);
      this.restyle(view);
    }
    this.renderPins();
  }

  /** Кружки сущностей, привязанных к местам: по ряду на место, лишние — в «+N». */
  private renderPins(): void {
    const groups = new Map<string, MapPin[]>();
    for (const pin of this.def.pins) {
      if (!this.world.entities[pin.entity]) continue;
      groups.set(pin.feature, [...(groups.get(pin.feature) ?? []), pin]);
    }
    for (const pins of groups.values()) this.addPinGroup(pins);
  }

  /** Один маркер на место; наведение и клик — по каждому кружку отдельно (обработчики на элементах ряда). */
  private addPinGroup(pins: MapPin[]): void {
    // Группы игроков — первыми в ряду.
    pins = [...pins].sort((a, b) => Number(this.world.entities[b.entity]!.kind === 'party') - Number(this.world.entities[a.entity]!.kind === 'party'));
    const first = pins[0]!;
    const shown = pins.length > MAX_PINS ? pins.slice(0, MAX_PINS - 1) : pins;
    const thumb = (id: string) => {
      const e = this.world.entities[id];
      return e?.avatar ? mediaUrl(e.avatar.thumb) : null;
    };
    const items = shown.map((pin) => {
      const entity = this.world.entities[pin.entity]!;
      // Участники группы — персонажи с parent: <группа>.
      const party =
        entity.kind === 'party'
          ? {
              color: entity.color,
              members: entity.children
                .map((id) => this.world.entities[id])
                .filter((m) => m?.kind === 'character')
                .map((m) => ({ name: m!.name, avatar: thumb(m!.id) })),
            }
          : undefined;
      return { id: pin.id, entity: pin.entity, name: entity.name, avatar: thumb(pin.entity), party };
    });
    const marker = L.marker(toLatLng(first.at), {
      icon: L.divIcon({
        className: `pin-icon d-${first.detail}`,
        html: pinGroupHtml(items, pins.length - shown.length, first.placement),
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      pane: 'pins',
      keyboard: false,
      bubblingMouseEvents: false,
      pmIgnore: true,
    });

    const views = shown.map((pin) => {
      const entity = this.world.entities[pin.entity]!;
      const point = { type: 'Point' as const, coordinates: pin.at };
      const view: FeatureView = {
        feature: { id: pin.id, entity: pin.entity, kind: entity.kind, name: entity.name, detail: pin.detail, color: null, geometry: point, display: point, labelAt: null, props: {} },
        group: 'characters',
        shape: marker,
        hit: null,
        label: null,
        anchor: pin.anchor,
        pinItem: pin.id,
      };
      this.views.set(pin.id, view);
      this.byEntity.set(pin.entity, [...(this.byEntity.get(pin.entity) ?? []), view]);
      return view;
    });

    const openMore = () => {
      const store = useApp.getState();
      if (store.picking) store.completePicking(first.anchor);
      else if (!store.editing) store.select(first.anchor);
    };
    // Leaflet пересоздаёт DOM иконки при каждом добавлении на карту — обработчики вешаем заново.
    marker.on('add', () => {
      const el = marker.getElement();
      if (!el) return;
      for (const view of views) {
        const item = el.querySelector<HTMLElement>(`[data-pin="${view.pinItem}"]`);
        if (!item) continue;
        item.addEventListener('mouseenter', (event) => this.onHover(view, event));
        item.addEventListener('mouseleave', () => this.onHoverEnd(view));
        item.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          this.onFeatureClick(view);
        });
        this.restyle(view);
      }
      el.querySelector<HTMLElement>('[data-more]')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openMore();
      });
    });
    marker.on('click', (event: L.LeafletMouseEvent) => {
      const item = (event.originalEvent.target as Element | null)?.closest<HTMLElement>('[data-pin],[data-more]');
      if (!item) return;
      if (item.dataset.more) return openMore();
      const view = this.views.get(item.dataset.pin!);
      if (view) this.onFeatureClick(view);
    });
    this.groups.characters.addLayer(marker);
  }

  private createView(feature: MapFeature): FeatureView | null {
    const group = layerOf(feature.kind);
    const detail = `d-${feature.detail}`;
    const entity = feature.entity ? this.world.entities[feature.entity] : undefined;
    const geometry = feature.display;

    if (geometry.type === 'Point') {
      // Водоёмы и надписи-области без статьи («Дальше живут драконы») — только текст, без значка.
      const textOnly = feature.kind === 'water' || (!entity && isAreaKind(feature.kind));
      const icon = L.divIcon({
        className: `mk mk-${feature.kind} ${detail}${entity ? '' : ' mk-plain'}${textOnly ? ' mk-text' : ''}`,
        html: markerHtml(feature.kind, feature.name, entity?.icon ?? null, textOnly, feature.color),
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      const marker = L.marker(toLatLng(geometry.coordinates), {
        icon,
        interactive: Boolean(entity) || !textOnly,
        keyboard: Boolean(entity),
        riseOnHover: true,
        bubblingMouseEvents: false,
        alt: feature.name,
        pmIgnore: true,
      });
      const view: FeatureView = { feature, group, shape: marker, hit: null, label: null };
      // Leaflet пересоздаёт DOM иконки при каждом добавлении на карту — восстанавливаем классы состояния.
      marker.on('add', () => this.restyle(view));
      this.bindInteraction(marker, view);
      return view;
    }

    const rings = polygonLatLngs(geometry);
    if (rings) {
      const polygon = L.polygon(rings, {
        ...areaStyle(feature, 'normal'),
        pane: 'areas',
        className: `area area-${feature.kind} ${detail}`,
        bubblingMouseEvents: false,
        smoothFactor: 0.6,
        pmIgnore: true,
      });
      const label =
        feature.labelAt && feature.name
          ? L.marker(toLatLng(feature.labelAt), {
              icon: L.divIcon({
                className: `area-label area-label-${feature.kind} ${detail}`,
                html: `<span>${escapeHtml(feature.name)}</span>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              }),
              pane: 'areaLabels',
              interactive: false,
              keyboard: false,
              pmIgnore: true,
            })
          : null;
      const view: FeatureView = { feature, group, shape: polygon, hit: null, label };
      this.bindInteraction(polygon, view);
      return view;
    }

    const lines = lineLatLngs(geometry);
    if (lines) {
      const line = L.polyline(lines, {
        ...routeStyle(feature, 'normal'),
        pane: 'routes',
        className: `route ${detail}`,
        interactive: false,
        pmIgnore: true,
      });
      const hit = L.polyline(lines, {
        pane: 'routes',
        className: `route-hit ${detail}`,
        weight: 14,
        opacity: 0,
        bubblingMouseEvents: false,
        pmIgnore: true,
      });
      const view: FeatureView = { feature, group, shape: line, hit, label: null };
      this.bindInteraction(hit, view);
      return view;
    }
    return null;
  }

  private bindInteraction(layer: L.Layer, view: FeatureView): void {
    layer.on('mouseover', (e: L.LeafletMouseEvent) => this.onHover(view, e.originalEvent));
    layer.on('mouseout', () => this.onHoverEnd(view));
    layer.on('click', () => this.onFeatureClick(view));
    layer.on('dblclick', () => this.onFeatureDblClick(view));
  }

  private restyle(view: FeatureView): void {
    const { feature } = view;
    const state: VisualState =
      feature.entity && feature.entity === this.selectedId ? 'selected' : this.hoveredFeature === feature.id ? 'hover' : 'normal';
    if (view.shape instanceof L.Marker) {
      const el = this.markerElement(view);
      el?.classList.toggle('is-selected', state === 'selected');
      el?.classList.toggle('is-hover', state === 'hover');
      // Ряд кружков поднимается над соседями, пока в нём есть выбранный.
      const raised = view.pinItem ? Boolean(view.shape.getElement()?.querySelector('.pin.is-selected')) : state === 'selected';
      view.shape.setZIndexOffset(raised ? 1000 : 0);
    } else if (isAreaKind(feature.kind) || feature.display.type === 'Polygon' || feature.display.type === 'MultiPolygon') {
      view.shape.setStyle(areaStyle(feature, state));
    } else {
      view.shape.setStyle(routeStyle(feature, state));
    }
  }

  /** DOM-элемент маркера; для кружка в ряду — элемент именно этого кружка. */
  private markerElement(view: FeatureView): HTMLElement | null {
    if (!(view.shape instanceof L.Marker)) return null;
    const el = view.shape.getElement() ?? null;
    return view.pinItem ? (el?.querySelector<HTMLElement>(`[data-pin="${view.pinItem}"]`) ?? null) : el;
  }

  private pulse(view: FeatureView): void {
    const el = this.markerElement(view);
    if (!el) return;
    el.classList.remove('is-pulse');
    void el.offsetWidth; // перезапуск CSS-анимации
    el.classList.add('is-pulse');
    window.setTimeout(() => el.classList.remove('is-pulse'), 2600);
  }

  private applyLayerVisibility(): void {
    for (const key of LAYER_ORDER) {
      const group = this.groups[key];
      const visible = this.viewLayersVisible && this.layerToggles[key];
      if (visible && !this.map.hasLayer(group)) group.addTo(this.map);
      if (!visible && this.map.hasLayer(group)) group.remove();
    }
    this.map.getContainer().classList.toggle('labels-off', !this.layerToggles.labels);
  }

  // ─── события ───────────────────────────────────────────────────────────────

  private onHover(view: FeatureView, event: MouseEvent): void {
    if (!canHover || useApp.getState().editing) return;
    const previous = this.hoveredFeature ? this.views.get(this.hoveredFeature) : undefined;
    this.hoveredFeature = view.feature.id;
    if (previous && previous !== view) this.restyle(previous);
    this.restyle(view);
    useApp.getState().setHover({
      mapId: this.mapId,
      featureId: view.feature.id,
      entityId: view.feature.entity,
      x: event.clientX,
      y: event.clientY,
    });
  }

  private onHoverEnd(view: FeatureView): void {
    if (this.hoveredFeature !== view.feature.id) return;
    this.clearHover();
  }

  private clearHover(): void {
    const view = this.hoveredFeature ? this.views.get(this.hoveredFeature) : undefined;
    this.hoveredFeature = null;
    if (view) this.restyle(view);
    if (useApp.getState().hover?.mapId === this.mapId) useApp.getState().setHover(null);
  }

  private onPointerMove = (event: MouseEvent): void => {
    if (!this.hoveredFeature) return;
    const { clientX, clientY } = event;
    cancelAnimationFrame(this.pointerFrame);
    this.pointerFrame = requestAnimationFrame(() => {
      const hover = useApp.getState().hover;
      if (hover && hover.featureId === this.hoveredFeature) useApp.getState().setHover({ ...hover, x: clientX, y: clientY });
    });
  };

  private onFeatureClick(view: FeatureView): void {
    const store = useApp.getState();
    if (store.editing) return;
    // Режим выбора места: кружок персонажа означает место, к которому он прикреплён.
    const place = view.anchor ?? view.feature.entity;
    if (store.picking) {
      if (place) store.completePicking(place);
      return;
    }
    if (!view.feature.entity) return;
    store.select(view.feature.entity);
    // Клик по области (государству, региону) разворачивает её на весь экран — там проявится её врезка.
    const g = view.feature.display;
    if (!view.pinItem && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
      const bounds = geometryBounds(g);
      if (bounds) this.flyToArea(bounds, window.innerWidth > MOBILE_MAX_WIDTH ? PANEL_WIDTH : 0);
    }
  }

  private onFeatureDblClick(view: FeatureView): void {
    const store = useApp.getState();
    if (store.editing || !view.feature.entity) return;
    const target = store.world.entities[view.feature.entity]?.map;
    if (target && store.world.maps[target]) store.openMap(target);
  }

  private onMapClick = (): void => {
    const store = useApp.getState();
    if (!store.editing && !store.picking && store.selectedId) store.select(null);
  };

  private onZoom = (): void => {
    const zoom = this.map.getZoom();
    const base = this.def.zoomBase;
    const container = this.map.getContainer();
    container.classList.toggle('show-d1', zoom >= minZoomForDetail(1, base));
    container.classList.toggle('show-d2', zoom >= minZoomForDetail(2, base));
    container.style.setProperty('--label-scale', String(Math.min(2.2, Math.max(0.62, 2 ** ((zoom - base) / 2)))));
    this.updateInsets(zoom, true);
  };
}
