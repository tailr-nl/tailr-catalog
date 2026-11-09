/**
 * Een GA4-rapport (runReport) als gewone tabel.
 *
 * De Data API geeft kopregels en rijen apart (dimensionHeaders, metricHeaders,
 * rows[].dimensionValues[].value, rows[].metricValues[].value, alles tekst).
 * Deze functie zet dat om naar rijen als objecten met de dimensienaam en de
 * metricnaam als sleutel en metrics als getal, zodat de AI minder tokens nodig
 * heeft en koppen en waarden niet kan verwisselen.
 *
 * Zelfde invoer als run_report, en de aanroep gaat via run_report (ctx.call): zo blijft
 * dit een leesfunctie (een POST in "requests" zou het niveau op schrijven zetten),
 * en gelden de cache en limieten van run_report.
 */

type Row = Record<string, unknown>;

const PROPERTY = /^[0-9]{1,20}$/;
const BODY_KEYS = [
  "dateRanges",
  "dimensions",
  "metrics",
  "dimensionFilter",
  "metricFilter",
  "orderBys",
  "limit",
  "offset",
  "metricAggregations",
  "keepEmptyRows",
  "comparisons",
  "currencyCode",
  "returnPropertyQuota",
] as const;
const INTEGER_TYPES = new Set(["TYPE_INTEGER"]);

function propertyOf(args: Row, ctx: any): string {
  const given = args.property;
  const raw = given === undefined || given === null || given === "" ? ctx.vars.PROPERTY_ID : given;
  const id = String(raw ?? "").trim().replace(/^properties\//, "");
  if (!PROPERTY.test(id)) {
    ctx.fail("invalid_input", "Give a numeric property id (e.g. 123456789), or set the property in the connection settings. Use list_properties to find it.");
  }
  return id;
}

function nonEmptyList(value: unknown, name: string, ctx: any): void {
  if (!Array.isArray(value) || value.length === 0) ctx.fail("invalid_input", `${name} must be a non-empty list, e.g. ${name === "dateRanges" ? '[{"startDate":"28daysAgo","endDate":"yesterday"}]' : '[{"name":"sessions"}]'}`);
}

function metricNumber(value: unknown, type: string | undefined): unknown {
  if (typeof value !== "string" || value === "") return value ?? null;
  const n = INTEGER_TYPES.has(type ?? "") ? parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : value;
}

function headerNames(headers: unknown, key: string): { names: string[]; types: (string | undefined)[] } {
  const list = Array.isArray(headers) ? headers : [];
  return {
    names: list.map((h: any, i: number) => (typeof h?.[key] === "string" && h[key] ? h[key] : `${key === "name" ? "column" : key}_${i}`)),
    types: list.map((h: any) => (typeof h?.type === "string" ? h.type : undefined)),
  };
}

/** Een rij van Google (dimensionValues + metricValues) als object met de kopnamen als sleutel. */
function flattenRow(row: any, dims: string[], metrics: string[], types: (string | undefined)[]): Row {
  const out: Row = {};
  const dv = Array.isArray(row?.dimensionValues) ? row.dimensionValues : [];
  const mv = Array.isArray(row?.metricValues) ? row.metricValues : [];
  dims.forEach((name, i) => {
    out[name] = dv[i]?.value ?? null;
  });
  metrics.forEach((name, i) => {
    out[name] = metricNumber(mv[i]?.value, types[i]);
  });
  return out;
}

function quotaOf(q: any): Row | undefined {
  if (!q || typeof q !== "object") return undefined;
  const out: Row = {};
  for (const [k, v] of Object.entries(q as Row)) {
    const s = v as any;
    if (s && typeof s === "object") out[k] = { consumed: s.consumed ?? null, remaining: s.remaining ?? null };
  }
  return out;
}

export default async function runReportFlat(args: Row, ctx: any) {
  const property = propertyOf(args, ctx);
  nonEmptyList(args.dateRanges, "dateRanges", ctx);
  nonEmptyList(args.metrics, "metrics", ctx);

  const body: Row = {};
  for (const key of BODY_KEYS) {
    const v = args[key];
    if (v !== undefined && v !== null && v !== "") body[key] = v;
  }

  let data: any;
  try {
    const res = await ctx.call("run_report", { property, ...body });
    data = res && typeof res === "object" && "data" in res && !("rows" in res) && !("dimensionHeaders" in res) && !("metricHeaders" in res) ? (res as any).data : res;
  } catch (e: any) {
    if (e?.status === 400) ctx.fail("invalid_input", `Google Analytics rejected the report: ${e.message ?? "bad request"}. Check the dimension and metric names with find_dimensions_metrics, or the combination with check_compatibility.`);
    if (e?.status === 403) ctx.fail("source_auth_failed", `Google Analytics refused access to property ${property}: ${e.message ?? "forbidden"}. The account of this connection needs at least the Viewer role on the property.`);
    if (e?.status === 404) ctx.fail("not_found", `Property ${property} was not found. Use list_properties to see the available properties.`);
    throw e;
  }

  if (!data || typeof data !== "object" || (data.rows !== undefined && !Array.isArray(data.rows))) {
    ctx.fail("source_error", "Google Analytics returned an unexpected report");
  }

  const dims = headerNames(data.dimensionHeaders, "name");
  const mets = headerNames(data.metricHeaders, "name");
  const flatten = (rows: unknown): Row[] => (Array.isArray(rows) ? rows.map((r) => flattenRow(r, dims.names, mets.names, mets.types)) : []);

  const rows = flatten(data.rows);
  const rowCount = typeof data.rowCount === "number" ? data.rowCount : rows.length;
  const offset = typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : 0;
  const complete = offset + rows.length >= rowCount;

  const meta = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const metadata: Row = {
    currencyCode: meta.currencyCode ?? null,
    timeZone: meta.timeZone ?? null,
    dataLossFromOtherRow: meta.dataLossFromOtherRow === true,
    subjectToThresholding: meta.subjectToThresholding === true,
  };
  if (meta.emptyReason) metadata.emptyReason = meta.emptyReason;
  if (Array.isArray(meta.samplingMetadatas) && meta.samplingMetadatas.length) metadata.sampled = meta.samplingMetadatas;

  const out: Row = {
    property,
    dateRanges: args.dateRanges,
    dimensions: dims.names,
    metrics: mets.names.map((name, i) => ({ name, type: mets.types[i] ?? null })),
    rows,
    returnedRows: rows.length,
    rowCount,
    complete,
  };
  if (!complete) out.nextOffset = offset + rows.length;
  if (Array.isArray(data.totals) && data.totals.length) out.totals = flatten(data.totals);
  if (Array.isArray(data.minimums) && data.minimums.length) out.minimums = flatten(data.minimums);
  if (Array.isArray(data.maximums) && data.maximums.length) out.maximums = flatten(data.maximums);
  out.metadata = metadata;
  const quota = quotaOf(data.propertyQuota);
  if (quota) out.quota = quota;
  return out;
}
