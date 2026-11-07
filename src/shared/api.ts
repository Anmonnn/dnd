/**
 * Контракт dev-API редактора. Эндпоинты существуют только у `npm run dev`
 * (Vite-плагин tooling/world/vite-plugin.ts) и только в режиме dm.
 * В production-сборке их нет — сайт полностью статический.
 */
import type { AuthoredFeatureCollection, CreateEntityRequest, UpdateEntityRequest } from './schemas.ts';

export const DEV_API_PREFIX = '/__world';

export const DEV_API = {
  /** PUT, тело — AuthoredFeatureCollection. Полностью перезаписывает world/maps/<mapId>/features.geojson. */
  saveFeatures: (mapId: string) => `${DEV_API_PREFIX}/maps/${encodeURIComponent(mapId)}/features`,
  /** POST, тело — CreateEntityRequest. Создаёт world/lore/<папка типа>/<id>.md с заготовкой. */
  createEntity: `${DEV_API_PREFIX}/lore`,
  /** PATCH, тело — UpdateEntityRequest: правка полей фронтматтера (location, avatar). */
  updateEntity: (id: string) => `${DEV_API_PREFIX}/lore/${encodeURIComponent(id)}`,
  /** POST, тело — сама картинка (Content-Type image/png|jpeg|webp|gif), до 15 МБ. Сохраняется в world/media/avatars/<id>.<ext> и прописывается в avatar. */
  uploadAvatar: (id: string) => `${DEV_API_PREFIX}/lore/${encodeURIComponent(id)}/avatar`,
} as const;

export type { AuthoredFeatureCollection, CreateEntityRequest, UpdateEntityRequest };

export interface SaveFeaturesResponse {
  ok: true;
  count: number;
  /** Путь к записанному файлу относительно корня проекта. */
  file: string;
}

export interface CreateEntityResponse {
  ok: true;
  id: string;
  file: string;
}

export interface UpdateEntityResponse {
  ok: true;
  id: string;
  file: string;
}

export interface UploadAvatarResponse {
  ok: true;
  id: string;
  /** Значение, записанное в avatar (путь от world/). */
  avatar: string;
}

/** Типы картинок, которые принимает загрузка аватара, и их расширения. */
export const AVATAR_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
export const AVATAR_MAX_BYTES = 15 * 1024 * 1024;

/** Любая ошибка: HTTP 4xx/5xx с телом { error }. */
export interface ApiErrorResponse {
  error: string;
}
