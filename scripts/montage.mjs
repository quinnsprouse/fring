// Debug helper: ghost | landed | diff, upscaled, one row per seam.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const dir = process.env.MONTAGE_DIR ?? 'test-results/seams'
const prefix = process.argv[2] ?? 'chromium'
const out = process.argv[3] ?? `${dir}/${prefix}-montage.png`
const scale = 3
const names = readdirSync(dir).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('-ghost.png')).map((f) => f.slice(0, -'-ghost.png'.length))
const rows = names.map((name) => ({
  ghost: PNG.sync.read(readFileSync(`${dir}/${name}-ghost.png`)),
  landed: PNG.sync.read(readFileSync(`${dir}/${name}-landed.png`)),
}))
const width = Math.max(...rows.map((r) => r.ghost.width)) * 3 * scale + 40
const height = rows.reduce((sum, r) => sum + r.ghost.height * scale + 10, 0)
const sheet = new PNG({ width, height })
sheet.data.fill(255)
let top = 0
for (const { ghost, landed } of rows) {
  for (let y = 0; y < ghost.height; y++) {
    for (let x = 0; x < ghost.width; x++) {
      const i = (y * ghost.width + x) * 4
      const delta = Math.abs(ghost.data[i] - landed.data[i]) + Math.abs(ghost.data[i + 1] - landed.data[i + 1]) + Math.abs(ghost.data[i + 2] - landed.data[i + 2])
      const cells = [
        [ghost.data[i], ghost.data[i + 1], ghost.data[i + 2]],
        [landed.data[i], landed.data[i + 1], landed.data[i + 2]],
        delta > 12 ? [255, 0, 0] : delta > 0 ? [255, 200, 200] : [240, 240, 240],
      ]
      cells.forEach((rgb, c) => {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const o = ((top + y * scale + dy) * width + c * (ghost.width * scale + 20) + x * scale + dx) * 4
            sheet.data[o] = rgb[0]
            sheet.data[o + 1] = rgb[1]
            sheet.data[o + 2] = rgb[2]
            sheet.data[o + 3] = 255
          }
        }
      })
    }
  }
  top += ghost.height * scale + 10
}
writeFileSync(out, PNG.sync.write(sheet))
console.log(names.join('\n'))
