import { useLayoutEffect, useRef, useState } from 'react';
import { KINDS } from '../../shared/kinds';
import { useApp } from '../store';
import { assetUrl, KindIcon } from './common';

const OFFSET = 18;
const MARGIN = 12;

/** Карточка при наведении: название, тип, аватар, место, краткое описание и превью подробной карты. */
export function HoverCard() {
  const hover = useApp((s) => s.hover);
  const world = useApp((s) => s.world);
  const editing = useApp((s) => s.editing);
  const picking = useApp((s) => s.picking);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const map = hover ? world.maps[hover.mapId] : undefined;
  const feature = hover ? map?.features.find((f) => f.id === hover.featureId) : undefined;
  const pin = hover && !feature ? map?.pins.find((p) => p.id === hover.featureId) : undefined;
  const entity = hover?.entityId ? world.entities[hover.entityId] : undefined;
  const parent = entity?.parent ? world.entities[entity.parent] : undefined;
  const place = entity?.location ? world.entities[entity.location] : undefined;
  const detailMap = entity?.map ? world.maps[entity.map] : undefined;
  const kind = feature?.kind ?? entity?.kind;

  // Позиция — после замера: карточка не должна вылезать за край окна.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!hover || !el) {
      setPos(null);
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    let left = hover.x + OFFSET;
    let top = hover.y + OFFSET;
    if (left + width > window.innerWidth - MARGIN) left = hover.x - OFFSET - width;
    if (top + height > window.innerHeight - MARGIN) top = hover.y - OFFSET - height;
    setPos({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) });
  }, [hover, feature, pin, entity]);

  if (!hover || (!feature && !pin) || !kind || editing) return null;

  const hints: string[] = [];
  if (picking) hints.push('клик — привязать сюда');
  else {
    if (entity) hints.push(pin ? 'клик — всё, что известно' : 'клик — подробнее');
    if (detailMap) hints.push('двойной клик — открыть карту');
  }

  return (
    <div
      ref={ref}
      className="hover-card"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {detailMap?.base && (
        <div className="hover-card-map">
          <img src={assetUrl(detailMap.base.preview, detailMap.base.version)} alt="" />
          <span>Есть подробная карта</span>
        </div>
      )}
      <div className={`hover-card-body${entity?.avatar ? ' has-avatar' : ''}`}>
        {entity?.avatar && <img className="hover-card-avatar" src={assetUrl(entity.avatar.thumb)} alt="" />}
        <div>
          <div className="hover-card-kind">
            <KindIcon kind={kind} />
            <span>{KINDS[kind].label}</span>
            {parent && <span className="hover-card-parent">· {parent.name}</span>}
            {entity?.visibility === 'dm' && <span className="badge badge-dm">мастер</span>}
          </div>
          <div className="hover-card-title">{entity?.name ?? feature?.name}</div>
          {place && <div className="hover-card-place">📍 {place.name}</div>}
        </div>
      </div>
      {entity?.summary && <p className="hover-card-summary">{entity.summary}</p>}
      {hints.length > 0 && <div className="hover-card-hint">{hints.join(' · ')}</div>}
    </div>
  );
}
