import { useEffect, type RefObject } from 'react';
import type { Kind } from '../../shared/kinds';
import { kindSvg } from '../map/icons';

export const BASE_URL = import.meta.env.BASE_URL;

/** URL ресурса из данных мира: относительные пути — от BASE_URL сайта. */
export function assetUrl(path: string, version?: string): string {
  const url = /^https?:\/\//.test(path) ? path : BASE_URL + path;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

export function KindIcon({ kind, className = '' }: { kind: Kind; className?: string }) {
  return <span className={`kind-icon ${className}`} dangerouslySetInnerHTML={{ __html: kindSvg(kind) }} />;
}

/** Закрывать всплывающее окно по клику вне его и по Esc. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose]);
}

/** Открыть файл проекта в редакторе кода (встроенный эндпоинт dev-сервера Vite). */
export function openInCodeEditor(file: string): void {
  if (import.meta.env.DEV) void fetch(`/__open-in-editor?file=${encodeURIComponent(file)}`);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}
