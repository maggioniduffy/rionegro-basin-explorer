import { normalizeSearch } from "./search";

/** Query and path input limits for the public API. */
export const SEARCH_MAX_LENGTH = 64;
export const SEARCH_LIMIT = 8;

/** River slugs as written by pipeline/lib/names.ts slugify. */
export function parseRiverId(raw: string): string | null {
  return /^[a-z0-9-]{1,64}$/.test(raw) ? raw : null;
}

/** HydroRIVERS HYRIV_ID: a positive integer. */
export function parseReachId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** Normalized search text, or null when empty or too long. */
export function parseSearchQuery(raw: string | null): string | null {
  if (raw === null || raw.length > SEARCH_MAX_LENGTH) return null;
  const q = normalizeSearch(raw);
  return q === "" ? null : q;
}

/** Matches a normalized query at the start of any word of a normalized name. */
export function searchPattern(q: string): RegExp {
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^| )${escaped}`);
}
