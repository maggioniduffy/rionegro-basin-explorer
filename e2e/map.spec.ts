import { expect, test } from "@playwright/test";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { openMap, setVisibleLand, waitForMapIdle } from "./map-helpers";

test.describe("map (en)", () => {
  test.use({ locale: "en-US" });
  test.beforeEach(async ({ page }) => {
    await openMap(page, "/");
  });

  test("rivers only: narrowest Visible Land level", async ({ page }) => {
    await setVisibleLand(page, 0);
    await expect(page).toHaveScreenshot("visible-land-min.png");
  });

  test("whole basin: silhouette at the widest level", async ({ page }) => {
    await setVisibleLand(page, 5);
    await expect(page).toHaveScreenshot("visible-land-max.png");
  });

  test("hiding endorheic streams removes their lines", async ({ page }) => {
    await setVisibleLand(page, 5);
    await page.getByLabel(en.controls.hideEndorheic).check();
    await waitForMapIdle(page);
    await expect(page).toHaveScreenshot("endorheic-hidden.png");
  });

  test("small rivers appear when zooming in", async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: en.map.zoomIn }).click();
      await waitForMapIdle(page);
    }
    await expect(page).toHaveScreenshot("zoomed-in.png");
  });

  test("light theme applies and survives a reload", async ({ page }) => {
    await page.getByRole("button", { name: en.theme.toLight }).click();
    await waitForMapIdle(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await waitForMapIdle(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(
      page.getByRole("button", { name: en.theme.toDark }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("light-theme.png");
  });

  test("attribution credits imagery and data sources", async ({ page }) => {
    const attrib = page.locator(".maplibregl-ctrl-attrib");
    await expect(attrib).toContainText(en.map.attribution.hydrosheds);
    await expect(attrib).toContainText(en.map.attribution.gires);
    await expect(attrib).toContainText("E2E imagery");
  });
});

test.describe("map (es)", () => {
  test.use({ locale: "es-AR" });
  test("map controls are translated", async ({ page }) => {
    await openMap(page, "/");
    await expect(
      page.getByRole("button", { name: es.map.zoomIn }),
    ).toBeVisible();
    await expect(page.getByLabel(es.controls.visibleLand)).toBeVisible();
    await expect(page.getByText(es.legend.modeledNote)).toBeVisible();
  });
});
