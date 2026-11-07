/** Формат адреса: #/m/<карта>[/e/<сущность>] или #/e/<сущность>. Чистые функции без зависимостей. */

export interface Route {
  mapId: string | null;
  entityId: string | null;
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const route: Route = { mapId: null, entityId: null };
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const value = safeDecode(parts[i + 1]!);
    if (parts[i] === 'm') route.mapId = value;
    else if (parts[i] === 'e') route.entityId = value;
  }
  return route;
}

export function buildHash({ mapId, entityId }: Route): string {
  const parts: string[] = [];
  if (mapId) parts.push('m', encodeURIComponent(mapId));
  if (entityId) parts.push('e', encodeURIComponent(entityId));
  return `#/${parts.join('/')}`;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
