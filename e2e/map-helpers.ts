import { crc32, deflateSync } from "node:zlib";
import { expect, type Page } from "@playwright/test";

/**
 * The e2e build points imagery at this host (playwright.config.ts), and every test
 * answers it with one solid tile, so screenshots don't depend on EOX or the network
 * and the mask holes stay visible.
 */
export const E2E_IMAGERY_HOST = "https://imagery.e2e.invalid";

function solidPng(size: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const TILE = solidPng(256, [122, 110, 84]);

export async function stubImagery(page: Page) {
  await page.route(`${E2E_IMAGERY_HOST}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
}

/** Wait until MapLibre has rendered everything it was loading. */
export async function waitForMapIdle(page: Page) {
  await expect(page.getByTestId("map")).toHaveAttribute(
    "data-map-idle",
    "true",
    { timeout: 30_000 },
  );
}

export async function openMap(page: Page, path: string) {
  await stubImagery(page);
  await page.goto(path);
  await waitForMapIdle(page);
}

/** Set the Visible Land slider the way a drag would (fires React's onChange). */
export async function setVisibleLand(page: Page, value: number) {
  await page.locator("#visible-land").fill(String(value));
  await waitForMapIdle(page);
}
