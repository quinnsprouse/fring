import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199', viewport: { width: 1100, height: 800 } },
  webServer: [
    {
      command: 'npx vite --config tests/fixture/vite.config.ts',
      url: 'http://localhost:5199',
      reuseExistingServer: true,
    },
    {
      command: 'npx vite --config site/vite.config.ts --strictPort',
      url: 'http://localhost:5198',
      reuseExistingServer: true,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 800 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1100, height: 800 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1100, height: 800 } } },
    {
      // A fractional device pixel ratio is where sub-pixel seams show up.
      name: 'chromium-1.5x',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1.5 },
    },
  ],
})
