import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { AskResult } from "../lib/ask/contract";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { openMap } from "./map-helpers";

// No LLM env in e2e: /api/ask is only exercised through its fuzzy-name paths; the answer
// card is driven by a stubbed response.

/** lengthKm of a river as seeded (data/out/rivers.ndjson). */
function riverLength(id: string): number {
  for (const line of readFileSync("data/out/rivers.ndjson", "utf8").split(
    "\n",
  )) {
    if (!line.trim()) continue;
    const doc = JSON.parse(line) as { _id: string; lengthKm?: number };
    if (doc._id === id && typeof doc.lengthKm === "number") return doc.lengthKm;
  }
  throw new Error(`no lengthKm for river ${id}`);
}

test.describe("search bar (en)", () => {
  test.use({ locale: "en-US" });

  test("a river name suggestion selects that river", async ({ page }) => {
    await openMap(page, "/map");
    await page
      .getByRole("combobox", { name: en.search.label })
      .fill("collon cura");
    await page.getByRole("option", { name: /Collón Curá/ }).click();
    await expect(page).toHaveURL(/[?&]r=collon-cura(&|$)/);
    await expect(
      page.getByRole("heading", { name: "Río Collón Curá" }),
    ).toBeVisible();
  });

  test("the list ends with the Ask option and Escape clears the bar", async ({
    page,
  }) => {
    await openMap(page, "/map");
    const input = page.getByRole("combobox", { name: en.search.label });
    await input.fill("limay");
    await expect(
      page.getByRole("option", { name: "Ask: «limay»" }),
    ).toBeVisible();
    await input.press("Escape");
    await expect(input).toHaveValue("");
  });

  test("an answer opens a card and selects the winner", async ({ page }) => {
    const agrio = riverLength("agrio");
    const caleufu = riverLength("caleufu");
    const [winner, other] =
      agrio >= caleufu
        ? (["agrio", "caleufu"] as const)
        : (["caleufu", "agrio"] as const);
    const values = { agrio, caleufu };
    const result: AskResult = {
      action: "answer",
      source: "llm",
      select: { kind: "river", id: winner },
      answer: {
        type: "compare",
        kind: "river",
        metric: "length",
        order: "max",
        parent: null,
        items: [winner, other].map((id) => ({
          id,
          name: id === "agrio" ? "Río Agrio" : "Río Caleufú",
          value: values[id],
          modeled: false,
        })),
        winnerIds: [winner],
        provenance: "HydroRIVERS (test)",
      },
    };
    await page.route("**/api/ask", (route) => route.fulfill({ json: result }));

    await openMap(page, "/map");
    const input = page.getByRole("combobox", { name: en.search.label });
    await input.fill("which is longer, Caleufú or Agrio?");
    await input.press("Enter");

    const card = page.getByRole("region", { name: en.ask.label });
    await expect(card).toContainText("Río Agrio");
    await expect(card).toContainText("Río Caleufú");
    await expect(card).toContainText("HydroRIVERS (test)");
    await expect(page).toHaveURL(new RegExp(`[?&]r=${winner}(&|$)`));

    await input.press("Escape");
    await expect(card).toBeHidden();
  });
});

test.describe("search bar (es)", () => {
  test.use({ locale: "es-AR" });

  test("a sub-basin phrase selects that sub-basin", async ({ page }) => {
    await openMap(page, "/map");
    const input = page.getByRole("combobox", { name: es.search.label });
    await input.fill("cuenca del neuquen");
    // Three words: the Ask option is the active one.
    await input.press("Enter");
    await expect(page).toHaveURL(/[?&]s=neuquen(&|$)/);
  });
});
