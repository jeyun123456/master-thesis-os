import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Same "@/..." alias as tsconfig paths, so components can be rendered in tests.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    // services/* run their own node:test suites (pnpm test:agent).
    exclude: [...configDefaults.exclude, 'services/**'],
  },
});
