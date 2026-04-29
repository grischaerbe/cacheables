import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  target: 'es2020',
  format: ['cjs', 'esm'],
  sourcemap: true,
  clean: true,
  dts: true,
})
