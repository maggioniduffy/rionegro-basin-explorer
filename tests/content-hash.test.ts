import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentVersion } from "@/lib/content-hash";

const dirs: string[] = [];
afterEach(async () =>
  Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  ),
);

describe("contentVersion", () => {
  it("matches a manifest-style hash independent of directory order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "basin-content-"));
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "z.pmtiles"), "z");
    await writeFile(path.join(dir, "a.pmtiles"), "a");
    await writeFile(path.join(dir, "ignored.txt"), "ignored");
    expect(contentVersion(dir, ".pmtiles")).toBe("992b65c0b38f");
  });
});
