import { Decimal } from "@tailr/connector";
import { CODE, collect, divisionInfo, GUID, LINE_FIELDS, lineView, money, SIGN, sum, type LineView } from "./lib/exact";

/**
 * Alle regels van één boeking (over alle grootboekrekeningen), per EntryID gegroepeerd
 * met debet- en credittotaal en of de boeking in balans is. Op EntryID, of op
 * boekstuknummer (eventueel met dagboek). Meerdere boekingen met hetzelfde nummer: ambiguous.
 * Afletterstatus staat hier niet in; gebruik daarvoor matching_details.
 */
export default async function financialEntry(args: { entry_id?: string; entry_number?: number; journal_code?: string }, ctx: any) {
  const entryId = args.entry_id ? String(args.entry_id).toLowerCase() : undefined;
  let filter: string;
  if (entryId) {
    if (!GUID.test(entryId) || args.entry_number !== undefined || args.journal_code !== undefined) ctx.fail("invalid_input", "Give either entry_id (a GUID), or entry_number with an optional journal_code");
    filter = `EntryID eq guid'${entryId}'`;
  } else {
    const n = Number(args.entry_number);
    if (!Number.isInteger(n) || n < 1 || n > 2147483647) ctx.fail("invalid_input", "entry_number must be a positive whole number");
    if (args.journal_code !== undefined && !CODE.test(String(args.journal_code))) ctx.fail("invalid_input", "journal_code: letters and digits only (max 20)");
    filter = `EntryNumber eq ${n}` + (args.journal_code !== undefined ? ` and JournalCode eq '${args.journal_code}'` : "");
  }

  const result = await collect(ctx, "financialtransaction/TransactionLines", LINE_FIELDS, filter, { maxRows: 2000, maxPages: 40 });
  const grouped = new Map<string, LineView[]>();
  for (const row of result.items) {
    const key = String(row.EntryID);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(lineView(row));
  }
  const entries = [...grouped.entries()].map(([key, lines]) => {
    lines.sort((a, b) => (a.LineNumber ?? 0) - (b.LineNumber ?? 0) || String(a.GLAccountCode ?? "").localeCompare(String(b.GLAccountCode ?? "")));
    const first = lines[0]!;
    const total = sum(lines.map((l) => new Decimal(l.AmountDC)));
    return {
      EntryID: key,
      EntryNumber: first.EntryNumber,
      JournalCode: first.JournalCode,
      JournalDescription: first.JournalDescription,
      date: first.date,
      FinancialYear: first.FinancialYear,
      FinancialPeriod: first.FinancialPeriod,
      Type: first.Type,
      statuses: [...new Set(lines.map((l) => l.status_label))].sort(),
      total_debit: money(sum(lines.map((l) => new Decimal(l.debit)))),
      total_credit: money(sum(lines.map((l) => new Decimal(l.credit)))),
      balanced: total.eq(0),
      lines,
    };
  });
  entries.sort((a, b) => String(a.JournalCode ?? "").localeCompare(String(b.JournalCode ?? "")) || String(a.date ?? "").localeCompare(String(b.date ?? "")));
  return {
    division: await divisionInfo(ctx),
    filters: { entry_id: entryId ?? null, journal_code: args.journal_code ?? null, entry_number: args.entry_number ?? null },
    sign_convention: SIGN,
    entries,
    entry_count: entries.length,
    ambiguous: entries.length > 1,
    complete: result.complete,
    incomplete_reason: result.incompleteReason,
  };
}
