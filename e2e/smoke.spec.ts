import { expect, test } from "@playwright/test";
import { messagesFor } from "../i18n/messages";
import { openMap, REGION_PATH, stubImagery } from "./map-helpers";

// The specs open Río Negro's paths (map-helpers.ts REGION_PATH); `/` is the hub.
const en = messagesFor("nqn", "en");
const es = messagesFor("nqn", "es");

const messages = { en, es } as const;

for (const [browserLocale, expected] of [
  ["es-AR", "es"],
  ["en-US", "en"],
  ["de-DE", "es"], // unsupported language falls back to the default locale
] as const) {
  test(`the landing renders ${expected} for ${browserLocale}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: browserLocale });
    const page = await context.newPage();
    await stubImagery(page);
    await page.goto(REGION_PATH);
    await expect(page.locator("html")).toHaveAttribute("lang", expected);
    await expect(page).toHaveTitle(messages[expected].metadata.title);
    await context.close();
  });
}

test("legacy /en links redirect to the map and keep English", async ({
  page,
}) => {
  await stubImagery(page);
  await page.goto(`/en${REGION_PATH}?r=test`);
  await expect(page).toHaveURL(/\/rionegro\/map\?r=test$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("links from before /map open the map", async ({ page }) => {
  await stubImagery(page);
  await page.goto(`${REGION_PATH}?r=limay`);
  await expect(page).toHaveURL(/\/rionegro\/map\?r=limay$/);
});

for (const [locale, other] of [
  ["en", "es"],
  ["es", "en"],
] as const) {
  test.describe(locale, () => {
    test.use({ locale: locale === "en" ? "en-US" : "es-AR" });

    test("renders translated content", async ({ page }) => {
      await stubImagery(page);
      await page.goto(`${REGION_PATH}/map`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        messages[locale].home.title,
      );
    });

    test("landing renders translated content", async ({ page }) => {
      await page.goto(REGION_PATH);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        messages[locale].landing.h1,
      );
    });

    test("locale switcher changes language without navigating", async ({
      page,
    }) => {
      await openMap(page, "/map?r=test");
      // Button names are the language names (localeSwitcher.locale), same in both locales.
      await page
        .getByRole("group", { name: messages[locale].localeSwitcher.label })
        .getByRole("button", { name: other === "en" ? "English" : "Español" })
        .click();
      await expect(page.locator("html")).toHaveAttribute("lang", other);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        messages[other].home.title,
      );
      await expect(page).toHaveURL(/\/rionegro\/map\?r=test$/);
    });

    test("screenshot", async ({ page }) => {
      await openMap(page, "/map");
      await expect(page).toHaveScreenshot(`home-${locale}.png`);
    });
  });
}
