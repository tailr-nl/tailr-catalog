import { Decimal } from "@tailr/connector";

/**
 * Een Mollie-uitbetaling (settlement) uitsplitsen en controleren.
 *
 * Haalt de uitbetaling op en daarna alle regels: betalingen, captures (Klarna),
 * terugbetalingen en chargebacks. Telt met Decimal (nooit float) en controleert:
 *   som(regels.settlement_amount) - som(kosten.amount_gross) == uitbetaald bedrag
 * complete = true alleen als alles is opgehaald en klopt; anders staan de redenen in reasons.
 *
 * Gebaseerd op mollie-mcp (Joep Herrmann, 2026).
 */

type Amount = { currency: string; value: string };
type Row = Record<string, any>;

const SETTLEMENT_ID = /^stl_[A-Za-z0-9]{4,64}$/;
const SETTLEMENT_REF = /^[0-9]{1,12}\.[0-9]{4}\.[0-9]{2}$/;
const AMOUNT = /^-?[0-9]{1,15}(\.[0-9]{1,10})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_PAGES = 20;
const FORMULA = "sum(lines.settlement_amount) - sum(costs.amount_gross) == settlement.amount";

const KINDS = {
  payments: { type: "payment", limit: 100, prefix: "tr" },
  captures: { type: "capture", limit: 50, prefix: "cpt" },
  refunds: { type: "refund", limit: 50, prefix: "re" },
  chargebacks: { type: "chargeback", limit: 50, prefix: "chb" },
} as const;
type Kind = keyof typeof KINDS;

function parseAmount(value: unknown): { currency: string; value: Decimal } | null {
  const a = value as Amount | null;
  if (!a || typeof a !== "object" || typeof a.currency !== "string" || typeof a.value !== "string") return null;
  if (!CURRENCY.test(a.currency) || !AMOUNT.test(a.value)) return null;
  return { currency: a.currency, value: new Decimal(a.value) };
}

function amountOut(value: unknown): Amount | null {
  return parseAmount(value) ? { currency: (value as Amount).currency, value: (value as Amount).value } : null;
}

function text(value: unknown, limit = 255): string | null {
  return typeof value === "string" ? value.slice(0, limit) : null;
}

/** Cursor uit _links.next.href, alleen als die naar dezelfde lijst wijst. */
function nextCursor(href: unknown, path: string, prefix: string): string | null | "unsafe" {
  if (href === undefined || href === null) return null;
  if (typeof href !== "string") return "unsafe";
  const m = /^https:\/\/api\.mollie\.com\/v2(\/[^?#]*)\?([^#]*)$/.exec(href);
  if (!m || m[1] !== path) return "unsafe";
  const from = /(?:^|&)from=([^&]+)/.exec(m[2]!);
  if (!from || !new RegExp(`^${prefix}_[A-Za-z0-9]{1,64}$`).test(from[1]!)) return "unsafe";
  return from[1]!;
}

async function collect(ctx: any, stl: string, kind: Kind, reasons: string[], fetchErrors: Record<string, unknown>): Promise<Row[]> {
  const { limit, prefix } = KINDS[kind];
  const path = `/settlements/${stl}/${kind}`;
  const rows: Row[] = [];
  const seen = new Set<string>();
  let from: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query: Record<string, string | number> = { limit };
    if (from) query.from = from;
    if (kind === "payments") {
      if (ctx.vars.PROFILE_ID) query.profileId = ctx.vars.PROFILE_ID;
    } else query.embed = "payment";
    let res: any;
    try {
      res = await ctx.request({ method: "GET", path, query });
    } catch (e: any) {
      reasons.push(`fetch_failed:${kind}`);
      fetchErrors[kind] = { code: e.code, http_status: e.status ?? null };
      return rows;
    }
    const list = res.data?._embedded?.[kind];
    if (!Array.isArray(list) || list.length > limit || !list.every((r: Row) => r && typeof r.id === "string" && new RegExp(`^${prefix}_`).test(r.id))) {
      reasons.push(`fetch_failed:${kind}`);
      fetchErrors[kind] = { code: "invalid_mollie_response" };
      return rows;
    }
    for (const row of list) {
      if (seen.has(row.id)) {
        reasons.push(`duplicate_ids:${kind}`);
        continue;
      }
      seen.add(row.id);
      rows.push(row);
    }
    const cursor = nextCursor(res.data?._links?.next?.href, path, prefix);
    if (cursor === null) return rows;
    if (cursor === "unsafe") {
      reasons.push(`unsafe_next_link:${kind}`);
      return rows;
    }
    from = cursor;
  }
  reasons.push(`page_limit_reached:${kind}`);
  return rows;
}

function projectLine(kind: Kind, row: Row) {
  const pay = row._embedded?.payment ?? {};
  const isPayment = kind === "payments";
  const line: Row = {
    type: KINDS[kind].type,
    id: row.id,
    payment_id: text(isPayment ? row.id : row.paymentId, 64),
    order_description: text(isPayment ? row.description : pay.description),
    description: isPayment ? null : text(row.description),
    method: text(isPayment ? row.method : pay.method, 64),
    amount: amountOut(row.amount),
    settlement_amount: amountOut(row.settlementAmount),
    direction: null,
    date: text(isPayment ? row.paidAt ?? row.createdAt : row.createdAt, 40),
    status: text(row.status, 32),
  };
  if (kind === "chargebacks") line.reversed_at = text(row.reversedAt, 40);
  return line;
}

export default async function settlementBreakdown(args: { settlement: string }, ctx: any) {
  const id = String(args.settlement ?? "").trim();
  if (!SETTLEMENT_ID.test(id) && !SETTLEMENT_REF.test(id)) {
    ctx.fail("invalid_input", "Give a settlement id (stl_…) or bank reference like 19355824.2610.02");
  }

  let settlement: Row;
  try {
    settlement = (await ctx.request({ method: "GET", path: `/settlements/${id}` })).data;
  } catch (e: any) {
    if (e.code === "not_found") ctx.fail("not_found", `Settlement ${id} not found`);
    throw e;
  }
  const own = parseAmount(settlement?.amount);
  if (!settlement || typeof settlement.id !== "string" || !SETTLEMENT_ID.test(settlement.id) || !own) {
    ctx.fail("source_error", "Mollie returned an unexpected settlement");
  }
  const currency = own!.currency;
  const stl = settlement.id as string;

  const reasons: string[] = [];
  const fetchErrors: Record<string, unknown> = {};
  const collected = {} as Record<Kind, Row[]>;
  for (const kind of Object.keys(KINDS) as Kind[]) collected[kind] = await collect(ctx, stl, kind, reasons, fetchErrors);

  const lines: Row[] = [];
  const totals: Record<string, Row> = {};
  for (const kind of Object.keys(KINDS) as Kind[]) {
    let subtotal = new Decimal(0);
    for (const row of collected[kind]) {
      const line = projectLine(kind, row);
      const parsed = parseAmount(row.settlementAmount);
      if (row.settlementAmount === undefined || row.settlementAmount === null) reasons.push("settlement_amount_missing");
      else if (!parsed) reasons.push("invalid_amount");
      else if (parsed.currency !== currency) reasons.push("currency_mismatch");
      else {
        subtotal = subtotal.plus(parsed.value);
        line.direction = parsed.value.gt(0) ? "in" : parsed.value.lt(0) ? "out" : "zero";
      }
      lines.push(line);
    }
    totals[KINDS[kind].type] = { count: collected[kind].length, settlement_amount: subtotal.toString() };
  }

  const paymentIds = new Set(lines.filter((l) => l.type === "payment").map((l) => l.id));
  if (lines.some((l) => l.type === "capture" && paymentIds.has(l.payment_id))) reasons.push("payment_and_capture_overlap");

  const costs: Row[] = [];
  const periodRevenue: Row[] = [];
  let costsTotal = new Decimal(0);
  const periods = settlement.periods ?? {};
  for (const year of Object.keys(periods).sort()) {
    for (const month of Object.keys(periods[year] ?? {}).sort()) {
      const period = periods[year][month] ?? {};
      const sum = (items: Row[], key: string) => {
        const byCurrency: Record<string, Decimal> = {};
        for (const it of items) {
          const p = parseAmount(it?.[key]);
          if (p) byCurrency[p.currency] = (byCurrency[p.currency] ?? new Decimal(0)).plus(p.value);
        }
        return Object.fromEntries(Object.entries(byCurrency).map(([c, v]) => [c, v.toString()]));
      };
      const revenue: Row[] = Array.isArray(period.revenue) ? period.revenue : [];
      const periodCosts: Row[] = Array.isArray(period.costs) ? period.costs : [];
      periodRevenue.push({ period: `${year}-${month}`, revenue_gross_total: sum(revenue, "amountGross"), costs_gross_total: sum(periodCosts, "amountGross") });
      for (const cost of periodCosts) {
        const p = parseAmount(cost.amountGross);
        if (!p) reasons.push("invalid_amount");
        else if (p.currency !== currency) reasons.push("currency_mismatch");
        else costsTotal = costsTotal.plus(p.value);
        costs.push({ period: `${year}-${month}`, description: text(cost.description), method: text(cost.method, 64), count: typeof cost.count === "number" ? cost.count : null, amount_gross: amountOut(cost.amountGross) });
      }
    }
  }
  totals.costs = { count: costs.length, amount_gross: costsTotal.toString() };

  let linesTotal = new Decimal(0);
  for (const [k, t] of Object.entries(totals)) if (k !== "costs") linesTotal = linesTotal.plus(t.settlement_amount);
  const computed = linesTotal.minus(costsTotal);
  const difference = own!.value.minus(computed);
  if (!difference.eq(0)) reasons.push("amount_mismatch");
  const unique = [...new Set(reasons)];

  return {
    settlement: {
      id: stl,
      reference: text(settlement.reference, 32),
      status: text(settlement.status, 32),
      createdAt: text(settlement.createdAt, 40),
      settledAt: text(settlement.settledAt, 40),
      amount: amountOut(settlement.amount),
      balanceId: text(settlement.balanceId, 64),
    },
    lines,
    costs,
    totals,
    period_revenue: periodRevenue,
    check: {
      formula: FORMULA,
      currency,
      lines_total: linesTotal.toString(),
      costs_total: costsTotal.toString(),
      computed: computed.toString(),
      settlement_amount: own!.value.toString(),
      difference: difference.toString(),
      matches: difference.eq(0),
    },
    complete: unique.length === 0,
    reasons: unique,
    fetch_errors: fetchErrors,
  };
}
