import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: here,
  server: { port: 5199, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  logLevel: 'warn',
})
