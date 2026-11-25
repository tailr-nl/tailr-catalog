import { Decimal } from "@tailr/connector";
import { amount, CODE, collect, dayNumber, divisionInfo, exactDate, GUID, money, type Row } from "./lib/exact";

/**
 * Openstaande leveranciersposten, zoals het scherm "Openstaande posten | Te betalen" in Exact.
 *
 * Bron: read/financial/PayablesList. Volgens de documentatie van Exact ontstaat daar een regel
 * "when an purchase invoice is created or when money is paid to the supplier": inkoopfacturen én
 * betalingen aan een leverancier. De velden zijn de kolommen van het scherm (factuur, datum,
 * boekstuk, dagboek, omschrijving, vervaldatum, valuta, bedrag).
 *
 * - Bedrag: zoals Exact het in deze lijst geeft, niet omgedraaid. Aanname (nog live te controleren):
 *   hetzelfde teken als het scherm, factuur positief en losse betaling negatief.
 * - Soort: uit het type van het dagboek (financial/Journals) en het factuurnummer, nooit uit het
 *   teken of de omschrijving. Is het type onbekend, dan "other".
 * - De lijst is de stand van nu; Exact kent hier geen peildatum. Afletterstatus staat er niet in:
 *   gebruik daarvoor get_matching_details.
 */
const RESOURCE = "read/financial/PayablesList";
const FIELDS = ["HID", "AccountId", "AccountCode", "AccountName", "Amount", "AmountInTransit", "ApprovalStatus", "CurrencyCode", "Description", "DueDate", "EntryNumber", "InvoiceDate", "InvoiceNumber", "JournalCode", "JournalDescription", "YourRef"];
const MAX_ROWS = 3000;
const MAX_PAGES = 50;
const DEFAULT_ITEMS = 300;
const MAX_ITEMS = 1000;

// Dagboektypen volgens financial/Journals
const JOURNAL_TYPES: Record<number, string> = { 10: "cash", 12: "bank", 16: "payment_service", 20: "sales", 21: "return_invoice", 22: "purchase", 23: "received_return_invoice", 90: "general_journal" };
const PURCHASE_TYPES = new Set([22, 23]);
const CASHFLOW_TYPES = new Set([10, 12, 16]);

type Kind = "open_invoice" | "unmatched_payment" | "payment_with_invoice_number" | "other";

function kindOf(journalType: number | null, hasInvoiceNumber: boolean): { kind: Kind; basis: string } {
  if (journalType === null) return { kind: "other", basis: "journal_type_unknown" };
  if (PURCHASE_TYPES.has(journalType)) return { kind: "open_invoice", basis: "purchase_journal" };
  if (CASHFLOW_TYPES.has(journalType)) {
    return hasInvoiceNumber ? { kind: "payment_with_invoice_number", basis: "cashflow_journal_with_invoice_number" } : { kind: "unmatched_payment", basis: "cashflow_journal_without_invoice_number" };
  }
  return { kind: "other", basis: "other_journal_type" };
}

/** Vandaag (Nederland) als YYYY-MM-DD: ctx.today, anders de starttijd van de run. */
function todayOf(ctx: any): string {
  for (const v of [ctx.today, ctx.now]) {
    const s = typeof v === "string" ? v.slice(0, 10) : "";
    if (dayNumber(s) !== null) return s;
  }
  return new Date().toISOString().slice(0, 10);
}

class Totals {
  private byCurrency = new Map<string, { total: Decimal; kinds: Map<string, { count: number; total: Decimal }> }>();
  add(currency: string, kind: string, value: Decimal) {
    const c = this.byCurrency.get(currency) ?? { total: new Decimal(0), kinds: new Map() };
    const k = c.kinds.get(kind) ?? { count: 0, total: new Decimal(0) };
    c.total = c.total.plus(value);
    k.count++;
    k.total = k.total.plus(value);
    c.kinds.set(kind, k);
    this.byCurrency.set(currency, c);
  }
  view() {
    return [...this.byCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([currency, c]) => ({
      currency,
      total: money(c.total),
      by_kind: Object.fromEntries([...c.kinds.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([kind, k]) => [kind, { count: k.count, total: money(k.total) }])),
    }));
  }
}

export default async function listPayables(args: { account_id?: string; account_code?: string; only_overdue?: boolean; max_items?: number }, ctx: any) {
  const has = (v: unknown) => v !== undefined && v !== null && v !== "";
  const accountId = has(args.account_id) ? String(args.account_id).toLowerCase() : null;
  const accountCode = has(args.account_code) ? String(args.account_code).trim() : null;
  if (accountId !== null && !GUID.test(accountId)) ctx.fail("invalid_input", "account_id must be a GUID (the ID of the account in list_accounts)");
  if (accountCode !== null && !CODE.test(accountCode)) ctx.fail("invalid_input", "account_code: letters and digits only (max 20)");
  if (accountId !== null && accountCode !== null) ctx.fail("invalid_input", "Give account_id or account_code, not both");
  if (has(args.only_overdue) && typeof args.only_overdue !== "boolean") ctx.fail("invalid_input", "only_overdue must be true or false");
  const maxItems = has(args.max_items) ? Number(args.max_items) : DEFAULT_ITEMS;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > MAX_ITEMS) ctx.fail("invalid_input", `max_items must be a whole number from 1 to ${MAX_ITEMS}`);
  const onlyOverdue = args.only_overdue === true;

  const incomplete = new Set<string>();
  const warnings = new Set<string>();

  // Op relatie-id filtert Exact; de code staat in Exact met voorloopspaties en vergelijken we zelf.
  // Het filter wordt hieronder ook zelf toegepast, zodat een genegeerd $filter geen verkeerde lijst geeft.
  const source = await collect(ctx, RESOURCE, FIELDS, accountId !== null ? `AccountId eq guid'${accountId}'` : undefined, { maxRows: MAX_ROWS, maxPages: MAX_PAGES });
  if (!source.complete && source.incompleteReason) incomplete.add(source.incompleteReason);

  // Dagboektypen: nodig voor de soort. Lukt dit niet, dan blijft de soort "other".
  const journalTypes = new Map<string, number>();
  try {
    const journals = await collect(ctx, "financial/Journals", ["ID", "Code", "Description", "Type"], undefined, { maxRows: 300, maxPages: 5 });
    if (!journals.complete) warnings.add("journal_list_incomplete_some_kinds_may_be_other");
    for (const j of journals.items) if (typeof j.Code === "string" && Number.isInteger(j.Type)) journalTypes.set(j.Code.trim(), j.Type);
  } catch {
    warnings.add("journal_types_unavailable_kind_is_other");
  }

  const today = todayOf(ctx);
  const todayDay = dayNumber(today)!;
  const rows = source.items.filter((r: Row) => {
    if (accountId !== null) return String(r.AccountId ?? "").toLowerCase() === accountId;
    if (accountCode !== null) return String(r.AccountCode ?? "").trim() === accountCode;
    return true;
  });

  let withoutDueDate = 0;
  const all = rows.map((r: Row) => {
    const journalCode = typeof r.JournalCode === "string" ? r.JournalCode.trim() : null;
    const journalType = journalCode !== null ? (journalTypes.get(journalCode) ?? null) : null;
    const invoiceNumber = Number.isInteger(r.InvoiceNumber) && r.InvoiceNumber > 0 ? (r.InvoiceNumber as number) : null;
    const { kind, basis } = kindOf(journalType, invoiceNumber !== null);
    const date = exactDate(r.InvoiceDate);
    const dueDate = exactDate(r.DueDate);
    const dateDay = dayNumber(date);
    const dueDay = dayNumber(dueDate);
    if (dueDay === null) withoutDueDate++;
    let value: Decimal | null = null;
    try {
      value = amount(r.Amount);
    } catch {
      incomplete.add("item_without_amount");
    }
    let inTransit: string | null = null;
    try {
      if (r.AmountInTransit !== null && r.AmountInTransit !== undefined) inTransit = money(amount(r.AmountInTransit));
    } catch {
      inTransit = null;
    }
    const currency = typeof r.CurrencyCode === "string" && r.CurrencyCode.trim() ? r.CurrencyCode.trim() : "unknown";
    return {
      value,
      view: {
        kind,
        kind_basis: basis,
        account_id: r.AccountId ?? null,
        account_code: String(r.AccountCode ?? "").trim() || null,
        account_name: r.AccountName ?? null,
        invoice_number: invoiceNumber,
        date,
        entry_number: r.EntryNumber ?? null,
        journal_code: journalCode,
        journal_description: r.JournalDescription ?? null,
        journal_type: journalType === null ? null : (JOURNAL_TYPES[journalType] ?? String(journalType)),
        description: r.Description ?? null,
        your_ref: r.YourRef ?? null,
        age_days: dateDay === null ? null : todayDay - dateDay,
        due_date: dueDate,
        overdue: dueDay === null ? null : dueDay < todayDay,
        days_overdue: dueDay !== null && dueDay < todayDay ? todayDay - dueDay : 0,
        currency,
        amount: value === null ? null : money(value),
        amount_in_transit: inTransit,
        approval_status: r.ApprovalStatus ?? null,
        hid: r.HID === null || r.HID === undefined ? null : String(r.HID),
      },
    };
  });

  const selected = onlyOverdue ? all.filter((i) => i.view.overdue === true) : all;
  selected.sort((a, b) =>
    String(a.view.account_name ?? "").localeCompare(String(b.view.account_name ?? "")) || String(a.view.account_code ?? "").localeCompare(String(b.view.account_code ?? "")) ||
    (a.view.date ?? "").localeCompare(b.view.date ?? "") || Number(a.view.entry_number ?? 0) - Number(b.view.entry_number ?? 0));

  // Totalen en subtotalen per relatie over alle gekozen regels, ook als de uitvoer van items is ingekort
  const totals = new Totals();
  const groups = new Map<string, { account_id: unknown; account_code: string | null; account_name: unknown; item_count: number; totals: Totals }>();
  for (const i of selected) {
    const key = String(i.view.account_id ?? i.view.account_code ?? "");
    const g = groups.get(key) ?? { account_id: i.view.account_id, account_code: i.view.account_code, account_name: i.view.account_name, item_count: 0, totals: new Totals() };
    g.item_count++;
    if (i.value !== null) {
      totals.add(i.view.currency, i.view.kind, i.value);
      g.totals.add(i.view.currency, i.view.kind, i.value);
    }
    groups.set(key, g);
  }
  const counts: Record<string, number> = {};
  for (const i of selected) counts[i.view.kind] = (counts[i.view.kind] ?? 0) + 1;
  if (onlyOverdue && withoutDueDate > 0) warnings.add("items_without_due_date_left_out_of_overdue");
  if (counts.other) warnings.add("some_items_have_kind_other_see_kind_basis");

  const items = selected.slice(0, maxItems).map((i) => i.view);
  return {
    division: await divisionInfo(ctx),
    query: { account_id: accountId, account_code: accountCode, only_overdue: onlyOverdue, max_items: maxItems },
    as_of: today,
    source: RESOURCE,
    sign_convention: "amount as Exact gives it in PayablesList, not flipped; expected to match the screen (invoice positive, payment without invoice negative). Totals are per currency.",
    kind_source: "journal type from financial/Journals (purchase = open_invoice; cash, bank or payment service = payment) and InvoiceNumber; never derived from the sign or the description",
    notes: [
      "Current state only: Exact has no reference date for this list.",
      "This list does not give a matching status. Use get_matching_details for one invoice or entry.",
    ],
    count: selected.length,
    count_by_kind: counts,
    totals: totals.view(),
    accounts: [...groups.values()].map((g) => ({ account_id: g.account_id, account_code: g.account_code, account_name: g.account_name, item_count: g.item_count, totals: g.totals.view() })),
    items,
    items_returned: items.length,
    items_truncated: items.length < selected.length,
    items_without_due_date: withoutDueDate,
    pages: source.pages,
    complete: incomplete.size === 0,
    incomplete_reasons: [...incomplete].sort(),
    warnings: [...warnings].sort(),
  };
}
