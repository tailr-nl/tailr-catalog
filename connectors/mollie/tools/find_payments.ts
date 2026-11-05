/**
 * Betalingen (tr_…) bij een ordernummer zoeken in de omschrijving.
 *
 * Mollie kan niet zoeken op omschrijving, dus we lopen de nieuwste betalingen
 * door (max. 10 pagina's van 100). Heel-woord-match: 10434 is niet 104345.
 * complete = false als de order ouder kan zijn dan wat we hebben doorzocht.
 */

const ORDER = /^[0-9A-Za-z-]{1,32}$/;
const PAGES = 10;
const LIMIT = 100;

function text(value: unknown, limit = 255): string | null {
  return typeof value === "string" ? value.slice(0, limit) : null;
}

export default async function findPayments(args: { order: string }, ctx: any) {
  const order = String(args.order ?? "").trim();
  if (!ORDER.test(order)) ctx.fail("invalid_input", "Order number: letters, digits and - only (max 32)");
  const escaped = order.replace(/-/g, "\\-");
  const whole = new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9A-Za-z]|$)`);

  const found: Record<string, unknown>[] = [];
  let from: string | null = null;
  let scanned = 0;
  let complete = false;
  for (let page = 0; page < PAGES; page++) {
    const query: Record<string, string | number> = { limit: LIMIT };
    if (from) query.from = from;
    if (ctx.vars.PROFILE_ID) query.profileId = ctx.vars.PROFILE_ID;
    const res = await ctx.request({ method: "GET", path: "/payments", query });
    const list = res.data?._embedded?.payments;
    if (!Array.isArray(list)) ctx.fail("source_error", "Mollie returned an unexpected list of payments");
    scanned += list.length;
    for (const p of list) {
      if (typeof p?.description === "string" && whole.test(p.description)) {
        found.push({
          id: text(p.id, 64),
          description: text(p.description),
          method: text(p.method, 64),
          status: text(p.status, 32),
          amount: p.amount ?? null,
          settlementAmount: p.settlementAmount ?? null,
          settlementId: text(p.settlementId, 64),
          createdAt: text(p.createdAt, 40),
          paidAt: text(p.paidAt, 40),
        });
      }
    }
    const href = res.data?._links?.next?.href;
    const next = typeof href === "string" ? /[?&]from=(tr_[A-Za-z0-9]{1,64})/.exec(href)?.[1] : undefined;
    if (!next) {
      complete = true;
      break;
    }
    from = next;
  }
  return {
    order,
    payments: found,
    scanned,
    complete,
    ...(complete ? {} : { reason: "scan_limit_reached", hint: `Only the ${scanned} most recent payments were searched` }),
  };
}
