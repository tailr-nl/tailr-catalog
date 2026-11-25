import { collect, divisionInfo, divisionOf, GUID, type Row } from "./lib/exact";

/**
 * Mailboxen van Exact voor deze administratie, om te zien waar upload_receipt naartoe moet.
 * - mailboxes: mailbox/Mailboxes met ForDivision = deze administratie
 * - default_mailbox: read/mailbox/DefaultMailbox (de digitale postbus)
 * - preferred_for_operation: read/mailbox/PreferredMailboxForOperation?operation=1 en =2
 *   (inkoopfactuur zonder en met details), met IsScanServiceMailbox
 * Alleen lezen. Mailboxadressen zijn adressen bij Exact, geen gegevens van klanten.
 */
const FIELDS = ["ID", "Mailbox", "ForDivision", "Type", "Publish", "ValidFrom", "ValidTo"];
const TYPES: Record<number, string> = { 0: "unknown", 1: "exact", 2: "government", 3: "manual_input" };

function guidOrNull(v: unknown): string | null {
  return typeof v === "string" && GUID.test(v.toLowerCase()) ? v.toLowerCase() : null;
}

/** Eén rij uit een read/mailbox-functie; Exact geeft d als object of d.results als lijst */
function firstRow(res: any): Row | null {
  const d = res?.data?.d;
  if (Array.isArray(d)) return d[0] ?? null;
  if (Array.isArray(d?.results)) return d.results[0] ?? null;
  return d && typeof d === "object" ? d : null;
}

function readView(row: Row | null) {
  if (!row) return null;
  return {
    id: guidOrNull(row.ID),
    mailbox: typeof row.Mailbox === "string" ? row.Mailbox : null,
    description: typeof row.Description === "string" ? row.Description : null,
    for_division: row.ForDivision ?? null,
    is_scan_service_mailbox: typeof row.IsScanServiceMailbox === "boolean" ? row.IsScanServiceMailbox : null,
    type: row.Type ?? null,
  };
}

async function readMailbox(ctx: any, path: string, query?: Record<string, string | number>) {
  try {
    const res = await ctx.request({ method: "GET", path, ...(query ? { query } : {}) });
    return { result: readView(firstRow(res)), error: null as string | null };
  } catch (e: any) {
    return { result: null, error: `${e?.code ?? "source_error"}${e?.status ? ` (HTTP ${e.status})` : ""}` };
  }
}

export default async function listMailboxes(_args: Record<string, never>, ctx: any) {
  const division = divisionOf(ctx);
  const r = await collect(ctx, "mailbox/Mailboxes", FIELDS, `ForDivision eq ${division}`, { maxRows: 50, maxPages: 2 });
  const mailboxes = r.items.map((m) => ({
    id: guidOrNull(m.ID),
    mailbox: typeof m.Mailbox === "string" ? m.Mailbox : null,
    for_division: m.ForDivision ?? null,
    type: m.Type ?? null,
    type_label: typeof m.Type === "number" ? (TYPES[m.Type] ?? "unknown") : null,
    publish: m.Publish ?? null,
  }));
  const def = await readMailbox(ctx, `/${division}/read/mailbox/DefaultMailbox`);
  const op1 = await readMailbox(ctx, `/${division}/read/mailbox/PreferredMailboxForOperation`, { operation: 1 });
  const op2 = await readMailbox(ctx, `/${division}/read/mailbox/PreferredMailboxForOperation`, { operation: 2 });
  return {
    division: await divisionInfo(ctx),
    mailboxes,
    count: mailboxes.length,
    default_mailbox: def.result,
    preferred_for_operation: {
      "1_purchase_invoice_without_details": op1.result,
      "2_purchase_invoice_with_details": op2.result,
    },
    errors: { default_mailbox: def.error, operation_1: op1.error, operation_2: op2.error },
    complete: r.complete && !def.error && !op1.error && !op2.error,
    limitations: [
      "mailboxes: only mailboxes with ForDivision = this administration. default_mailbox is the administration's digital postbox.",
      "preferred_for_operation is what Exact returns for read/mailbox/PreferredMailboxForOperation; is_scan_service_mailbox comes from Exact. If it differs from the mailbox upload_receipt used, pass it as recipient_mailbox_id.",
    ],
  };
}
