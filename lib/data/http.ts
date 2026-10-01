/**
 * Data only changes when the seed runs, so the CDN may keep responses for a day and
 * serve stale ones for a week while revalidating. Browsers revalidate after 5 minutes.
 */
export const CACHE_PUBLIC =
  "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";

export function json(body: unknown, init?: { status?: number; cache?: string }) {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "Cache-Control": init?.cache ?? CACHE_PUBLIC },
  });
}

export const badRequest = () =>
  json({ error: "bad_request" }, { status: 400, cache: "no-store" });

/** Unknown ids are cached briefly: they only appear after a reseed. */
export const notFound = () =>
  json(
    { error: "not_found" },
    { status: 404, cache: "public, max-age=60, s-maxage=300" },
  );

/** Logs server-side only; the response carries no error details. */
export function serverError(where: string, error: unknown) {
  console.error(`${where} failed`, error);
  return json({ error: "server_error" }, { status: 500, cache: "no-store" });
}
