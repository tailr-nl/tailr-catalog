/**
 * Alle rijen van de zoekprestaties ophalen, voorbij de 25.000 per aanroep.
 *
 * De Search Console API geeft per aanroep hoogstens 25.000 rijen. Deze functie
 * vraagt pagina's van 25.000 op met een oplopende startRow tot Google minder dan
 * een volle pagina teruggeeft (einde) of het plafond maxRows is bereikt.
 * complete = false als het plafond eerder kwam dan het einde.
 */

const PAGE = 25_000;
const DEFAULT_MAX = 100_000;
const HARD_MAX = 250_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIMENSIONS = new Set(["query", "page", "country", "device", "date", "searchAppearance"]);
const TYPES = new Set(["web", "image", "video", "news", "discover", "googleNews"]);
const DATA_STATES = new Set(["final", "all"]);
const AGGREGATIONS = new Set(["auto", "byPage", "byProperty"]);

type Args = {
  site?: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  dimensionFilterGroups?: unknown[];
  type?: string;
  dataState?: string;
  aggregationType?: string;
  maxRows?: number;
};

type Row = { keys?: unknown[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

function oneOf(value: unknown, allowed: Set<string>, name: string, ctx: any): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const s = String(value);
  if (!allowed.has(s)) ctx.fail("invalid_input", `${name} must be one of: ${[...allowed].join(", ")}`);
  return s;
}

export default async function searchAnalyticsAll(args: Args, ctx: any) {
  const site = String(args.site ?? ctx.vars.SITE_URL ?? "").trim();
  if (!site) ctx.fail("invalid_input", "No site given and no default website set for this connection. Pass site (e.g. sc-domain:example.com).");
  const startDate = String(args.startDate ?? "").trim();
  const endDate = String(args.endDate ?? "").trim();
  if (!DATE.test(startDate) || !DATE.test(endDate)) ctx.fail("invalid_input", "startDate and endDate must be YYYY-MM-DD");
  if (startDate > endDate) ctx.fail("invalid_input", "startDate must not be after endDate");

  let dimensions: string[] | undefined;
  if (args.dimensions !== undefined && args.dimensions !== null) {
    if (!Array.isArray(args.dimensions)) ctx.fail("invalid_input", "dimensions must be an array");
    dimensions = args.dimensions.map((d) => String(d));
    for (const d of dimensions) if (!DIMENSIONS.has(d)) ctx.fail("invalid_input", `Unknown dimension ${d}. Use: ${[...DIMENSIONS].join(", ")}`);
  }
  if (args.dimensionFilterGroups !== undefined && args.dimensionFilterGroups !== null && !Array.isArray(args.dimensionFilterGroups)) {
    ctx.fail("invalid_input", "dimensionFilterGroups must be an array");
  }
  const type = oneOf(args.type, TYPES, "type", ctx);
  const dataState = oneOf(args.dataState, DATA_STATES, "dataState", ctx);
  const aggregationType = oneOf(args.aggregationType, AGGREGATIONS, "aggregationType", ctx);
  if ((type === "discover" || type === "googleNews") && dimensions?.includes("query")) {
    ctx.fail("invalid_input", `type ${type} has no query dimension; group by page, country, device or date instead`);
  }

  let maxRows = DEFAULT_MAX;
  if (args.maxRows !== undefined && args.maxRows !== null) {
    const n = Number(args.maxRows);
    if (!Number.isInteger(n) || n < 1) ctx.fail("invalid_input", "maxRows must be a positive whole number");
    maxRows = Math.min(n, HARD_MAX);
  }

  const path = `/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const rows: Row[] = [];
  let pages = 0;
  let complete = false;
  let metadata: unknown;
  let responseAggregationType: unknown;
  let startRow = 0;

  while (rows.length < maxRows) {
    const rowLimit = Math.min(PAGE, maxRows - rows.length);
    const body: Record<string, unknown> = { startDate, endDate, rowLimit, startRow };
    if (dimensions) body.dimensions = dimensions;
    if (args.dimensionFilterGroups) body.dimensionFilterGroups = args.dimensionFilterGroups;
    if (type) body.type = type;
    if (dataState) body.dataState = dataState;
    if (aggregationType) body.aggregationType = aggregationType;

    const res = await ctx.request({ method: "POST", path, body });
    pages++;
    const data = res.data ?? {};
    const page: unknown = data.rows;
    if (page !== undefined && !Array.isArray(page)) ctx.fail("source_error", "Search Console returned an unexpected answer (rows is not a list)");
    const list = (page ?? []) as Row[];
    if (metadata === undefined && data.metadata) metadata = data.metadata;
    if (responseAggregationType === undefined && data.responseAggregationType) responseAggregationType = data.responseAggregationType;
    for (const r of list) rows.push({ keys: r.keys, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
    ctx.log(`page ${pages}: ${list.length} rows (startRow ${startRow})`);
    if (list.length < rowLimit) {
      complete = true;
      break;
    }
    startRow += list.length;
  }
  if (!complete && rows.length >= maxRows) {
    // Het plafond is bereikt; misschien is er nog meer.
    complete = false;
  }

  return {
    site,
    startDate,
    endDate,
    dimensions: dimensions ?? [],
    type: type ?? "web",
    dataState: dataState ?? "final",
    ...(responseAggregationType !== undefined ? { responseAggregationType } : {}),
    rowCount: rows.length,
    pages,
    complete,
    ...(complete ? {} : { reason: "max_rows_reached", hint: `Stopped at ${rows.length} rows (maxRows). Narrow the period, add a filter or raise maxRows (up to ${HARD_MAX}).` }),
    ...(metadata !== undefined ? { metadata } : {}),
    rows,
  };
}
