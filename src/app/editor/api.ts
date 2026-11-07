/** Клиент dev-API (src/shared/api.ts): JSON-запросы и загрузка файлов. Ошибки сервера — Error с его сообщением. */
import type { ApiErrorResponse } from '../../shared/api';

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as T | ApiErrorResponse;
  if (!res.ok) throw new Error((data as ApiErrorResponse).error ?? `HTTP ${res.status}`);
  return data as T;
}

export async function api<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return parse<T>(res);
}

export async function uploadFile<T>(url: string, file: File): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  return parse<T>(res);
}
