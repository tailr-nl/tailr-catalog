import { dayNumber, divisionInfo, divisionOf, exactDate, GUID, type Row } from "./lib/exact";

/**
 * Recente mailberichten in de Exact-mailbox (verzonden en ontvangen), om te zien hoe een gemailde bon
 * door de scanservice ging en hoe een bericht van upload_receipt eruitziet: soort, Operation, ontvanger,
 * status (43 = bij de scanservice) en OriginalMessage. Alleen lezen, zonder bijlagen of berichttekst.
 *
 * Zonder $select: welke velden Exact bij deze functies heeft, staat niet vast. De code neemt alleen de
 * velden hieronder over.
 */
const KEEP = [
  "ID", "Subject", "Type", "Operation", "Created", "Modified",
  "RecipientMailboxID", "RecipientMailbox", "RecipientStatus", "RecipientStatusDescription",
  "SenderMailboxID", "SenderMailbox", "OriginalMessage", "OriginalMessageSubject", "ForDivision",
  "SkipRecipientMailBoxAddressOverride", "Quantity",
];
const STATUS: Record<number, string> = { 5: "rejected", 10: "draft", 20: "open", 25: "prepared", 30: "approved", 40: "realized", 42: "in_process", 43: "at_the_scanning_service", 45: "error_during_processing", 46: "blocked", 50: "processed" };
const SOURCES: [string, string][] = [["sent", "mailbox/MailMessagesSent"], ["received", "mailbox/MailMessagesReceived"]];

function view(row: Row) {
  const out: Row = {};
  for (const k of KEEP) {
    if (!(k in row)) continue;
    const v = row[k];
    out[k] = typeof v === "string" && /^\/Date\(/.test(v) ? exactDate(v) : v;
  }
  if (typeof row.RecipientStatus === "number") out.recipient_status_label = STATUS[row.RecipientStatus] ?? "unknown";
  return out;
}

export default async function listMailMessages(args: { start_date: string; end_date: string; subject_contains?: string; max_messages?: number }, ctx: any) {
  const start = dayNumber(args.start_date);
  const end = dayNumber(args.end_date);
  if (start === null || end === null || end - start < 1 || end - start > 31) ctx.fail("invalid_input", "start_date and end_date must be YYYY-MM-DD, end exclusive, 1–31 days apart");
  const needle = args.subject_contains ? String(args.subject_contains) : null;
  if (needle !== null && (needle.trim().length < 2 || needle.length > 60 || /[\u0000-\u001f\u007f]/.test(needle))) ctx.fail("invalid_input", "subject_contains must be 2–60 characters");
  const max = args.max_messages ?? 30;
  if (!Number.isInteger(max) || max < 1 || max > 100) ctx.fail("invalid_input", "max_messages must be 1–100");
  const division = divisionOf(ctx);
  const filter = `Created ge datetime'${args.start_date}T00:00:00' and Created lt datetime'${args.end_date}T00:00:00'`;

  const results: Record<string, unknown> = {};
  const errors: Record<string, string | null> = {};
  for (const [name, resource] of SOURCES) {
    try {
      const res = await ctx.request({ method: "GET", path: `/${division}/${resource}`, query: { $filter: filter, $top: 100 } });
      const d = res?.data?.d;
      const rows: Row[] = Array.isArray(d) ? d : Array.isArray(d?.results) ? d.results : [];
      const lowered = needle?.toLowerCase() ?? null;
      const picked = rows
        .filter((r) => r && typeof r === "object" && (typeof r.ID !== "string" || GUID.test(r.ID.toLowerCase())))
        .filter((r) => lowered === null || String(r.Subject ?? "").toLowerCase().includes(lowered))
        .slice(0, max)
        .map(view);
      results[name] = { messages: picked, returned: picked.length, more_available: rows.length >= 100 || Boolean(d?.__next) };
      errors[name] = null;
    } catch (e: any) {
      results[name] = null;
      errors[name] = `${e?.code ?? "source_error"}${e?.status ? ` (HTTP ${e.status})` : ""}`;
    }
  }
  return {
    division: await divisionInfo(ctx),
    query: { start_date: args.start_date, end_date_exclusive: args.end_date, subject_contains: needle, max_messages: max },
    ...results,
    errors,
    limitations: [
      "Only message metadata: no body, no attachments. Subjects and mailbox addresses are free text and may contain names.",
      "RecipientStatus 43 = at the scanning service, 50 = processed. Compare a mailed receipt that was scanned with one sent by upload_receipt.",
      "An error for one source (sent or received) means Exact does not offer it or the field Created is unknown there; the other source may still answer.",
    ],
  };
}
