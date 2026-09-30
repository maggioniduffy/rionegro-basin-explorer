import { defineConfig, devices } from "@playwright/test";
import { E2E_IMAGERY_HOST } from "./e2e/map-helpers";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  // Screenshot baselines are OS/font dependent; they are generated on Linux.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Headless Chromium has no GPU; allow the software WebGL fallback for MapLibre.
        launchOptions: { args: ["--enable-unsafe-swiftshader"] },
      },
    },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Stubbed imagery (e2e/map-helpers.ts) so screenshots match locally and in CI.
    // process.env beats .env.local, so a local EOX URL doesn't leak into the build.
    env: {
      NEXT_PUBLIC_IMAGERY_TILE_URL: `${E2E_IMAGERY_HOST}/{z}/{x}/{y}.png`,
      NEXT_PUBLIC_IMAGERY_ATTRIBUTION: "E2E imagery",
    },
  },
});
