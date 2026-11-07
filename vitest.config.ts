import { defineConfig } from 'vitest/config';

// Тесты сборочного инструментария и общих модулей. Плагин мира здесь не подключается.
export default defineConfig({
  test: {
    include: ['tooling/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
