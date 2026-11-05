import { Decimal } from "@tailr/connector";

/**
 * Gedeelde hulpfuncties voor de Exact-code-functies.
 *
 * - Alleen vaste GET-queries via ctx.request (zie "requests" in connector.json).
 * - Bladeren alleen met de $skiptoken uit __next; de next-URL zelf wordt nooit opgevraagd.
 * - Bedragen als Decimal; Exact geeft getallen, die we als tekst doorgeven ("278.5" blijft "278.5").
 *
 * Gebaseerd op exact-mcp (Joep Herrmann, 2026).
 */

export type Row = Record<string, any>;

export const SIGN = "AmountDC > 0 is debit, < 0 is credit (default currency of the division)";
export const CODE = /^[0-9A-Za-z]{1,20}$/;
export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Collected {
  items: Row[];
  pages: number;
  complete: boolean;
  incompleteReason: string | null;
}

export function divisionOf(ctx: any): string {
  const d = String(ctx.vars.DIVISION ?? "").trim();
  if (!/^\d{1,10}$/.test(d)) ctx.fail("connection_misconfigured", "Set the administration number (division) in the connection settings. The function 'me' shows CurrentDivision.");
  return d;
}

/** Een geldige ISO-datum (YYYY-MM-DD) als dagnummer sinds 1970, of null. */
export function dayNumber(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const ms = Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  const back = new Date(ms).toISOString().slice(0, 10);
  return back === value ? Math.round(ms / 86_400_000) : null;
}

export function isoFromDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** Exact /Date(1700000000000)/ → "2023-11-14" (UTC), anders null. */
export function exactDate(value: unknown): string | null {
  const m = /^\/Date\((-?\d{1,15})\)\/$/.exec(String(value));
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}

export function amount(value: unknown): Decimal {
  if (value === null || value === undefined || value === "") throw new Error("invalid amount");
  return new Decimal(typeof value === "number" ? String(value) : (value as string));
}

export function money(value: Decimal): string {
  return value.toFixed(2);
}

export function sum(values: Decimal[]): Decimal {
  return values.reduce((a, b) => a.plus(b), new Decimal(0));
}

function skiptoken(next: string, resource: string): string | null {
  const m = /^https:\/\/[^/]+\/api\/v1\/\d+\/([^?]+)\?(.*)$/.exec(next);
  if (!m || m[1]!.toLowerCase() !== resource.toLowerCase()) return null;
  const tokens = m[2]!.split("&").filter((p) => p.startsWith("$skiptoken=") || p.startsWith("%24skiptoken="));
  if (tokens.length !== 1) return null;
  const raw = tokens[0]!.slice(tokens[0]!.indexOf("=") + 1);
  let token: string;
  try {
    token = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9'.:_-]{1,128}$/.test(token) ? token : null;
}

/**
 * Alle regels van één vaste query, pagina voor pagina via $skiptoken.
 * Stopt bij maxRows/maxPages met complete=false; dubbele id's tussen pagina's ook.
 */
export async function collect(ctx: any, resource: string, fields: string[], filter?: string, opts: { maxRows?: number; maxPages?: number; top?: number } = {}): Promise<Collected> {
  const maxRows = opts.maxRows ?? 5000;
  const maxPages = opts.maxPages ?? 120;
  const path = `/${divisionOf(ctx)}/${resource}`;
  const base: Record<string, string | number> = { $select: fields.join(",") };
  if (filter) base.$filter = filter;
  if (opts.top) base.$top = opts.top;
  let query = { ...base };
  const items: Row[] = [];
  let pages = 0;
  let incompleteReason: string | null = null;
  for (;;) {
    const res = await ctx.request({ method: "GET", path, query });
    const d = res.data?.d;
    const page = Array.isArray(d) ? d : d?.results;
    if (!Array.isArray(page) || !page.every((r: unknown) => r && typeof r === "object")) ctx.fail("source_error", `Exact returned an unexpected response for ${resource}`);
    items.push(...page);
    pages++;
    const next = !Array.isArray(d) ? d?.__next : undefined;
    if (opts.top) {
      // Eén pagina: meer beschikbaar als Exact een volgende pagina noemt of de pagina vol is
      if (next || page.length >= opts.top) incompleteReason = "more_available";
      break;
    }
    if (!next) break;
    if (items.length >= maxRows || pages >= maxPages) {
      incompleteReason = "row_or_page_cap_reached";
      break;
    }
    const token = skiptoken(String(next), resource);
    if (!token) ctx.fail("source_error", `Exact returned an unexpected next link for ${resource}`);
    query = { ...base, $skiptoken: token! };
  }
  const ids = items.map((r) => r[fields[0]!]);
  if (new Set(ids).size !== ids.length) incompleteReason = incompleteReason ?? "duplicate_rows_between_pages";
  // Bedragen als tekst, met alleen de gevraagde velden
  const projected = items.map((row) => {
    const out: Row = {};
    for (const k of fields) {
      if (!(k in row)) continue;
      const v = row[k];
      out[k] = k.startsWith("Amount") && typeof v === "number" ? String(v) : v;
    }
    return out;
  });
  return { items: projected, pages, complete: incompleteReason === null, incompleteReason };
}

export async function divisionInfo(ctx: any): Promise<{ code: number | null; name: string | null; currency: string | null }> {
  const division = divisionOf(ctx);
  try {
    const r = await collect(ctx, "system/Divisions", ["Code", "Description", "Currency"], `Code eq ${division}`, { maxRows: 5, maxPages: 1 });
    const row = r.items[0] ?? {};
    return { code: Number(division), name: row.Description ?? null, currency: row.Currency ?? null };
  } catch {
    return { code: Number(division), name: null, currency: null };
  }
}

export const STATUS_LABELS: Record<number, string> = { 20: "open", 50: "processed" };

export const LINE_FIELDS = [
  "ID", "EntryID", "EntryNumber", "LineNumber", "Date", "FinancialYear", "FinancialPeriod", "JournalCode", "JournalDescription", "Type", "Status",
  "GLAccount", "GLAccountCode", "GLAccountDescription", "Description", "AmountDC", "AmountFC", "Currency", "Account", "AccountCode", "AccountName",
  "InvoiceNumber", "PaymentReference", "YourRef", "OrderNumber", "Document", "DocumentNumber", "DocumentSubject", "OffsetID", "Notes",
];

export function lineView(row: Row) {
  const value = amount(row.AmountDC);
  return {
    ID: row.ID, EntryID: row.EntryID, EntryNumber: row.EntryNumber, LineNumber: row.LineNumber,
    date: exactDate(row.Date), FinancialYear: row.FinancialYear, FinancialPeriod: row.FinancialPeriod,
    JournalCode: row.JournalCode, JournalDescription: row.JournalDescription,
    GLAccountCode: row.GLAccountCode, GLAccountDescription: row.GLAccountDescription,
    Description: row.Description, PaymentReference: row.PaymentReference, YourRef: row.YourRef,
    debit: value.gt(0) ? money(value) : "0.00", credit: value.lt(0) ? money(value.times(-1)) : "0.00", AmountDC: money(value),
    AmountFC: row.AmountFC, Currency: row.Currency,
    AccountCode: row.AccountCode, AccountName: row.AccountName, InvoiceNumber: row.InvoiceNumber,
    OrderNumber: row.OrderNumber, Document: row.Document, DocumentNumber: row.DocumentNumber,
    DocumentSubject: row.DocumentSubject, OffsetID: row.OffsetID, Notes: row.Notes,
    Type: row.Type, Status: row.Status, status_label: STATUS_LABELS[row.Status] ?? "unknown",
  };
}
export type LineView = ReturnType<typeof lineView>;

export function byDateEntryLine(a: LineView, b: LineView): number {
  return (a.date ?? "").localeCompare(b.date ?? "") || String(a.EntryNumber).localeCompare(String(b.EntryNumber)) || (a.LineNumber ?? 0) - (b.LineNumber ?? 0);
}
