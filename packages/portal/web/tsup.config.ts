import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/portal-app.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});