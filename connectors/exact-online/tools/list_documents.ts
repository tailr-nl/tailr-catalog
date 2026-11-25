import { collect, dayNumber, divisionInfo, exactDate, GUID, type Row } from "./lib/exact";

/**
 * Documenten in een periode van 1–31 dagen (begin inclusief, eind exclusief), met per document
 * de metadata van de bijlagen en of het aan een boeking hangt.
 *
 * - Exact filtert op datum, soort en relatie. Onderwerp, wel/niet geboekt en wel/geen bijlage
 *   filtert de code zelf, na het ophalen: die waarden gaan dus nooit in een OData-filter.
 * - Bijlagen worden per tien documenten tegelijk opgehaald (Document eq guid'…' or …).
 * - Alleen metadata: geen inhoud van documenten of bijlagen, geen download-URL's, geen wijzigingen.
 * - Geen namen van relaties of medewerkers. Onderwerp en bestandsnaam zijn vrije tekst uit Exact.
 */
const DOC_FIELDS = ["ID", "HID", "Subject", "Type", "TypeDescription", "DocumentDate", "Created", "Account", "AccountCode", "FinancialTransactionEntryID", "ProposedEntryStatus", "AmountFC", "Currency"];
const ATTACHMENT_FIELDS = ["ID", "Document", "FileName", "FileSize"];
const DATE_FIELDS: Record<string, string> = { document_date: "DocumentDate", created: "Created" };
const PROPOSED_ENTRY_STATUS: Record<number, string> = { 0: "void", 5: "rejected", 20: "open", 50: "processed" };
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
const MAX_SCAN_PAGES = 15; // 15 × 60 = hooguit 900 documenten bekijken
const MAX_SCAN_ROWS = 900;
const BATCH = 10;
const MAX_BATCHES = 20; // hooguit 200 documenten waarvan de bijlagen worden opgehaald
const MAX_DOCUMENTS = 200;

function guidOrNull(value: unknown): string | null {
  const g = typeof value === "string" ? value.toLowerCase() : "";
  return GUID.test(g) && g !== ZERO_GUID ? g : null;
}

function optionalBoolean(ctx: any, name: string, value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") ctx.fail("invalid_input", `${name} must be true or false`);
  return value as boolean;
}

export default async function listDocuments(
  args: { start_date: string; end_date: string; date_field?: string; type?: number; account?: string; subject_contains?: string; only_unbooked?: boolean; has_attachments?: boolean; max_documents?: number },
  ctx: any,
) {
  const start = dayNumber(args.start_date);
  const end = dayNumber(args.end_date);
  if (start === null || end === null || end - start < 1 || end - start > 31) ctx.fail("invalid_input", "start_date and end_date must be YYYY-MM-DD, end exclusive, 1–31 days apart");
  const dateField = args.date_field ?? "document_date";
  if (typeof dateField !== "string" || !Object.prototype.hasOwnProperty.call(DATE_FIELDS, dateField)) ctx.fail("invalid_input", "date_field must be document_date or created");
  const max = args.max_documents ?? 100;
  if (!Number.isInteger(max) || max < 1 || max > MAX_DOCUMENTS) ctx.fail("invalid_input", `max_documents must be a whole number from 1 to ${MAX_DOCUMENTS}`);
  const type = args.type ?? null;
  if (type !== null && (!Number.isInteger(type) || type < 0 || type > 99999)) ctx.fail("invalid_input", "type must be a document type number (whole number, 0–99999)");
  const account = args.account ? String(args.account).toLowerCase() : null;
  if (account !== null && !GUID.test(account)) ctx.fail("invalid_input", "account must be the GUID of a relation (see list_accounts)");
  // Het onderwerp wordt alleen in de code vergeleken en gaat niet naar Exact; toch begrensd
  const needle = args.subject_contains === undefined || args.subject_contains === null || args.subject_contains === "" ? null : args.subject_contains;
  if (needle !== null && (typeof needle !== "string" || needle.trim().length < 2 || needle.length > 60 || /[\u0000-\u001f\u007f'"\\]/.test(needle))) {
    ctx.fail("invalid_input", "subject_contains must be 2–60 characters, without quotes, backslashes or control characters");
  }
  const onlyUnbooked = optionalBoolean(ctx, "only_unbooked", args.only_unbooked) === true;
  const hasAttachments = optionalBoolean(ctx, "has_attachments", args.has_attachments);

  // 1. Documenten in de periode: alleen vaste, gecontroleerde waarden in het filter
  const column = DATE_FIELDS[dateField]!;
  let filter = `${column} ge datetime'${args.start_date}T00:00:00' and ${column} lt datetime'${args.end_date}T00:00:00'`;
  if (type !== null) filter += ` and Type eq ${type}`;
  if (account !== null) filter += ` and Account eq guid'${account}'`;
  const scan = await collect(ctx, "documents/Documents", DOC_FIELDS, filter, { maxRows: MAX_SCAN_ROWS, maxPages: MAX_SCAN_PAGES });

  // 2. Ontdubbelen, eigen filters, nieuwste eerst
  const seen = new Set<string>();
  let duplicates = 0;
  let invalidIds = 0;
  const documents: Row[] = [];
  for (const row of scan.items) {
    const id = guidOrNull(row.ID);
    if (!id) {
      invalidIds++;
      continue;
    }
    if (seen.has(id)) {
      duplicates++;
      continue;
    }
    seen.add(id);
    const entry = guidOrNull(row.FinancialTransactionEntryID);
    const status = typeof row.ProposedEntryStatus === "number" ? row.ProposedEntryStatus : null;
    documents.push({
      id,
      number: row.HID ?? null,
      subject: typeof row.Subject === "string" ? row.Subject : null,
      type: row.Type ?? null,
      type_description: row.TypeDescription ?? null,
      document_date: exactDate(row.DocumentDate),
      created: exactDate(row.Created),
      account: guidOrNull(row.Account),
      account_code: typeof row.AccountCode === "string" ? row.AccountCode.trim() || null : null,
      amount: typeof row.AmountFC === "number" ? String(row.AmountFC) : (row.AmountFC ?? null),
      currency: row.Currency ?? null,
      booked: entry !== null,
      financial_entry_id: entry,
      proposed_entry_status: status,
      proposed_entry_status_label: status === null ? null : (PROPOSED_ENTRY_STATUS[status] ?? "unknown"),
    });
  }
  const lowered = needle?.toLowerCase() ?? null;
  const candidates = documents
    .filter((d) => (lowered === null || String(d.subject ?? "").toLowerCase().includes(lowered)) && (!onlyUnbooked || !d.booked))
    .sort((a, b) => String(b[dateField] ?? "").localeCompare(String(a[dateField] ?? "")) || String(a.id).localeCompare(String(b.id)));

  // 3. Bijlagen per tien documenten; met has_attachments zoeken we door tot max of tot het budget op is
  const selected: Row[] = [];
  let examined = 0;
  let batches = 0;
  let unknownDocuments = 0;
  let overflow = 0;
  let attachmentError: string | null = null;
  let foreignAttachments = 0;
  while (selected.length < max && examined < candidates.length && batches < MAX_BATCHES) {
    const size = hasAttachments === null ? Math.min(BATCH, max - selected.length) : BATCH;
    const batch = candidates.slice(examined, examined + size);
    examined += batch.length;
    batches++;
    const byDocument = new Map<string, Row[]>(batch.map((d) => [d.id, []]));
    let known = attachmentError === null;
    if (known) {
      try {
        const r = await collect(ctx, "documents/DocumentAttachments", ATTACHMENT_FIELDS, batch.map((d) => `Document eq guid'${d.id}'`).join(" or "), { maxRows: 120, maxPages: 2 });
        if (!r.complete) known = false;
        for (const a of r.items) {
          const list = byDocument.get(guidOrNull(a.Document) ?? "");
          if (!list) {
            foreignAttachments++;
            known = false;
            continue;
          }
          list.push({ id: guidOrNull(a.ID), file_name: typeof a.FileName === "string" ? a.FileName : null, file_size: typeof a.FileSize === "number" ? a.FileSize : null });
        }
      } catch (e: any) {
        attachmentError = e?.code ?? "source_error";
        known = false;
      }
    }
    if (!known) unknownDocuments += batch.length;
    for (const d of batch) {
      const attachments = known ? byDocument.get(d.id)! : [];
      const view = { ...d, attachments_known: known, attachment_count: known ? attachments.length : null, attachments };
      // Met has_attachments tellen alleen documenten waarvan de bijlagen bekend zijn
      if (hasAttachments !== null && (!known || attachments.length > 0 !== hasAttachments)) continue;
      if (selected.length < max) selected.push(view);
      else overflow++;
    }
  }

  const unknown = selected.filter((d) => !d.attachments_known).length;
  // Meer passende documenten dan er zijn teruggegeven (of nog niet bekeken)
  const truncated = examined < candidates.length || overflow > 0;
  const attachmentsComplete = attachmentError === null && foreignAttachments === 0 && unknownDocuments === 0;
  const scanComplete = scan.complete && duplicates === 0 && invalidIds === 0;
  return {
    division: await divisionInfo(ctx),
    query: {
      start_date: args.start_date, end_date_exclusive: args.end_date, date_field: dateField, type, account,
      subject_contains: needle, only_unbooked: onlyUnbooked, has_attachments: hasAttachments, max_documents: max,
    },
    snapshot_at: ctx.now,
    documents: selected,
    summary: {
      total: selected.length,
      with_attachments: selected.filter((d) => d.attachments_known && d.attachment_count > 0).length,
      without_attachments: selected.filter((d) => d.attachments_known && d.attachment_count === 0).length,
      attachments_unknown: unknown,
      booked: selected.filter((d) => d.booked).length,
      unbooked: selected.filter((d) => !d.booked).length,
      // Vóór has_attachments en max_documents: alles wat op periode, soort, relatie, onderwerp en only_unbooked past
      matched_in_scan: candidates.length,
      scanned: documents.length,
    },
    complete: scanComplete && !truncated && attachmentsComplete,
    truncated,
    scan: { complete: scanComplete, incomplete_reason: scan.incompleteReason, pages: scan.pages, duplicate_ids: duplicates, invalid_ids: invalidIds, max_rows: MAX_SCAN_ROWS },
    attachment_queries: { complete: attachmentsComplete, batches, documents_examined: examined, documents_with_unknown_attachments: unknownDocuments, max_documents_examined: BATCH * MAX_BATCHES, error: attachmentError, attachments_outside_batch: foreignAttachments },
    limitations: [
      "booked = the document has a FinancialTransactionEntryID. For a sales invoice document Exact puts the sales invoice ID there, not a financial entry.",
      "booked = false does not prove that nothing was booked: an entry can exist without a link to the document.",
      "Only attachment metadata (file name, size). Document bodies and attachment contents are not read; there are no download links.",
      "Counts are over the returned documents. If complete is false or truncated is true, do not conclude that a document does not exist.",
      "subject and file_name are free text from Exact and may contain a name. Relation names are left out; use account or account_code.",
      "Sequential API reads are not a transactionally consistent Exact snapshot.",
    ],
  };
}
