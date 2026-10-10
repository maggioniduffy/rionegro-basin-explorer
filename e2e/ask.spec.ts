import { expect, test } from "@playwright/test";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { openMap } from "./map-helpers";

// No LLM env in e2e: only the fuzzy-name paths of /api/ask are exercised.

test.describe("ask (en)", () => {
  test.use({ locale: "en-US" });

  test("a river name selects that river", async ({ page }) => {
    await openMap(page, "/map");
    await page.getByRole("textbox", { name: en.ask.label }).fill("collon cura");
    await page.getByRole("button", { name: en.ask.submit }).click();
    await expect(page).toHaveURL(/[?&]r=collon-cura(&|$)/);
    await expect(
      page.getByRole("heading", { name: "Río Collón Curá" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: en.ask.label })).toHaveValue(
      "",
    );
  });

  test("Escape clears the text and disables submit", async ({ page }) => {
    await openMap(page, "/map");
    const input = page.getByRole("textbox", { name: en.ask.label });
    await input.fill("limay");
    await input.press("Escape");
    await expect(input).toHaveValue("");
    await expect(
      page.getByRole("button", { name: en.ask.submit }),
    ).toBeDisabled();
  });
});

test.describe("ask (es)", () => {
  test.use({ locale: "es-AR" });

  test("a sub-basin phrase selects that sub-basin", async ({ page }) => {
    await openMap(page, "/map");
    await page
      .getByRole("textbox", { name: es.ask.label })
      .fill("cuenca del neuquen");
    await page.getByRole("textbox", { name: es.ask.label }).press("Enter");
    await expect(page).toHaveURL(/[?&]s=neuquen(&|$)/);
  });
});
