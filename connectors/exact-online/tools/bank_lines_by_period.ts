import { collect, CODE, dayNumber, divisionInfo, exactDate } from "./lib/exact";

/**
 * Bankregels (BankEntryLines) van beide richtingen in een periode van 1–31 dagen
 * (begin inclusief, eind exclusief), optioneel voor één grootboekrekening.
 * Bijv. 17910 Kruisposten Mollie naast een Mollie-uitbetaling leggen.
 */
const FIELDS = ["ID", "EntryID", "EntryNumber", "LineNumber", "Date", "Description", "AmountFC", "Account", "AccountName", "Document", "OffsetID", "OurRef", "GLAccount", "GLAccountCode", "GLAccountDescription", "Notes"];

export default async function bankLinesByPeriod(args: { start_date: string; end_date: string; gl_account_code?: string }, ctx: any) {
  const start = dayNumber(args.start_date);
  const end = dayNumber(args.end_date);
  if (start === null || end === null || end - start < 1 || end - start > 31) ctx.fail("invalid_input", "start_date and end_date must be YYYY-MM-DD, end exclusive, 1–31 days apart");
  const code = args.gl_account_code;
  if (code !== undefined && code !== null && code !== "" && !CODE.test(String(code))) ctx.fail("invalid_input", "gl_account_code: letters and digits only (max 20)");

  let filter = `Date ge datetime'${args.start_date}T00:00:00' and Date lt datetime'${args.end_date}T00:00:00'`;
  if (code) filter += ` and GLAccountCode eq '${code}'`;
  const result = await collect(ctx, "financialtransaction/BankEntryLines", FIELDS, filter, { maxRows: 2000, maxPages: 40 });
  const items = result.items.map((r) => ({ ...r, DateISO: exactDate(r.Date) }));
  return {
    division: await divisionInfo(ctx),
    query: { start_date: args.start_date, end_date_exclusive: args.end_date, gl_account_code: code || null },
    sign: "AmountFC > 0 = money in on the journal's own account",
    items,
    count: items.length,
    complete: result.complete,
    incomplete_reason: result.incompleteReason,
  };
}
