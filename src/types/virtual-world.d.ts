/** Виртуальный модуль, который генерирует tooling/world/vite-plugin.ts из папки world/. */
declare module 'virtual:world' {
  import type { WorldData } from '../shared/types';

  const world: WorldData;
  export default world;
}
