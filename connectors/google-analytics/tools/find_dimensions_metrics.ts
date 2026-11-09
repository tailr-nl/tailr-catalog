/**
 * Zoeken in de metadata van een GA4-property: welke dimensies en metrics zijn er,
 * en hoe heten ze precies in de API?
 *
 * De volledige metadata (GET /properties/<id>/metadata) is honderden items groot.
 * Deze functie haalt hem op, zoekt hoofdletterongevoelig in apiName, uiName en
 * description en geeft hoogstens 50 treffers terug, met eigen (custom) definities
 * herkenbaar aan customDefinition.
 */

type Row = Record<string, any>;
type Kind = "dimension" | "metric";

const PROPERTY = /^[0-9]{1,20}$/;
const MAX_RESULTS = 50;
const DESCRIPTION_LENGTH = 160;

function propertyOf(args: Row, ctx: any): string {
  const given = args.property;
  const raw = given === undefined || given === null || given === "" ? ctx.vars.PROPERTY_ID : given;
  const id = String(raw ?? "").trim().replace(/^properties\//, "");
  if (!PROPERTY.test(id)) {
    ctx.fail("invalid_input", "Give a numeric property id (e.g. 123456789), or set the property in the connection settings. Use list_properties to find it.");
  }
  return id;
}

function shorten(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** Lagere score = betere treffer: exacte apiName eerst, dan apiName, uiName, en pas daarna de beschrijving. */
function score(item: Row, terms: string[], phrase: string): number | null {
  const api = String(item.apiName ?? "").toLowerCase();
  const ui = String(item.uiName ?? "").toLowerCase();
  const desc = String(item.description ?? "").toLowerCase();
  const hay = `${api} ${ui} ${desc}`;
  if (!terms.every((t) => hay.includes(t))) return null;
  if (api === phrase || ui === phrase) return 0;
  if (terms.every((t) => api.includes(t))) return 1;
  if (terms.every((t) => ui.includes(t))) return 2;
  if (terms.every((t) => `${api} ${ui}`.includes(t))) return 3;
  return 4;
}

function project(kind: Kind, item: Row): Row {
  const out: Row = {
    kind,
    apiName: item.apiName ?? null,
    uiName: item.uiName ?? null,
    category: item.category ?? null,
    description: shorten(item.description, DESCRIPTION_LENGTH),
    customDefinition: item.customDefinition === true,
  };
  if (kind === "metric") {
    out.type = item.type ?? null;
    if (typeof item.expression === "string" && item.expression) out.expression = item.expression;
    if (Array.isArray(item.blockedReasons) && item.blockedReasons.length) out.blockedReasons = item.blockedReasons;
  }
  if (Array.isArray(item.deprecatedApiNames) && item.deprecatedApiNames.length) out.deprecatedApiNames = item.deprecatedApiNames;
  return out;
}

export default async function findDimensionsMetrics(args: { search: string; kind?: string; property?: string }, ctx: any) {
  const search = String(args.search ?? "").trim().toLowerCase();
  if (search.length < 2 || search.length > 100) ctx.fail("invalid_input", "Give a search term of 2 to 100 characters, e.g. \"landing page\" or \"revenue\"");
  const kind = String(args.kind ?? "both");
  if (!["dimensions", "metrics", "both"].includes(kind)) ctx.fail("invalid_input", "kind must be dimensions, metrics or both");
  const property = propertyOf(args, ctx);
  const terms = search.split(/\s+/).filter(Boolean);

  let res: any;
  try {
    res = await ctx.request({ method: "GET", path: `/properties/${property}/metadata` });
  } catch (e: any) {
    if (e?.status === 403) ctx.fail("access_denied", `Google Analytics refused access to property ${property}: ${e.message ?? "forbidden"}`);
    if (e?.status === 404) ctx.fail("not_found", `Property ${property} was not found. Use list_properties to see the available properties.`);
    throw e;
  }
  const data = res?.data;
  const dimensions: Row[] = Array.isArray(data?.dimensions) ? data.dimensions : [];
  const metrics: Row[] = Array.isArray(data?.metrics) ? data.metrics : [];
  if (!data || typeof data !== "object" || (!dimensions.length && !metrics.length)) ctx.fail("source_error", "Google Analytics returned no metadata for this property");

  const scored: { score: number; order: number; item: Row }[] = [];
  let order = 0;
  const consider = (k: Kind, list: Row[]) => {
    for (const item of list) {
      const s = score(item, terms, search);
      if (s !== null) scored.push({ score: s, order: order++, item: project(k, item) });
    }
  };
  if (kind !== "metrics") consider("dimension", dimensions);
  if (kind !== "dimensions") consider("metric", metrics);
  scored.sort((a, b) => a.score - b.score || a.order - b.order);

  const matches = scored.slice(0, MAX_RESULTS).map((s) => s.item);
  const count = (k: Kind) => scored.filter((s) => s.item.kind === k).length;
  return {
    property,
    search,
    kind,
    available: { dimensions: dimensions.length, metrics: metrics.length },
    totalMatches: scored.length,
    truncated: scored.length > MAX_RESULTS,
    matches,
    ...(scored.length === 0 ? { hint: "No dimension or metric matches. Try another word (English, as in the Google Analytics interface), or a part of the name." } : {}),
    ...(scored.length > MAX_RESULTS ? { hint: `Only the first ${MAX_RESULTS} of ${scored.length} matches are shown. Narrow the search, or set kind to dimensions or metrics.` } : {}),
  };
}
