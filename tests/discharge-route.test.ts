import { afterEach, describe, expect, it, vi } from "vitest";
import { CACHE_FORECAST } from "@/lib/data/http";
import { GET } from "@/app/[region]/api/discharge/route";

function daily() {
  const today = new Date();
  const time = Array.from({ length: 31 }, (_, i) =>
    new Date(today.getTime() + (i - 1) * 86_400_000).toISOString().slice(0, 10),
  );
  const col = (v: number) => time.map(() => v);
  return {
    daily: {
      time,
      river_discharge: col(5),
      river_discharge_median: col(6),
      river_discharge_p25: col(4),
      river_discharge_p75: col(8),
    },
  };
}

vi.mock("server-only", () => ({}));

const call = (region: string) =>
  GET(new Request(`http://localhost/${region}/api/discharge`), {
    params: Promise.resolve({ region }),
  } as never);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /[region]/api/discharge", () => {
  it("returns both cba gauges with the forecast cache header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(daily())),
    );
    const res = await call("cordoba");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(CACHE_FORECAST);
    const body = await res.json();
    expect(body.gauges.map((g: { id: string }) => g.id)).toEqual([
      "centro-civico",
      "san-roque-inflow",
    ]);
    expect(body.gauges[0].today.m3s).toBe(5);
    expect(body.gauges[0].days).toHaveLength(29);
  });

  it("404s a region without an effluent config", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call("rionegro")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 when the upstream fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const res = await call("cordoba");
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "upstream_unavailable" });
  });
});
