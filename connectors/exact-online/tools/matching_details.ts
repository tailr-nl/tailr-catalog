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
 */
const MATCH_STATUS: Record<number, string> = { 20: "open", 30: "selected", 40: "processed_not_matched", 50: "matched" };
const GL_MATCHING_UNKNOWN = "exact_rest_api_does_not_expose_gl_account_matching";
const MAX_INVOICES = 20;
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
    },
    invoices,
    invoice_count: invoices.length,
    gl_account_matching: glMatching,
    empty: !invoices.length && !glMatching.length,
    complete: incomplete.size === 0,
    incomplete_reasons: [...incomplete].sort(),
  };
}
