import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  root: path('.'),
  plugins: [react()],
  resolve: {
    // The site runs against the source, not the built package.
    alias: [
      { find: /^fring\/react$/, replacement: path('../src/react.tsx') },
      { find: /^fring$/, replacement: path('../src/index.ts') },
    ],
  },
  server: { port: 5198, fs: { allow: [path('..')] } },
  build: { outDir: path('./dist'), emptyOutDir: true },
})
