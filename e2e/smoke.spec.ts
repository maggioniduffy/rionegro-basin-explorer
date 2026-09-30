import { expect, test } from "@playwright/test";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { openMap, stubImagery } from "./map-helpers";

const locales = [
  { locale: "en", other: "es", messages: en, otherMessages: es },
  { locale: "es", other: "en", messages: es, otherMessages: en },
] as const;

for (const [browserLocale, expected] of [
  ["es-AR", "es"],
  ["en-US", "en"],
  ["de-DE", "es"], // unsupported language falls back to the default locale
] as const) {
  test(`/ redirects ${browserLocale} to /${expected}`, async ({ browser }) => {
    const context = await browser.newContext({ locale: browserLocale });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`/${expected}$`));
    await context.close();
  });
}

for (const { locale, other, messages, otherMessages } of locales) {
  test.describe(`/${locale}`, () => {
    test("renders translated content", async ({ page }) => {
      await stubImagery(page);
      await page.goto(`/${locale}`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        messages.home.title,
      );
      await expect(page).toHaveTitle(messages.metadata.title);
    });

    test("locale switcher keeps the query string", async ({ page }) => {
      await stubImagery(page);
      await page.goto(`/${locale}?r=test`);
      await page.getByLabel(messages.localeSwitcher.label).selectOption(other);
      await expect(page).toHaveURL(new RegExp(`/${other}\\?r=test$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        otherMessages.home.title,
      );
    });

    test("screenshot", async ({ page }) => {
      await openMap(page, `/${locale}`);
      await expect(page).toHaveScreenshot(`home-${locale}.png`);
    });
  });
}
