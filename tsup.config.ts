import { defineConfig, type Options } from 'tsup'

const shared: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  target: 'es2020',
  minify: true,
  treeshake: true,
}

export default defineConfig([
  { ...shared, entry: { index: 'src/index.ts' } },
  // The React and auto entries import the core by package name instead of
  // bundling it. One copy of the core means one instance per document, no
  // matter which entries an app imports.
  {
    ...shared,
    entry: { react: 'src/react.tsx' },
    external: ['react', 'fring'],
    // Rollup's tree-shaking pass strips the directive; esbuild alone keeps it.
    treeshake: false,
    banner: { js: "'use client';" },
  },
  { ...shared, entry: { auto: 'src/auto.ts' }, external: ['fring'] },
  {
    // <script src="https://unpkg.com/fring"></script>
    entry: { fring: 'src/auto.ts' },
    format: ['iife'],
    target: 'es2020',
    minify: true,
    noExternal: ['fring'],
    esbuildOptions(options) {
      options.alias = { fring: './src/index.ts' }
    },
    outExtension: () => ({ js: '.global.js' }),
  },
])
