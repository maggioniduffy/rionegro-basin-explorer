import { expect, test } from "@playwright/test";
import { messagesFor } from "../i18n/messages";
import { openMap, waitForMapIdle } from "./map-helpers";

const en = messagesFor("nqn", "en");

// Needs the build to carry NEXT_PUBLIC_E2E=1 (window.__map, window.__flowStep).
test.describe("flow close-up (en)", () => {
  test.use({
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });

  test("paused frame of particles in the channel", async ({ page }) => {
    // Reduced motion: flow starts paused, so the frame is only what __flowStep advances.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMap(page, "/map?r=limay&flow=limay-010");

    // The fit animates (800 ms): wait for the close-up zoom, then for idle.
    await page.waitForFunction(
      () =>
        (
          window as unknown as { __map?: { getZoom(): number } }
        ).__map?.getZoom() !== undefined &&
        (
          window as unknown as { __map: { getZoom(): number } }
        ).__map.getZoom() >= 13.5,
      undefined,
      { timeout: 30_000 },
    );
    await waitForMapIdle(page);

    await expect(
      page.getByText(
        en.flow.sectionOf.replace("{k}", "11").replace("{n}", "116"),
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: en.flow.controls.play, exact: true }),
    ).toBeVisible();

    // The section file loads after the fit; stepping before setSection would be a no-op.
    await expect(page.getByText(en.flow.loading)).toBeHidden();
    await expect(page.getByText(en.flow.discharge).first()).toBeVisible();

    // Step, then wait for the repaint it triggers: the map is still "idle" until it runs.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const w = window as unknown as {
            __flowStep: (n: number) => void;
            __map: { once(e: string, f: () => void): void };
          };
          w.__map.once("idle", () => resolve());
          w.__flowStep(120);
        }),
    );
    await waitForMapIdle(page);
    // Let the repaint reach the canvas; "idle" can fire before the custom layer draws.
    await page.waitForTimeout(1000);
    // Tighter than the default 1%: the particles are a small share of the pixels.
    await expect(page).toHaveScreenshot("flow-closeup.png", {
      maxDiffPixelRatio: 0.001,
    });

    // Zoomed out, the flow view shows the hint instead of particles.
    await page.evaluate(() =>
      (
        window as unknown as { __map: { setZoom(z: number): void } }
      ).__map.setZoom(10),
    );
    await waitForMapIdle(page);
    await expect(page.getByText(en.flow.zoomHint)).toBeVisible();
  });
});
