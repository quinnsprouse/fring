// Prints the size of each built entry, raw and gzipped.
import { readFileSync, readdirSync } from 'node:fs'
import { brotliCompressSync, gzipSync } from 'node:zlib'

for (const file of readdirSync('dist').filter((name) => /\.(js|cjs)$/.test(name)).sort()) {
  const source = readFileSync(`dist/${file}`)
  const kb = (bytes) => `${(bytes / 1024).toFixed(2)} kB`
  console.log(file.padEnd(18), kb(source.length).padStart(9), 'min', kb(gzipSync(source).length).padStart(9), 'gzip', kb(brotliCompressSync(source).length).padStart(9), 'brotli')
}
