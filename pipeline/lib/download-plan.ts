export type DownloadAction =
  | { kind: "skip" }
  | { kind: "extract" }
  | { kind: "download" }
  | { kind: "error"; reason: string };

export interface DownloadState {
  /** Checksum recorded in the committed manifest, if any. */
  manifestSha?: string;
  /** Checksum stored next to the extracted files when extraction finished. */
  extractedSha?: string;
  /** Checksum of an archive already on disk, if any. */
  archiveSha?: string;
}

/**
 * Decide what the download step does for one source. Pure, so it is unit-tested.
 * A checksum that disagrees with the manifest is an error: upstream files do get
 * re-uploaded, and we want to notice rather than silently change inputs.
 */
export function planDownload({
  manifestSha,
  extractedSha,
  archiveSha,
}: DownloadState): DownloadAction {
  if (extractedSha) {
    if (manifestSha && extractedSha !== manifestSha) {
      return {
        kind: "error",
        reason: "extracted files do not match the manifest checksum",
      };
    }
    return { kind: "skip" };
  }
  if (archiveSha) {
    if (manifestSha && archiveSha !== manifestSha) {
      return {
        kind: "error",
        reason: "archive on disk does not match the manifest checksum",
      };
    }
    return { kind: "extract" };
  }
  return { kind: "download" };
}
