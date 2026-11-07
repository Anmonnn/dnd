/**
 * Инструменты мастера в панели статьи (только `npm run dev`, режим мастера):
 * привязать к месту на карте, загрузить аватар, добавить персонажа в место.
 * Всё сохраняется прямо во фронтматтер .md и долетает обратно через HMR.
 */
import { useRef, useState, type FormEvent } from 'react';
import {
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  DEV_API,
  type CreateEntityResponse,
  type UpdateEntityResponse,
  type UploadAvatarResponse,
} from '../../shared/api';
import type { Entity } from '../../shared/types';
import { useApp } from '../store';
import { api, uploadFile } from './api';

/** Дождаться, пока новая статья придёт через HMR. */
function waitForEntity(id: string, timeout = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    if (useApp.getState().world.entities[id]) return resolve(true);
    const timer = window.setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeout);
    const unsubscribe = useApp.subscribe((s) => {
      if (!s.world.entities[id]) return;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

export default function PanelTools({ entity }: { entity: Entity }) {
  const picking = useApp((s) => s.picking);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const isPickingThis = picking?.entityId === entity.id;
  // Место — то, что нарисовано на карте само (а не кружком).
  const isPlace = entity.locations.some((l) => !l.feature.startsWith('pin-'));

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ text: await action() });
    } catch (e) {
      setStatus({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const setLocation = (location: string | null) =>
    run(async () => {
      await api<UpdateEntityResponse>(DEV_API.updateEntity(entity.id), 'PATCH', { location });
      if (!location) return 'Отвязано от места.';
      return `Привязано: ${useApp.getState().world.entities[location]?.name ?? location}.`;
    });

  const pick = () => {
    const store = useApp.getState();
    if (isPickingThis) return store.cancelPicking();
    setStatus({ text: 'Кликните по месту на карте (Esc — отмена).' });
    store.startPicking({ entityId: entity.id, onPick: (location) => void setLocation(location) });
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!AVATAR_TYPES[file.type]) return setStatus({ text: 'Нужна картинка PNG, JPEG, WebP или GIF.', error: true });
    if (file.size > AVATAR_MAX_BYTES) return setStatus({ text: 'Картинка больше 15 МБ.', error: true });
    void run(async () => {
      const res = await uploadFile<UploadAvatarResponse>(DEV_API.uploadAvatar(entity.id), file);
      return `Аватар сохранён: world/${res.avatar}.`;
    });
  };

  const addCharacter = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      const res = await api<CreateEntityResponse>(DEV_API.createEntity, 'POST', { name, kind: 'character', location: entity.id });
      setNewName('');
      if (await waitForEntity(res.id)) useApp.getState().showOnMap(res.id);
      return `Создан персонаж: ${res.file}.`;
    });
  };

  return (
    <div className="panel-tools" aria-label="Инструменты мастера">
      <div className="panel-tools-row">
        <button type="button" className={`btn btn-ghost${isPickingThis ? ' is-active' : ''}`} disabled={busy} onClick={pick}>
          📍 {isPickingThis ? 'Отмена выбора' : entity.location ? 'Сменить место' : 'Привязать к месту'}
        </button>
        {entity.location && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void setLocation(null)}>
            Отвязать
          </button>
        )}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          🖼 {entity.avatar ? 'Сменить аватар' : 'Аватар…'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={Object.keys(AVATAR_TYPES).join(',')}
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {isPlace && (
        <form className="panel-tools-row" onSubmit={addCharacter}>
          <input
            className="panel-tools-input"
            placeholder="Имя нового персонажа здесь"
            value={newName}
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="btn btn-ghost" disabled={busy || !newName.trim()}>
            + Персонаж здесь
          </button>
        </form>
      )}
      {status && (
        <div className={`panel-tools-status${status.error ? ' is-error' : ''}`} role="status">
          {status.text}
        </div>
      )}
    </div>
  );
}
