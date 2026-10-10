import baseEn from "../messages/en.json";
import baseEs from "../messages/es.json";
import nqnEn from "../regions/nqn/messages/en.json";
import nqnEs from "../regions/nqn/messages/es.json";
import type { RegionId } from "../regions";
import type { Locale } from "./config";

/**
 * UI strings: /messages holds what every region shares; regions/<id>/messages holds the
 * strings that name the region (titles, landing copy, ask examples, the dam caveat), with
 * the same key paths. A region's file is merged over the shared one per request.
 * tests/messages.test.ts checks that every region defines the same keys as nqn and that
 * no key is defined in both places.
 */
export type RegionMessages = typeof nqnEn;
export type Messages = typeof baseEn & RegionMessages;

const BASE: Record<Locale, typeof baseEn> = { en: baseEn, es: baseEs };

export const REGION_MESSAGES: Record<
  RegionId,
  Record<Locale, RegionMessages>
> = {
  nqn: { en: nqnEn, es: nqnEs },
};

type Tree = { [key: string]: unknown };
const isTree = (v: unknown): v is Tree =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `over` merged into `base`, recursively; neither is modified. */
export function deepMerge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] =
      isTree(current) && isTree(value) ? deepMerge(current, value) : value;
  }
  return out;
}

export function messagesFor(region: RegionId, locale: Locale): Messages {
  return deepMerge(BASE[locale], REGION_MESSAGES[region][locale]) as Messages;
}
