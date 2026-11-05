import { Decimal } from "@tailr/connector";
import { amount, byDateEntryLine, CODE, collect, dayNumber, divisionInfo, exactDate, isoFromDay, LINE_FIELDS, lineView, money, SIGN, STATUS_LABELS, sum, type LineView } from "./lib/exact";

/**
 * Grootboekkaart van één rekening tussen twee datums (inclusief) binnen één boekjaar.
 *
 * Beginsaldo = ReportingBalance van eerdere perioden in het jaar (incl. periode 0 en
 * beginbalanstypes 10/328), voor balansrekeningen ook eerdere jaren tot het laatste
 * jaar met beginbalansregels, plus regels uit de startperiode van vóór de startdatum.
 * Regels: debet/credit uit het teken van AmountDC. Valt de einddatum op het einde van
 * een periode, dan vergelijken we het eindsaldo met ReportingBalance.
 */
const OPENING_TYPES = new Set([10, 328]);
const YEAR_END_TYPES = new Set([320, 321, 322, 323, 324, 325, 326, 327]);

export default async function generalLedgerCard(args: { gl_account_code: string; start_date: string; end_date: string; include_open?: boolean }, ctx: any) {
  const code = String(args.gl_account_code ?? "");
  const start = dayNumber(args.start_date);
  const end = dayNumber(args.end_date);
  const includeOpen = args.include_open ?? true;
  if (!CODE.test(code)) ctx.fail("invalid_input", "gl_account_code: letters and digits only (max 20)");
  if (start === null || end === null || end < start || end - start > 366) ctx.fail("invalid_input", "start_date and end_date must be YYYY-MM-DD, end inclusive, at most 366 days apart");
  if (typeof includeOpen !== "boolean") ctx.fail("invalid_input", "include_open must be true or false");
  const statuses = new Set(includeOpen ? [20, 50] : [50]);
  const warnings = new Set<string>();

  // Perioden: in welk boekjaar en welke periode vallen begin en eind?
  const periods = await collect(ctx, "financial/FinancialPeriods", ["ID", "FinYear", "FinPeriod", "StartDate", "EndDate"], undefined, { maxRows: 1000, maxPages: 20 });
  const spans = periods.items
    .map((r) => ({ year: r.FinYear, period: r.FinPeriod, first: dayNumber(exactDate(r.StartDate)), last: dayNumber(exactDate(r.EndDate)) }))
    .filter((s) => Number.isInteger(s.year) && Number.isInteger(s.period) && s.first !== null && s.last !== null) as { year: number; period: number; first: number; last: number }[];
  const periodOf = (day: number) => {
    const found = spans.filter((s) => s.first <= day && day <= s.last);
    return found.length === 1 ? found[0]! : null;
  };
  const startPeriod = periodOf(start!);
  const endPeriod = periodOf(end!);
  if (!periods.complete || !startPeriod || !endPeriod) ctx.fail("not_found", "The financial period of the start or end date could not be determined");
  const year = startPeriod!.year;
  const period = startPeriod!.period;
  if (endPeriod!.year !== year) ctx.fail("invalid_input", `The period spans more than one financial year (${year} and ${endPeriod!.year}). Ask per year.`);

  // ReportingBalance: saldo per periode
  const balances = await collect(ctx, "financial/ReportingBalance", ["ID", "ReportingYear", "ReportingPeriod", "GLAccountCode", "GLAccountDescription", "BalanceType", "Type", "Status", "Amount", "AmountDebit", "AmountCredit", "Count"], `GLAccountCode eq '${code}'`, { maxRows: 5000, maxPages: 100 });
  const rb = balances.items.filter((r) => statuses.has(r.Status));
  const balanceType = balances.items.find((r) => r.BalanceType)?.BalanceType ?? null;
  const description = balances.items.find((r) => r.GLAccountDescription)?.GLAccountDescription ?? null;

  let opening = sum(rb.filter((r) => r.ReportingYear === year && (r.ReportingPeriod ?? 0) < period).map((r) => amount(r.Amount)));
  const carriedYears: number[] = [];
  if (balanceType === "B" && !rb.some((r) => r.ReportingYear === year && OPENING_TYPES.has(r.Type))) {
    const prior = [...new Set(rb.map((r) => r.ReportingYear).filter((y) => Number.isInteger(y) && y < year))].sort((a, b) => b - a);
    for (const y of prior) {
      carriedYears.push(y);
      if (rb.some((r) => r.ReportingYear === y && OPENING_TYPES.has(r.Type))) break;
    }
    opening = opening.plus(sum(rb.filter((r) => carriedYears.includes(r.ReportingYear)).map((r) => amount(r.Amount))));
    if (rb.some((r) => carriedYears.includes(r.ReportingYear) && YEAR_END_TYPES.has(r.Type))) warnings.add("year_end_entries_in_carried_years_review_opening_balance");
  } else if (balanceType === null) {
    warnings.add("balance_type_unknown_no_reporting_balance_rows");
  }

  // Regels in de startperiode van vóór de startdatum tellen mee in het beginsaldo
  const samePeriod = await collect(ctx, "financialtransaction/TransactionLines", LINE_FIELDS, `FinancialYear eq ${year} and FinancialPeriod eq ${period} and GLAccountCode eq '${code}'`);
  for (const row of samePeriod.items) {
    const when = dayNumber(exactDate(row.Date));
    if (statuses.has(row.Status) && (when === null || when < start! || OPENING_TYPES.has(row.Type))) {
      opening = opening.plus(amount(row.AmountDC));
      if (when === null) warnings.add("line_without_date_counted_in_opening");
    }
  }

  // Mutaties in de periode
  const lines = await collect(ctx, "financialtransaction/TransactionLines", LINE_FIELDS, `GLAccountCode eq '${code}' and Date ge datetime'${args.start_date}T00:00:00' and Date lt datetime'${isoFromDay(end! + 1)}T00:00:00'`);
  const mutations: LineView[] = [];
  const excluded = { other_status: 0, opening_type_in_opening_balance: 0 };
  for (const row of lines.items) {
    if (!statuses.has(row.Status)) excluded.other_status++;
    else if (OPENING_TYPES.has(row.Type) && row.FinancialYear === year && row.FinancialPeriod === period) excluded.opening_type_in_opening_balance++;
    else {
      mutations.push(lineView(row));
      if (row.FinancialYear < year || (row.FinancialYear === year && (row.FinancialPeriod ?? 0) < period)) warnings.add("line_dated_in_range_but_booked_in_earlier_period_may_double_count");
      if (YEAR_END_TYPES.has(row.Type)) warnings.add("year_end_entry_in_range");
    }
  }
  mutations.sort(byDateEntryLine);
  const debit = sum(mutations.map((m) => new Decimal(m.debit)));
  const credit = sum(mutations.map((m) => new Decimal(m.credit)));
  const closing = opening.plus(debit).minus(credit);

  let check: { reporting_balance_closing: string; matches: boolean } | null = null;
  if (end === endPeriod!.last) {
    let expected = sum(rb.filter((r) => r.ReportingYear === year && (r.ReportingPeriod ?? 0) <= endPeriod!.period).map((r) => amount(r.Amount)));
    expected = expected.plus(sum(rb.filter((r) => carriedYears.includes(r.ReportingYear)).map((r) => amount(r.Amount))));
    check = { reporting_balance_closing: money(expected), matches: expected.eq(closing) };
  }

  const parts = [balances, samePeriod, lines];
  const zero = new Decimal(0);
  return {
    division: await divisionInfo(ctx),
    account: { code, description, balance_type: balanceType },
    filters: { start_date: args.start_date, end_date_inclusive: args.end_date, statuses_included: [...statuses].map((s) => STATUS_LABELS[s]).sort(), journals: "all", financial_year: year, start_period: period, end_period: endPeriod!.period },
    sign_convention: SIGN,
    opening_balance: money(opening),
    total_debit: money(debit),
    total_credit: money(credit),
    closing_balance: money(closing),
    // De afgedrukte grootboekkaart van Exact telt het beginsaldo mee in debet of credit
    exact_report_totals: { debit: money(debit.plus(opening.gt(zero) ? opening : zero)), credit: money(credit.plus(opening.lt(zero) ? opening.times(-1) : zero)) },
    opening_balance_method: { reporting_balance_periods_before: [year, period], carried_prior_years: carriedYears, plus_lines_in_start_period_before_start_date: true, opening_types: [10, 328] },
    reporting_balance_check: check,
    excluded_lines: excluded,
    lines: mutations,
    line_count: mutations.length,
    complete: parts.every((p) => p.complete),
    incomplete_reasons: [...new Set(parts.map((p) => p.incompleteReason).filter(Boolean))].sort(),
    warnings: [...warnings].sort(),
  };
}
