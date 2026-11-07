/**
 * Работа редактора с Leaflet-Geoman: редактируемые слои из сырой геометрии объектов,
 * инструменты рисования/правки, сбор результата для сохранения.
 */
import L from 'leaflet';
import type { MapFeature } from '../../shared/types';
import type { EditorHost } from '../map/editor-host';
import type { EditorFeature } from './features';
import { isEditableGeometry, shapeOf, toLeafletShape, type EditableGeometry, type ShapeKind } from './geometry';
import { ACCENT_COLOR, KIND_COLORS } from './palette';

export type Tool = 'Marker' | 'Polygon' | 'Line' | 'edit' | 'drag' | 'remove';

export interface EditorCallbacks {
  onChange(): void;
  /** Нарисован новый объект — нужно спросить, что это. */
  onCreate(layer: L.Layer, shape: ShapeKind): void;
  /** Клик по объекту вне режимов правки. */
  onPick(id: string): void;
}

interface Meta {
  id: string;
  props: EditorFeature['props'];
}

const dotIcon = (color: string) =>
  L.divIcon({ className: 'ed-dot', html: `<span style="background:${color}"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] });

export class EditorController {
  private readonly group: L.FeatureGroup;
  private readonly meta = new Map<L.Layer, Meta>();
  private tool: Tool | null = null;

  constructor(
    private readonly host: EditorHost,
    private readonly cb: EditorCallbacks,
  ) {
    const pm = host.map.pm;
    this.group = L.featureGroup().addTo(host.map);
    pm.setLang('ru');
    pm.setGlobalOptions({
      snappable: true,
      snapDistance: 15,
      allowSelfIntersection: false,
      markerStyle: { icon: dotIcon(ACCENT_COLOR) },
      layerGroup: this.group,
    } as L.PM.GlobalOptions);
    host.map.on('pm:create', this.onCreate);
    host.map.on('pm:remove', this.onRemove);
  }

  /** Перестроить редактируемые слои из данных карты. */
  load(features: readonly MapFeature[]): void {
    this.group.clearLayers();
    this.meta.clear();
    for (const f of features) {
      if (!isEditableGeometry(f.geometry)) continue;
      const layer = this.createLayer(f.geometry, f.color ?? KIND_COLORS[f.kind], f.name);
      this.attach(layer, { id: f.id, props: { ...f.props } });
    }
  }

  private createLayer(geometry: EditableGeometry, color: string, name: string): L.Layer {
    const shape = toLeafletShape(geometry);
    const layer =
      shape.shape === 'point'
        ? L.marker(shape.latlng, { icon: dotIcon(color) })
        : shape.shape === 'line'
          ? L.polyline(shape.latlngs, { color, weight: 3 })
          : L.polygon(shape.latlngs, { color, weight: 2, fillOpacity: 0.15 });
    if (name) layer.bindTooltip(name, { permanent: shape.shape === 'point', direction: 'right', className: 'ed-tooltip', offset: [8, 0] });
    this.group.addLayer(layer);
    return layer;
  }

  private attach(layer: L.Layer, meta: Meta): void {
    this.meta.set(layer, meta);
    layer.on('pm:edit pm:dragend pm:rotateend', () => this.cb.onChange());
    layer.on('click', () => {
      if (!this.tool) this.cb.onPick(meta.id);
    });
  }

  private onCreate = (e: { layer: L.Layer; shape: string }) => {
    const shape: ShapeKind = e.shape === 'Marker' ? 'point' : e.shape === 'Line' ? 'line' : 'area';
    this.setTool(null);
    this.cb.onCreate(e.layer, shape);
  };

  private onRemove = (e: { layer: L.Layer }) => {
    if (this.meta.delete(e.layer)) this.cb.onChange();
  };

  /** Новый объект подтверждён: запоминаем id и свойства, подписываем. */
  adopt(layer: L.Layer, id: string, props: Meta['props'], name: string): void {
    if (!this.group.hasLayer(layer)) this.group.addLayer(layer);
    if (name) layer.bindTooltip(name, { permanent: layer instanceof L.Marker, direction: 'right', className: 'ed-tooltip', offset: [8, 0] });
    this.attach(layer, { id, props });
    this.cb.onChange();
  }

  discard(layer: L.Layer): void {
    this.group.removeLayer(layer);
    layer.remove();
  }

  ids(): Set<string> {
    return new Set([...this.meta.values()].map((m) => m.id));
  }

  find(id: string): { layer: L.Layer; meta: Meta } | null {
    for (const [layer, meta] of this.meta) if (meta.id === id) return { layer, meta };
    return null;
  }

  updateProps(id: string, props: Meta['props'], name: string): void {
    const found = this.find(id);
    if (!found) return;
    found.meta.props = props;
    found.layer.unbindTooltip();
    if (name) found.layer.bindTooltip(name, { permanent: found.layer instanceof L.Marker, direction: 'right', className: 'ed-tooltip', offset: [8, 0] });
    this.cb.onChange();
  }

  remove(id: string): void {
    const found = this.find(id);
    if (!found) return;
    this.meta.delete(found.layer);
    this.group.removeLayer(found.layer);
    this.cb.onChange();
  }

  collect(): EditorFeature[] {
    const out: EditorFeature[] = [];
    for (const [layer, meta] of this.meta) {
      const geometry = (layer as L.Polyline | L.Marker).toGeoJSON(6).geometry;
      if (isEditableGeometry(geometry)) out.push({ id: meta.id, props: meta.props, geometry });
    }
    return out;
  }

  shapeOfLayer(layer: L.Layer): ShapeKind | null {
    const g = (layer as L.Marker).toGeoJSON?.().geometry;
    return g && isEditableGeometry(g) ? shapeOf(g) : null;
  }

  getTool(): Tool | null {
    return this.tool;
  }

  setTool(tool: Tool | null): void {
    const pm = this.host.map.pm;
    pm.disableDraw();
    if (pm.globalEditModeEnabled()) pm.disableGlobalEditMode();
    if (pm.globalDragModeEnabled()) pm.disableGlobalDragMode();
    if (pm.globalRemovalModeEnabled()) pm.disableGlobalRemovalMode();
    this.tool = tool === this.tool ? null : tool;
    if (this.tool === 'Marker' || this.tool === 'Polygon' || this.tool === 'Line') pm.enableDraw(this.tool);
    else if (this.tool === 'edit') pm.enableGlobalEditMode();
    else if (this.tool === 'drag') pm.enableGlobalDragMode();
    else if (this.tool === 'remove') pm.enableGlobalRemovalMode();
  }

  destroy(): void {
    this.setTool(null);
    this.tool = null;
    this.host.map.off('pm:create', this.onCreate);
    this.host.map.off('pm:remove', this.onRemove);
    this.group.remove();
    this.meta.clear();
  }
}
