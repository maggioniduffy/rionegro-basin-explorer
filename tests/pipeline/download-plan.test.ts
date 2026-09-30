import { describe, expect, it } from "vitest";
import { planDownload } from "../../pipeline/lib/download-plan";

describe("planDownload", () => {
  it("downloads when nothing is on disk", () => {
    expect(planDownload({})).toEqual({ kind: "download" });
    expect(planDownload({ manifestSha: "a" })).toEqual({ kind: "download" });
  });

  it("skips when extracted files match the manifest", () => {
    expect(planDownload({ manifestSha: "a", extractedSha: "a" })).toEqual({
      kind: "skip",
    });
  });

  it("skips extracted files when there is no manifest entry yet", () => {
    expect(planDownload({ extractedSha: "a" })).toEqual({ kind: "skip" });
  });

  it("extracts an archive already on disk", () => {
    expect(planDownload({ archiveSha: "a" })).toEqual({ kind: "extract" });
    expect(planDownload({ manifestSha: "a", archiveSha: "a" })).toEqual({
      kind: "extract",
    });
  });

  it("errors on checksum mismatches", () => {
    expect(planDownload({ manifestSha: "a", extractedSha: "b" }).kind).toBe(
      "error",
    );
    expect(planDownload({ manifestSha: "a", archiveSha: "b" }).kind).toBe(
      "error",
    );
  });

  it("prefers extracted files over a leftover archive", () => {
    expect(
      planDownload({ manifestSha: "a", extractedSha: "a", archiveSha: "b" }),
    ).toEqual({
      kind: "skip",
    });
  });
});
