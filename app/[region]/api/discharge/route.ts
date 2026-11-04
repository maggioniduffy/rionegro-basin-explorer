import { CACHE_FORECAST, json, notFound } from "@/lib/data/http";
import { parseRegion } from "@/lib/data/params";
import { fetchDischargeForecast } from "@/lib/effluent/glofas";
import { getEffluentRegion } from "@/lib/effluent/registry";

/** Year of the Copernicus notice: the values are served unmodified, so the "Generated using" wording applies. */
const source = (fetchedAt: string) => ({
  name: "GloFAS v4 via Open-Meteo Flood API",
  url: "https://open-meteo.com/en/docs/flood-api",
  licenses: [
    {
      name: "Open-Meteo data: CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
    },
    {
      name: "GloFAS: CEMS-FLOODS datasets licence",
      url: "https://ewds.climate.copernicus.eu/licences/cems-floods",
    },
  ],
  notice: `Generated using Copernicus Emergency Management Service information ${fetchedAt.slice(0, 4)}`,
});

export async function GET(
  _req: Request,
  ctx: RouteContext<"/[region]/api/discharge">,
) {
  const params = await ctx.params;
  const region = parseRegion(params.region);
  if (!region) return notFound();
  const effluent = getEffluentRegion(region);
  if (!effluent) return notFound();
  try {
    const forecast = await fetchDischargeForecast(effluent);
    return json(
      { region, source: source(forecast.fetchedAt), ...forecast },
      { cache: CACHE_FORECAST },
    );
  } catch (error) {
    console.error("api/discharge failed", error);
    return json(
      { error: "upstream_unavailable" },
      { status: 502, cache: "no-store" },
    );
  }
}
