import { Decimal } from "@tailr/connector";
import { amount, byDateEntryLine, CODE, collect, divisionInfo, exactDate, LINE_FIELDS, lineView, money, SIGN, sum, type LineView, type Row } from "./lib/exact";

/**
 * Afletterstatus van verkoop- en inkoopfacturen, op factuurnummer, uw referentie of boekstuknummer.
 *
 * Bron: cashflow/Receivables en cashflow/Payments (Status 20 open, 30 geselecteerd,
 * 40 verwerkt maar niet afgeletterd, 50 afgeletterd; EndDate = niet meer openstaand sinds).
 * Tegenregels: TransactionLines met hetzelfde factuurnummer op dezelfde debiteuren-/crediteurenrekening,
 * in een andere boeking. Afletteren op een grootboekkaart (bijv. kruisposten 17910) zit niet
 * in de REST API van Exact: die regels krijgen matching_status "unknown", nooit een gok.
 *
 * Met entry_number zoeken we ook de openstaande post(en) van de boeking zelf op (EntryNumber in
 * Receivables en Payments). Zo krijgt een bankbetaling op een leverancier zonder factuurnummer
 * de status open_not_linked_to_invoice in plaats van niets. De status komt uit Status van Exact.
 */
const MATCH_STATUS: Record<number, string> = { 20: "open", 30: "selected", 40: "processed_not_matched", 50: "matched" };
const GL_MATCHING_UNKNOWN = "exact_rest_api_does_not_expose_gl_account_matching";
const MAX_INVOICES = 20;
const OPEN_STATUSES = new Set([20, 30, 40]);
const ITEM_FIELDS = ["ID", "EntryID", "AccountCode", "AccountName", "AmountDC", "AmountFC", "Currency", "Description", "EntryNumber", "EntryDate", "InvoiceNumber", "InvoiceDate", "DueDate", "Journal", "Status", "EndDate", "EndYear", "EndPeriod", "GLAccountCode", "PaymentReference", "YourRef", "TransactionAmountDC", "TransactionEntryID", "TransactionID", "TransactionType"];
const RECEIVABLE_FIELDS = [...ITEM_FIELDS, "IsFullyPaid", "LastPaymentDate"];

function itemView(kind: string, row: Row) {
  return {
    kind, ID: row.ID, EntryID: row.EntryID, TransactionEntryID: row.TransactionEntryID, Journal: row.Journal, EntryNumber: row.EntryNumber,
    InvoiceNumber: row.InvoiceNumber, YourRef: row.YourRef, AccountCode: String(row.AccountCode ?? "").trim() || null, AccountName: row.AccountName,
    GLAccountCode: row.GLAccountCode, Description: row.Description, TransactionType: row.TransactionType,
    Status: row.Status, status_label: MATCH_STATUS[row.Status] ?? "unknown", IsFullyPaid: row.IsFullyPaid ?? null,
    end_date: exactDate(row.EndDate), last_payment_date: exactDate(row.LastPaymentDate),
    transaction_amount_dc: money(amount(row.TransactionAmountDC ?? 0)),
    // Exact geeft het openstaande bedrag met het omgekeerde teken van het grootboeksaldo
    remaining_open_dc: money(amount(row.AmountDC ?? 0).times(-1)),
    exact_amount_dc_raw: row.AmountDC,
    Currency: row.Currency,
  };
}
type Item = ReturnType<typeof itemView>;

function invoiceMatching(number: number, items: Item[], lines: Row[]) {
  if (!items.length) {
    return { invoice_number: number, matching_status: "unknown", reason: "no_receivable_or_payable_item_found", outstanding_items: [], invoice_lines: [], counter_lines: [], counter_entries: [] };
  }
  const accounts = new Set(items.map((i) => i.GLAccountCode));
  const own = lines.filter((l) => l.InvoiceNumber === number && accounts.has(l.GLAccountCode));
  const invoiceLines: LineView[] = own.filter((l) => l.EntryNumber === number).map(lineView).sort(byDateEntryLine);
  const counterLines: LineView[] = own.filter((l) => l.EntryNumber !== number).map(lineView).sort(byDateEntryLine);
  const original = sum(invoiceLines.map((l) => new Decimal(l.AmountDC)));
  const counter = sum(counterLines.map((l) => new Decimal(l.AmountDC)));
  const remaining = sum(items.map((i) => new Decimal(i.remaining_open_dc)));
  const statuses = new Set(items.map((i) => i.Status));
  let status: string;
  if (statuses.size === 1 && statuses.has(50)) status = "matched";
  else if (statuses.has(50) || (counterLines.length > 0 && !remaining.eq(original))) status = "partially_matched";
  else if ([...statuses].every((s) => s === 20 || s === 30 || s === 40)) status = "open";
  else status = "unknown";
  const entries = new Map<string, { EntryID: unknown; JournalCode: unknown; EntryNumber: unknown; date: string | null; amount: Decimal }>();
  for (const l of counterLines) {
    const key = String(l.EntryID);
    const e = entries.get(key) ?? { EntryID: l.EntryID, JournalCode: l.JournalCode, EntryNumber: l.EntryNumber, date: l.date, amount: new Decimal(0) };
    e.amount = e.amount.plus(l.AmountDC);
    entries.set(key, e);
  }
  const ends = items.map((i) => i.end_date).filter(Boolean).sort() as string[];
  const kinds = [...new Set(items.map((i) => i.kind))].sort();
  return {
    invoice_number: number,
    kind: kinds.length === 1 ? kinds[0] : kinds,
    account: { code: items[0]!.AccountCode, name: items[0]!.AccountName },
    gl_accounts: [...accounts].sort(),
    your_ref: items.find((i) => i.YourRef)?.YourRef ?? null,
    matching_status: status,
    matching_status_source: "exact_outstanding_item_status",
    invoice_amount_dc: money(original),
    counter_total_dc: money(counter),
    remaining_open_dc: money(remaining),
    end_date: status === "matched" && ends.length ? ends[ends.length - 1] : null,
    consistency: { invoice_plus_counter_lines_dc: money(original.plus(counter)), exact_remaining_open_dc: money(remaining), consistent: original.plus(counter).eq(remaining) },
    outstanding_items: items,
    invoice_lines: invoiceLines,
    counter_lines: counterLines,
    counter_entries: [...entries.values()].map(({ amount: a, ...rest }) => ({ ...rest, amount_dc_on_account: money(a) })),
  };
}

/** Openstaande post van de boeking zelf: status uit Exact, plus of er een factuurnummer aan hangt. */
function entryItemView(item: Item, followed: Set<number>) {
  const hasInvoice = Number.isInteger(item.InvoiceNumber) && item.InvoiceNumber > 0;
  let status: string;
  if (item.Status === 50) status = "matched";
  else if (OPEN_STATUSES.has(item.Status)) status = hasInvoice ? "open" : "open_not_linked_to_invoice";
  else status = "unknown";
  return { ...item, linked_to_invoice_number: hasInvoice, entry_item_status: status, entry_item_status_source: "exact_outstanding_item_status", also_under_invoices: hasInvoice && followed.has(item.InvoiceNumber) };
}

const OPEN_LIST_FIELDS = ["HID", "AccountCode", "AccountName", "Amount", "CurrencyCode", "Description", "DueDate", "EntryNumber", "InvoiceDate", "InvoiceNumber", "JournalCode", "JournalDescription", "YourRef"];

/** Regels van één boeking uit een openpostlijst. Het filter gaat naar Exact én wordt hier toegepast. */
async function openListRows(ctx: any, resource: string, entryNumber: number, journalCode: string | undefined, note: (r: { complete: boolean; incompleteReason: string | null }) => void): Promise<Row[]> {
  let r;
  try {
    r = await collect(ctx, resource, OPEN_LIST_FIELDS, `EntryNumber eq ${entryNumber}`, { maxRows: 300, maxPages: 5 });
  } catch (e: any) {
    if (["rate_limited", "user_rate_limited", "daily_limit_reached"].includes(e?.code)) throw e;
    // Weigert Exact het filter op deze lijst, dan de lijst zelf (begrensd) en hier filteren
    r = await collect(ctx, resource, OPEN_LIST_FIELDS, undefined, { maxRows: 600, maxPages: 10 });
  }
  note(r);
  return r.items.filter((row) => row.EntryNumber === entryNumber && (journalCode === undefined || String(row.JournalCode ?? "").trim() === journalCode));
}

/** Post uit een openpostlijst: die staat per definitie open. Bedrag met het teken van de lijst (zoals het scherm in Exact). */
function openListView(kind: "payable" | "receivable", row: Row) {
  const hasInvoice = Number.isInteger(row.InvoiceNumber) && row.InvoiceNumber > 0;
  return {
    kind, EntryNumber: row.EntryNumber, JournalCode: typeof row.JournalCode === "string" ? row.JournalCode.trim() : null, JournalDescription: row.JournalDescription ?? null,
    InvoiceNumber: hasInvoice ? row.InvoiceNumber : null, YourRef: row.YourRef ?? null, AccountCode: String(row.AccountCode ?? "").trim() || null, AccountName: row.AccountName ?? null,
    Description: row.Description ?? null, date: exactDate(row.InvoiceDate), due_date: exactDate(row.DueDate),
    open_amount_as_listed: money(amount(row.Amount ?? 0)), Currency: row.CurrencyCode ?? null,
    linked_to_invoice_number: hasInvoice, entry_item_status: hasInvoice ? "open" : "open_not_linked_to_invoice",
    entry_item_status_source: kind === "payable" ? "exact_payables_list" : "exact_receivables_list",
  };
}

const orFilter = (field: string, values: number[]) => `(${values.map((v) => `${field} eq ${v}`).join(" or ")})`;

export default async function matchingDetails(args: { invoice_number?: number; your_ref?: string; entry_number?: number; journal_code?: string }, ctx: any) {
  const given = [args.invoice_number, args.your_ref, args.entry_number].filter((v) => v !== undefined && v !== null && v !== "");
  if (given.length !== 1 || (args.journal_code !== undefined && args.entry_number === undefined)) ctx.fail("invalid_input", "Give exactly one of invoice_number, your_ref or entry_number (journal_code only with entry_number)");
  for (const n of [args.invoice_number, args.entry_number]) if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 2147483647)) ctx.fail("invalid_input", "Numbers must be positive whole numbers");
  if (args.your_ref !== undefined && !/^[0-9A-Za-z._/-]{1,40}$/.test(String(args.your_ref))) ctx.fail("invalid_input", "your_ref: letters, digits and . _ / - only (max 40)");
  if (args.journal_code !== undefined && !CODE.test(String(args.journal_code))) ctx.fail("invalid_input", "journal_code: letters and digits only (max 20)");

  const incomplete = new Set<string>();
  const note = (r: { complete: boolean; incompleteReason: string | null }) => { if (!r.complete && r.incompleteReason) incomplete.add(r.incompleteReason); };
  let numbers: number[] = [];
  let entryLines: Row[] = [];

  if (args.invoice_number !== undefined) numbers = [args.invoice_number];
  else if (args.your_ref !== undefined) {
    const found = new Set<number>();
    for (const resource of ["cashflow/Receivables", "cashflow/Payments"]) {
      const r = await collect(ctx, resource, ["ID", "InvoiceNumber"], `YourRef eq '${args.your_ref}'`, { maxRows: 200, maxPages: 5 });
      note(r);
      for (const row of r.items) if (Number.isInteger(row.InvoiceNumber)) found.add(row.InvoiceNumber);
    }
    numbers = [...found].sort((a, b) => a - b);
  } else {
    const r = await collect(ctx, "financialtransaction/TransactionLines", LINE_FIELDS, `EntryNumber eq ${args.entry_number}` + (args.journal_code !== undefined ? ` and JournalCode eq '${args.journal_code}'` : ""), { maxRows: 2000, maxPages: 40 });
    note(r);
    entryLines = r.items;
    numbers = [...new Set(entryLines.map((l) => l.InvoiceNumber).filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
  }
  if (numbers.length > MAX_INVOICES) {
    numbers = numbers.slice(0, MAX_INVOICES);
    incomplete.add("invoice_cap_reached");
  }

  const items: Item[] = [];
  const lines: Row[] = [];
  for (let i = 0; i < numbers.length; i += 10) {
    const batch = orFilter("InvoiceNumber", numbers.slice(i, i + 10));
    const rec = await collect(ctx, "cashflow/Receivables", RECEIVABLE_FIELDS, batch, { maxRows: 2000, maxPages: 40 });
    const pay = await collect(ctx, "cashflow/Payments", ITEM_FIELDS, batch, { maxRows: 2000, maxPages: 40 });
    const trx = await collect(ctx, "financialtransaction/TransactionLines", LINE_FIELDS, batch, { maxRows: 2000, maxPages: 40 });
    [rec, pay, trx].forEach(note);
    items.push(...rec.items.map((r) => itemView("receivable", r)), ...pay.items.map((r) => itemView("payable", r)));
    lines.push(...trx.items);
  }
  const invoices = numbers.map((n) => invoiceMatching(n, items.filter((i) => i.InvoiceNumber === n), lines));

  // De openstaande post(en) van de boeking zelf, ook zonder factuurnummer (bijv. een losse bankbetaling op een leverancier)
  const entryItems: ReturnType<typeof entryItemView>[] = [];
  const entryListItems: ReturnType<typeof openListView>[] = [];
  if (args.entry_number !== undefined) {
    const own = `EntryNumber eq ${args.entry_number}` + (args.journal_code !== undefined ? ` and Journal eq '${args.journal_code}'` : "");
    const rec = await collect(ctx, "cashflow/Receivables", RECEIVABLE_FIELDS, own, { maxRows: 200, maxPages: 5 });
    const pay = await collect(ctx, "cashflow/Payments", ITEM_FIELDS, own, { maxRows: 200, maxPages: 5 });
    [rec, pay].forEach(note);
    const followed = new Set(numbers);
    entryItems.push(...rec.items.map((r) => entryItemView(itemView("receivable", r), followed)), ...pay.items.map((r) => entryItemView(itemView("payable", r), followed)));
    // Een boeking die nog niet is verwerkt staat niet in cashflow/Payments of Receivables, maar wel in de
    // openpostlijsten (live gezien bij bankbetalingen op een leverancier zonder factuur). Wat daar staat, staat open.
    if (!entryItems.length) {
      for (const [kind, resource] of [["payable", "read/financial/PayablesList"], ["receivable", "read/financial/ReceivablesList"]] as const) {
        const rows = await openListRows(ctx, resource, args.entry_number, args.journal_code, note);
        entryListItems.push(...rows.map((r) => openListView(kind, r)));
      }
    }
  }

  // Regels van de boeking zonder factuur: afletteren op een grootboekkaart staat niet in de REST API
  const glLines = entryLines.filter((l) => !Number.isInteger(l.InvoiceNumber));
  const codes = [...new Set(glLines.map((l) => l.GLAccountCode).filter((c) => typeof c === "string" && CODE.test(c)))].sort() as string[];
  const glMatching: Record<string, unknown>[] = [];
  if (codes.length) {
    const accounts = await collect(ctx, "financial/GLAccounts", ["ID", "Code", "Description", "Type", "Matching"], `(${codes.map((c) => `Code eq '${c}'`).join(" or ")})`, { maxRows: 200, maxPages: 5 });
    const flags = new Map(accounts.items.map((a) => [a.Code, a.Matching]));
    for (const code of codes) {
      const enabled = flags.get(code);
      glMatching.push({
        GLAccountCode: code,
        matching_enabled_on_gl_account: enabled ?? null,
        matching_status: enabled === false ? "not_applicable" : "unknown",
        reason: enabled === false ? "matching_disabled_on_gl_account" : GL_MATCHING_UNKNOWN,
        lines: glLines.filter((l) => l.GLAccountCode === code).map(lineView),
      });
    }
  }

  return {
    division: await divisionInfo(ctx),
    filters: { invoice_number: args.invoice_number ?? null, your_ref: args.your_ref ?? null, entry_number: args.entry_number ?? null, journal_code: args.journal_code ?? null },
    sign_convention: `${SIGN}; remaining_open_dc uses the same ledger sign (debit = still to receive, credit = still to pay)`,
    sources: {
      matching_status: "cashflow/Receivables + cashflow/Payments Status (50 = matched)",
      counter_lines: "TransactionLines with the same InvoiceNumber on the same receivable/payable G/L account, other entry",
      gl_account_matching: GL_MATCHING_UNKNOWN,
      entry_outstanding_items: "cashflow/Receivables + cashflow/Payments with the EntryNumber of the entry itself (only with entry_number); open_not_linked_to_invoice = Status 20, 30 or 40 and no InvoiceNumber. If nothing is found there (e.g. an entry that is not processed yet): read/financial/PayablesList and ReceivablesList by EntryNumber; an item in those lists is open, amount with the sign of that list (open_amount_as_listed)",
    },
    invoices,
    invoice_count: invoices.length,
    gl_account_matching: glMatching,
    entry_outstanding_items: [...entryItems, ...entryListItems],
    entry_outstanding_item_count: entryItems.length + entryListItems.length,
    empty: !invoices.length && !glMatching.length && !entryItems.length && !entryListItems.length,
    complete: incomplete.size === 0,
    incomplete_reasons: [...incomplete].sort(),
  };
}
