import { expect, test } from "@playwright/test";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { openMap, stubImagery } from "./map-helpers";

const messages = { en, es } as const;

for (const [browserLocale, expected] of [
  ["es-AR", "es"],
  ["en-US", "en"],
  ["de-DE", "es"], // unsupported language falls back to the default locale
] as const) {
  test(`/ renders ${expected} for ${browserLocale}`, async ({ browser }) => {
    const context = await browser.newContext({ locale: browserLocale });
    const page = await context.newPage();
    await stubImagery(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", expected);
    await expect(page).toHaveTitle(messages[expected].metadata.title);
    await context.close();
  });
}

test("legacy /en links redirect to / and keep English", async ({ page }) => {
  await stubImagery(page);
  await page.goto("/en?r=test");
  await expect(page).toHaveURL(/\/\?r=test$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

for (const [locale, other] of [
  ["en", "es"],
  ["es", "en"],
] as const) {
  test.describe(locale, () => {
    test.use({ locale: locale === "en" ? "en-US" : "es-AR" });

    test("renders translated content", async ({ page }) => {
      await stubImagery(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        messages[locale].home.title,
      );
    });

    test("locale switcher changes language without navigating", async ({
      page,
    }) => {
      await openMap(page, "/?r=test");
      // Button names are the language names (localeSwitcher.locale), same in both locales.
      await page
        .getByRole("group", { name: messages[locale].localeSwitcher.label })
        .getByRole("button", { name: other === "en" ? "English" : "Español" })
        .click();
      await expect(page.locator("html")).toHaveAttribute("lang", other);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        messages[other].home.title,
      );
      await expect(page).toHaveURL(/\/\?r=test$/);
    });

    test("screenshot", async ({ page }) => {
      await openMap(page, "/");
      await expect(page).toHaveScreenshot(`home-${locale}.png`);
    });
  });
}
