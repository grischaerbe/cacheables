import { defineConfig } from 'tsdown'

export default defineConfig({
  target: 'es2020',
  format: ['cjs', 'esm'],
  sourcemap: true,
  clean: true,
  dts: true,
})
