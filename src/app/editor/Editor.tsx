/**
 * Dev-редактор карты (только `npm run dev`, режим мастера): точки, области, линии,
 * привязка к статьям, сохранение прямо в world/maps/<id>/features.geojson.
 */
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import './editor.css';
import type L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEV_API, type CreateEntityResponse, type SaveFeaturesResponse } from '../../shared/api';
import { KIND_IDS, KINDS, type Kind } from '../../shared/kinds';
import type { Entity, Vec2, Visibility } from '../../shared/types';
import { openInCodeEditor } from '../components/common';
import type { EditorHost } from '../map/editor-host';
import { normalizeText } from '../model';
import { useApp } from '../store';
import { api } from './api';
import { EditorController, type Tool } from './EditorController';
import { buildFeatureCollection, featuresSignature, LABEL_KIND, makeFeatureId, NEW_ENTITY_KIND, PARENT_KINDS, suggestParent, SHAPE_LABEL, type AreaCandidate } from './features';
import { formatPoint } from './format';
import { isEditableGeometry, representativePoint, type ShapeKind } from './geometry';
import { applyForm, AUTO, formFromProps, formProblems, unlinkForm, type PropsForm } from './props-form';

interface Toast {
  id: number;
  text: string;
  error?: boolean;
}

const TOOLS: Array<{ tool: Tool; icon: string; title: string }> = [
  { tool: 'Marker', icon: '●', title: 'Точка: город, деревня, место' },
  { tool: 'Polygon', icon: '⬟', title: 'Область: государство, регион, район' },
  { tool: 'Line', icon: '〰', title: 'Линия: дорога, путь' },
  { tool: 'edit', icon: '✥', title: 'Править вершины' },
  { tool: 'drag', icon: '✋', title: 'Перемещать объекты' },
  { tool: 'remove', icon: '🗑', title: 'Удалять объекты' },
];

/** Поиск статьи для привязки: сначала подходящие по геометрии типы. */
function rankEntities(entities: Entity[], query: string, shape: ShapeKind | null): Entity[] {
  const q = normalizeText(query.trim());
  const hint = shape === 'point' ? 'point' : shape === 'line' ? 'line' : 'area';
  return entities
    .filter((e) => !q || normalizeText(e.name).includes(q) || e.id.includes(q) || e.aliases.some((a) => normalizeText(a).includes(q)))
    .sort((a, b) => Number(KINDS[b.kind].geometry === hint) - Number(KINDS[a.kind].geometry === hint) || a.name.localeCompare(b.name, 'ru'))
    .slice(0, 60);
}

function EntityPicker({ shape, onPick }: { shape: ShapeKind | null; onPick: (id: string) => void }) {
  const entities = useApp((s) => s.world.entities);
  const [query, setQuery] = useState('');
  const list = useMemo(() => rankEntities(Object.values(entities), query, shape), [entities, query, shape]);
  return (
    <div className="ed-picker">
      <input autoFocus className="ed-input" placeholder="Найти статью…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul>
        {list.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onPick(e.id)}>
              <span>{e.name}</span>
              <small>{KINDS[e.kind].label}</small>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="ed-empty">Ничего не найдено</li>}
      </ul>
    </div>
  );
}

interface CreateState {
  layer: L.Layer;
  shape: ShapeKind;
  suggestedParent: string | null;
}

function CreateDialog({ state, onDone, onCancel }: { state: CreateState; onDone: (props: Record<string, unknown>, name: string, entityId: string | null) => void; onCancel: () => void }) {
  const entities = useApp((s) => s.world.entities);
  const [tab, setTab] = useState<'existing' | 'new' | 'label'>('new');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>(NEW_ENTITY_KIND[state.shape]);
  const [labelKind, setLabelKind] = useState<Kind>(LABEL_KIND[state.shape]);
  const [parent, setParent] = useState(state.suggestedParent ?? '');
  const [summary, setSummary] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parents = useMemo(() => Object.values(entities).filter((e) => PARENT_KINDS.includes(e.kind)).sort((a, b) => a.name.localeCompare(b.name, 'ru')), [entities]);

  const createEntity = async () => {
    if (!name.trim()) return setError('Введите название');
    setBusy(true);
    setError('');
    try {
      const res = await api<CreateEntityResponse>(DEV_API.createEntity, 'POST', { name: name.trim(), kind, parent: parent || null, summary: summary || null, visibility });
      onDone({ entity: res.id }, name.trim(), res.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="ed-dialog" role="dialog" aria-label="Что это?">
      <h3>Новый объект: {SHAPE_LABEL[state.shape].toLowerCase()}</h3>
      <div className="ed-tabs">
        <button type="button" className={tab === 'new' ? 'is-active' : ''} onClick={() => setTab('new')}>Новая статья</button>
        <button type="button" className={tab === 'existing' ? 'is-active' : ''} onClick={() => setTab('existing')}>Существующая</button>
        <button type="button" className={tab === 'label' ? 'is-active' : ''} onClick={() => setTab('label')}>Только подпись</button>
      </div>
      {tab === 'existing' && <EntityPicker shape={state.shape} onPick={(id) => onDone({ entity: id }, entities[id]?.name ?? id, id)} />}
      {tab === 'new' && (
        <div className="ed-form">
          <label>Название<input autoFocus className="ed-input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void createEntity()} /></label>
          <label>Тип
            <select className="ed-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KIND_IDS.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
            </select>
          </label>
          <label>Принадлежит
            <select className="ed-input" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">— никому —</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.name} ({KINDS[p.kind].label})</option>)}
            </select>
          </label>
          <label>Кратко (для карточки)<textarea className="ed-input" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
          <label className="ed-check"><input type="checkbox" checked={visibility === 'dm'} onChange={(e) => setVisibility(e.target.checked ? 'dm' : 'public')} /> Только для мастера</label>
          {error && <div className="ed-error">{error}</div>}
          <div className="ed-actions">
            <button type="button" className="ed-btn ed-primary" disabled={busy} onClick={() => void createEntity()}>Создать статью</button>
            <button type="button" className="ed-btn" onClick={onCancel}>Отмена</button>
          </div>
        </div>
      )}
      {tab === 'label' && (
        <div className="ed-form">
          <label>Подпись<input autoFocus className="ed-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Тип
            <select className="ed-input" value={labelKind} onChange={(e) => setLabelKind(e.target.value as Kind)}>
              {KIND_IDS.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
            </select>
          </label>
          <div className="ed-actions">
            <button type="button" className="ed-btn ed-primary" disabled={!name.trim()} onClick={() => onDone({ name: name.trim(), kind: labelKind }, name.trim(), null)}>Добавить</button>
            <button type="button" className="ed-btn" onClick={onCancel}>Отмена</button>
          </div>
        </div>
      )}
      {tab === 'existing' && <div className="ed-actions"><button type="button" className="ed-btn" onClick={onCancel}>Отмена</button></div>}
    </div>
  );
}

function PropsDialog({ ctrl, featureId, onClose }: { ctrl: EditorController; featureId: string; onClose: () => void }) {
  const entities = useApp((s) => s.world.entities);
  const found = ctrl.find(featureId);
  const [initial] = useState<PropsForm>(() => formFromProps(found?.meta.props ?? {}));
  const [form, setForm] = useState<PropsForm>(initial);
  const [picking, setPicking] = useState(false);
  if (!found) return null;
  const entity = form.entity ? entities[form.entity] : undefined;
  const problems = formProblems(form);
  const set = (patch: Partial<PropsForm>) => setForm((f) => ({ ...f, ...patch }));

  const apply = () => {
    const props = applyForm(found.meta.props, initial, form);
    ctrl.updateProps(featureId, props, form.name.trim() || entity?.name || '');
    onClose();
  };

  return (
    <div className="ed-dialog" role="dialog" aria-label="Свойства объекта">
      <h3>Объект <code>{featureId}</code></h3>
      {picking ? (
        <EntityPicker shape={ctrl.shapeOfLayer(found.layer)} onPick={(id) => { set({ entity: id }); setPicking(false); }} />
      ) : (
        <div className="ed-form">
          <div className="ed-linked">
            Статья: {entity ? <strong>{entity.name}</strong> : form.entity ? <span className="ed-error">«{form.entity}» не найдена</span> : <em>нет (только подпись)</em>}
            <div className="ed-row">
              <button type="button" className="ed-btn" onClick={() => setPicking(true)}>Сменить</button>
              {form.entity && <button type="button" className="ed-btn" onClick={() => setForm(unlinkForm(form, entity ? { name: entity.name, kind: entity.kind, color: entity.color } : null))}>Отвязать</button>}
              {entity && <button type="button" className="ed-btn" onClick={() => useApp.getState().select(entity.id)}>Открыть статью</button>}
              {entity?.source && <button type="button" className="ed-btn" onClick={() => openInCodeEditor(entity.source!)}>Открыть .md</button>}
            </div>
          </div>
          <label>Своё название<input className="ed-input" placeholder={entity?.name ?? ''} value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>Тип
            <select className="ed-input" value={form.kind} onChange={(e) => set({ kind: e.target.value as PropsForm['kind'] })}>
              <option value={AUTO}>авто{entity ? ` (${KINDS[entity.kind].label})` : ''}</option>
              {KIND_IDS.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
            </select>
          </label>
          <label>Детализация
            <select className="ed-input" value={form.detail} onChange={(e) => set({ detail: e.target.value as PropsForm['detail'] })}>
              <option value={AUTO}>авто</option>
              <option value="0">0 — видно всегда</option>
              <option value="1">1 — среднее приближение</option>
              <option value="2">2 — сильное приближение</option>
            </select>
          </label>
          <label>Цвет
            <span className="ed-row">
              <input type="color" value={form.color || '#e3b55a'} onChange={(e) => set({ color: e.target.value })} />
              {form.color && <button type="button" className="ed-btn" onClick={() => set({ color: '' })}>авто</button>}
            </span>
          </label>
          <label>Видимость
            <select className="ed-input" value={form.visibility} onChange={(e) => set({ visibility: e.target.value as PropsForm['visibility'] })}>
              <option value={AUTO}>авто (как у статьи)</option>
              <option value="public">всем</option>
              <option value="dm">только мастеру</option>
            </select>
          </label>
          {problems.map((p) => <div key={p} className="ed-error">{p}</div>)}
          <div className="ed-actions">
            <button type="button" className="ed-btn ed-primary" disabled={problems.length > 0} onClick={apply}>Применить</button>
            <button type="button" className="ed-btn" onClick={onClose}>Отмена</button>
            <button type="button" className="ed-btn ed-danger" onClick={() => { ctrl.remove(featureId); onClose(); }}>Удалить объект</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Editor({ host }: { host: EditorHost }) {
  const editing = useApp((s) => s.editing);
  const dirty = useApp((s) => s.editorDirty);
  const mapDef = useApp((s) => s.world.maps[host.mapId]);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [zoom, setZoom] = useState(host.map.getZoom());
  const [tool, setTool] = useState<Tool | null>(null);
  const [creating, setCreating] = useState<CreateState | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stale, setStale] = useState(false);
  const ctrlRef = useRef<EditorController | null>(null);
  /** Отпечаток объектов, загруженных в редактор: сравниваем содержимое, а не ссылку на объект. */
  const loadedRef = useRef<string>('');

  const toast = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 7000 : 3500);
  }, []);

  // Координаты курсора и зум.
  useEffect(() => {
    const onMove = (e: L.LeafletMouseEvent) => setCursor([e.latlng.lng, e.latlng.lat]);
    const onZoom = () => setZoom(host.map.getZoom());
    host.map.on('mousemove', onMove);
    host.map.on('zoomend', onZoom);
    return () => {
      host.map.off('mousemove', onMove);
      host.map.off('zoomend', onZoom);
    };
  }, [host]);

  // Вход/выход из режима правки.
  useEffect(() => {
    if (!editing) return;
    if (!host.map.pm) {
      toast('Geoman не загружен — редактор недоступен', true);
      return;
    }
    host.setViewLayersVisible(false);
    const ctrl = new EditorController(host, {
      onChange: () => useApp.getState().setEditorDirty(true),
      onCreate: (layer, shape) => {
        setTool(null);
        const g = (layer as L.Marker).toGeoJSON().geometry;
        const point = isEditableGeometry(g) ? representativePoint(g) : null;
        const def = useApp.getState().world.maps[host.mapId];
        const areas: AreaCandidate[] = (def?.features ?? [])
          .filter((f) => f.entity && isEditableGeometry(f.geometry))
          .map((f) => ({ entityId: f.entity!, kind: f.kind, geometry: f.geometry as AreaCandidate['geometry'] }));
        setCreating({ layer, shape, suggestedParent: point ? suggestParent(point, areas) : null });
      },
      onPick: (id) => setPicked(id),
    });
    ctrlRef.current = ctrl;
    const def = useApp.getState().world.maps[host.mapId];
    ctrl.load(def?.features ?? []);
    loadedRef.current = featuresSignature(def?.features ?? []);
    return () => {
      ctrl.destroy();
      ctrlRef.current = null;
      setTool(null);
      setCreating(null);
      setPicked(null);
      setStale(false);
      host.setViewLayersVisible(true);
    };
  }, [editing, host, toast]);

  // Данные пришли с диска (HMR): без несохранённых правок — перезагружаем слои.
  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl || !mapDef) return;
    // Мир перекомпилируется и при правке любой статьи — реагируем, только если изменились объекты карты.
    const signature = featuresSignature(mapDef.features);
    if (signature === loadedRef.current) return;
    if (useApp.getState().editorDirty) setStale(true);
    else {
      ctrl.load(mapDef.features);
      loadedRef.current = signature;
    }
  }, [mapDef]);

  const save = useCallback(async () => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    const { collection, dropped } = buildFeatureCollection(ctrl.collect());
    try {
      const res = await api<SaveFeaturesResponse>(DEV_API.saveFeatures(host.mapId), 'PUT', collection);
      useApp.getState().setEditorDirty(false);
      setStale(false);
      toast(`Сохранено: ${res.count} объектов${dropped.length ? ` (отброшены пустые: ${dropped.join(', ')})` : ''}`);
    } catch (e) {
      toast(`Не удалось сохранить: ${(e as Error).message}`, true);
    }
  }, [host, toast]);

  const revert = () => {
    const def = useApp.getState().world.maps[host.mapId];
    ctrlRef.current?.load(def?.features ?? []);
    loadedRef.current = featuresSignature(def?.features ?? []);
    useApp.getState().setEditorDirty(false);
    setStale(false);
  };

  const chooseTool = (t: Tool) => {
    ctrlRef.current?.setTool(t);
    setTool(ctrlRef.current?.getTool() ?? null);
  };

  // Горячие клавиши и предупреждение при закрытии вкладки.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!useApp.getState().editing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (e.key === 'Escape') {
        ctrlRef.current?.setTool(null);
        setTool(null);
        setPicked(null);
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useApp.getState().editorDirty) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [save]);

  const finishCreate = (props: Record<string, unknown>, name: string, entityId: string | null) => {
    const ctrl = ctrlRef.current;
    if (!ctrl || !creating) return;
    const taken = ctrl.ids();
    ctrl.adopt(creating.layer, makeFeatureId(entityId, name, (id) => taken.has(id)), props, name);
    setCreating(null);
  };

  const cancelCreate = () => {
    if (creating) ctrlRef.current?.discard(creating.layer);
    setCreating(null);
  };

  return (
    <>
      {editing && (
        <div className="ed-toolbar" role="toolbar" aria-label="Инструменты редактора">
          {TOOLS.map((t) => (
            <button key={t.tool} type="button" className={`ed-tool${tool === t.tool ? ' is-active' : ''}`} title={t.title} aria-label={t.title} aria-pressed={tool === t.tool} onClick={() => chooseTool(t.tool)}>
              {t.icon}
            </button>
          ))}
          <hr />
          <button type="button" className={`ed-tool ed-save${dirty ? ' is-dirty' : ''}`} title="Сохранить (Ctrl+S)" aria-label="Сохранить" onClick={() => void save()}>💾</button>
          <button type="button" className="ed-tool" title="Отменить несохранённые изменения" aria-label="Отменить изменения" disabled={!dirty} onClick={revert}>↺</button>
        </div>
      )}
      <div className="ed-status">
        <button type="button" className="ed-coords" title="Скопировать координаты" onClick={() => cursor && void navigator.clipboard?.writeText(`[${formatPoint(cursor[0], cursor[1])}]`)}>
          {cursor ? `x ${cursor[0].toFixed(1)} · y ${cursor[1].toFixed(1)}` : '—'} · z {zoom.toFixed(2)}
        </button>
        <button type="button" className={`ed-toggle${editing ? ' is-on' : ''}`} onClick={() => useApp.getState().setEditing(!editing)}>
          ✎ {editing ? 'Готово' : 'Редактор'}
          {editing && dirty && <span className="ed-dirty" title="Есть несохранённые изменения">●</span>}
        </button>
        {stale && <span className="ed-stale">файл изменился на диске</span>}
      </div>
      <div className="ed-toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`ed-toast${t.error ? ' is-error' : ''}`}>{t.text}</div>)}
      </div>
      {creating && <CreateDialog state={creating} onDone={finishCreate} onCancel={cancelCreate} />}
      {picked && ctrlRef.current && !creating && <PropsDialog ctrl={ctrlRef.current} featureId={picked} onClose={() => setPicked(null)} />}
    </>
  );
}
