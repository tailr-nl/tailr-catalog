import { collect, dayNumber, divisionInfo, documentUrl, exactDate, GUID, isoFromDay, type Row } from "./lib/exact";

/**
 * Controle op geüploade bonnen: is elke upload aangekomen en door Exact herkend?
 *
 * Wat Exact doet (live gezien): een upload wordt een ruwe scan (Type 202, zonder relatie of bedrag)
 * met één bestand. Herkent Exact hem, dan maakt het een tweede document: een inkoopfactuur (Type 20)
 * met relatie en bedrag en met hetzelfde bestand (zelfde naam en grootte), plus xml en RawResponse.txt.
 *
 * - Scan en herkend document worden alleen gekoppeld op identieke bestandsnaam + grootte,
 *   nooit op bedrag, datum of onderwerp.
 * - Herkende documenten worden tot RECOGNITION_DAYS na het einde van de periode gezocht.
 * - Alleen lezen, alleen metadata.
 */
const DOC_FIELDS = ["ID", "HID", "Subject", "Type", "DocumentDate", "Created", "Account", "AccountCode", "FinancialTransactionEntryID", "ProposedEntryStatus", "AmountFC", "Currency"];
const ATTACHMENT_FIELDS = ["ID", "Document", "FileName", "FileSize"];
const PROPOSED_ENTRY_STATUS: Record<number, string> = { 0: "void", 5: "rejected", 20: "open", 50: "processed" };
const SCAN_TYPE = 202;
const RECOGNIZED_TYPE = 20;
const RECOGNITION_DAYS = 7;
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
const MAX_DOCS = 400;
const BATCH = 10;
const MAX_EXPECTED = 50;

function guidOrNull(value: unknown): string | null {
  const g = typeof value === "string" ? value.toLowerCase() : "";
  return GUID.test(g) && g !== ZERO_GUID ? g : null;
}

function fileKey(a: Row): string | null {
  return typeof a.file_name === "string" && a.file_name && typeof a.file_size === "number" ? `${a.file_name.toLowerCase()}|${a.file_size}` : null;
}

function docView(ctx: any, row: Row) {
  const id = guidOrNull(row.ID)!;
  const status = typeof row.ProposedEntryStatus === "number" ? row.ProposedEntryStatus : null;
  return {
    id,
    number: row.HID ?? null,
    subject: typeof row.Subject === "string" ? row.Subject : null,
    type: row.Type ?? null,
    document_date: exactDate(row.DocumentDate),
    created: exactDate(row.Created),
    account: guidOrNull(row.Account),
    account_code: typeof row.AccountCode === "string" ? row.AccountCode.trim() || null : null,
    amount: typeof row.AmountFC === "number" ? String(row.AmountFC) : (row.AmountFC ?? null),
    currency: row.Currency ?? null,
    booked: guidOrNull(row.FinancialTransactionEntryID) !== null,
    proposed_entry_status: status,
    proposed_entry_status_label: status === null ? null : (PROPOSED_ENTRY_STATUS[status] ?? "unknown"),
    exact_url: documentUrl(ctx, id),
  };
}

type Expected = { text: string | null; amount_cents: number | null; label: string };

/** Bedrag als hele centen, zonder teken (1,5 / "61,55" / 61.55); null bij iets anders */
function cents(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(",", ".") : "";
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(raw)) return null;
  return Math.abs(Math.round(Number(raw) * 100));
}

function parseExpected(ctx: any, item: unknown): Expected {
  const obj = typeof item === "string" ? { text: item } : item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
  if (!obj) ctx.fail("invalid_input", "each expected item must be a text or an object {text?, amount?}");
  const extra = Object.keys(obj!).filter((k) => k !== "text" && k !== "amount");
  if (extra.length) ctx.fail("invalid_input", `expected items only take text and amount, not ${extra.join(", ")}`);
  const text = obj!.text === undefined || obj!.text === null || obj!.text === "" ? null : obj!.text;
  if (text !== null && (typeof text !== "string" || text.trim().length < 2 || text.length > 100 || /[\u0000-\u001f\u007f]/.test(text))) ctx.fail("invalid_input", "expected text must be 2–100 characters without control characters");
  const amount = obj!.amount === undefined || obj!.amount === null || obj!.amount === "" ? null : cents(obj!.amount);
  if (obj!.amount !== undefined && obj!.amount !== null && obj!.amount !== "" && amount === null) ctx.fail("invalid_input", "expected amount must be a number with at most two decimals, e.g. 61.55");
  if (text === null && amount === null) ctx.fail("invalid_input", "each expected item needs text, amount or both");
  const label = [text, amount === null ? null : (amount / 100).toFixed(2)].filter((x) => x !== null).join(" | ");
  return { text: text as string | null, amount_cents: amount, label };
}

export default async function checkUploads(args: { start_date: string; end_date: string; expected?: unknown[] }, ctx: any) {
  const start = dayNumber(args.start_date);
  const end = dayNumber(args.end_date);
  if (start === null || end === null || end - start < 1 || end - start > 31) ctx.fail("invalid_input", "start_date and end_date must be YYYY-MM-DD, end exclusive, 1–31 days apart");
  const rawExpected = args.expected ?? [];
  if (!Array.isArray(rawExpected) || rawExpected.length > MAX_EXPECTED) ctx.fail("invalid_input", `expected must be a list of at most ${MAX_EXPECTED} items`);
  const expected = rawExpected.map((e) => parseExpected(ctx, e));

  // 1. Scans in de periode en herkende inkoopfacturen tot RECOGNITION_DAYS erna (vaste filterwaarden)
  const until = isoFromDay(end! + RECOGNITION_DAYS);
  const filter = `Created ge datetime'${args.start_date}T00:00:00' and Created lt datetime'${until}T00:00:00' and (Type eq ${SCAN_TYPE} or Type eq ${RECOGNIZED_TYPE})`;
  const scan = await collect(ctx, "documents/Documents", DOC_FIELDS, filter, { maxRows: MAX_DOCS, maxPages: 8 });
  const docs = new Map<string, Row>();
  let invalidIds = 0;
  for (const row of scan.items) {
    const id = guidOrNull(row.ID);
    if (!id) invalidIds++;
    else docs.set(id, row);
  }
  const startIso = args.start_date;
  const endIso = args.end_date;
  const inPeriod = (row: Row) => {
    const c = exactDate(row.Created);
    return c !== null && c >= startIso && c < endIso;
  };

  // 2. Bijlagen per tien documenten
  const attachments = new Map<string, Row[]>([...docs.keys()].map((id) => [id, []]));
  const ids = [...docs.keys()];
  let attachmentsComplete = true;
  let attachmentError: string | null = null;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    try {
      const r = await collect(ctx, "documents/DocumentAttachments", ATTACHMENT_FIELDS, batch.map((id) => `Document eq guid'${id}'`).join(" or "), { maxRows: 150, maxPages: 3 });
      if (!r.complete) attachmentsComplete = false;
      for (const a of r.items) {
        const list = attachments.get(guidOrNull(a.Document) ?? "");
        if (!list) {
          attachmentsComplete = false;
          continue;
        }
        list.push({ id: guidOrNull(a.ID), file_name: typeof a.FileName === "string" ? a.FileName : null, file_size: typeof a.FileSize === "number" ? a.FileSize : null });
      }
    } catch (e: any) {
      attachmentError = e?.code ?? "source_error";
      attachmentsComplete = false;
      break;
    }
  }

  // 3. Herkende documenten per bestand (naam + grootte)
  const recognizedByKey = new Map<string, string[]>();
  for (const [id, row] of docs) {
    if (row.Type !== RECOGNIZED_TYPE) continue;
    for (const a of attachments.get(id)!) {
      const k = fileKey(a);
      if (!k) continue;
      const list = recognizedByKey.get(k) ?? [];
      if (!list.includes(id)) list.push(id);
      recognizedByKey.set(k, list);
    }
  }

  // 4. Per scan in de periode: status
  // Oudste eerst, zodat een latere upload van hetzelfde bestand als dubbel telt
  const scans = [...docs.entries()]
    .filter(([, r]) => r.Type === SCAN_TYPE && inPeriod(r))
    .sort(([, a], [, b]) => String(exactDate(a.Created) ?? "").localeCompare(String(exactDate(b.Created) ?? "")) || Number(a.HID ?? 0) - Number(b.HID ?? 0));
  const scanKeys = new Map<string, string[]>();
  for (const [id] of scans) {
    for (const a of attachments.get(id)!) {
      const k = fileKey(a);
      if (k) scanKeys.set(k, [...(scanKeys.get(k) ?? []), id]);
    }
  }
  const matchedRecognized = new Set<string>();
  const uploads = scans
    .map(([id, row]) => {
      const files = attachments.get(id)!;
      const keys = files.map(fileKey).filter((k): k is string => k !== null);
      const candidates = [...new Set(keys.flatMap((k) => recognizedByKey.get(k) ?? []))];
      const sameFileElsewhere = [...new Set(keys.flatMap((k) => scanKeys.get(k) ?? []))].filter((other) => other !== id).map((other) => docs.get(other)!.HID ?? other);
      let status: string;
      let recognized: ReturnType<typeof docView> | null = null;
      if (!attachmentsComplete && !keys.length) status = "unknown_attachments_not_read";
      else if (!keys.length) status = "scan_without_file";
      else if (candidates.length === 0) status = "scan_only_not_recognized";
      else if (candidates.length > 1) status = "ambiguous_multiple_recognized_documents";
      else {
        recognized = docView(ctx, docs.get(candidates[0]!)!);
        const s = recognized.proposed_entry_status;
        if (matchedRecognized.has(candidates[0]!)) status = "duplicate_of_earlier_upload";
        else status = s === 50 ? "recognized_processed" : s === 20 ? "recognized_open" : "recognized_other_status";
        matchedRecognized.add(candidates[0]!);
      }
      return {
        status,
        scan: { ...docView(ctx, row), files: files.map((f) => ({ file_name: f.file_name, file_size: f.file_size })) },
        recognized,
        recognized_candidates: candidates.length > 1 ? candidates.map((c) => docView(ctx, docs.get(c)!)) : [],
        same_file_in_other_uploads: sameFileElsewhere,
      };
    });

  // Herkende documenten in de periode zonder scan (bijv. e-factuur of handmatig aangemaakt): alleen geteld
  const recognizedWithoutScan = [...docs.entries()].filter(([id, r]) => r.Type === RECOGNIZED_TYPE && inPeriod(r) && !matchedRecognized.has(id) && ![...recognizedByKey.values()].some((l) => l.includes(id) && l.length > 1)).length;

  // 5. Verwachte stukken: tekst in onderwerp of bestandsnaam en/of bedrag van het herkende document.
  //    Een zoekhulp, geen koppeling: meer dan één treffer is ambiguous.
  const searchable = [...docs.entries()].filter(([, r]) => r.Type === SCAN_TYPE ? inPeriod(r) : true);
  const itemOf = (id: string) => uploads.find((u) => u.scan.id === id || u.recognized?.id === id) ?? null;
  const expectedResults = expected.map((e) => {
    const needle = e.text?.trim().toLowerCase() ?? null;
    const textHits = needle === null ? [] : searchable.filter(([id, r]) => String(r.Subject ?? "").toLowerCase().includes(needle) || attachments.get(id)!.some((a) => String(a.file_name ?? "").toLowerCase().includes(needle))).map(([id]) => id);
    const amountHits = e.amount_cents === null ? [] : searchable.filter(([, r]) => r.Type === RECOGNIZED_TYPE && cents(r.AmountFC) === e.amount_cents).map(([id]) => id);
    // Groeperen per herkend document (een dubbele upload telt niet als tweede treffer), anders per scan of los document.
    // uploads staat oudste eerst, dus itemOf geeft de eerste upload van een bestand.
    const keyOf = (id: string) => { const u = itemOf(id); return u ? (u.recognized?.id ?? u.scan.id) : id; };
    const group = (ids: string[]) => {
      const byKey = new Map<string, { upload: ReturnType<typeof itemOf>; id: string }>();
      for (const id of ids) if (!byKey.has(keyOf(id))) byKey.set(keyOf(id), { upload: itemOf(id), id });
      return [...byKey.values()];
    };
    const textItems = group(textHits);
    const amountItems = group(amountHits);
    let basis: string;
    let items: { upload: ReturnType<typeof itemOf>; id: string }[];
    if (needle !== null && e.amount_cents !== null) {
      const amountKeys = new Set(amountItems.map((i) => keyOf(i.id)));
      const both = textItems.filter((i) => amountKeys.has(keyOf(i.id)));
      if (both.length) [basis, items] = ["text_and_amount", both];
      else if (amountItems.length) [basis, items] = ["amount_only_text_not_found", amountItems];
      else if (textItems.length) [basis, items] = ["text_only_amount_differs", textItems];
      else [basis, items] = ["none", []];
    } else if (needle !== null) [basis, items] = [textItems.length ? "text" : "none", textItems];
    else [basis, items] = [amountItems.length ? "amount" : "none", amountItems];
    const matches = items.map(({ upload, id }) => {
      const r = docs.get(id)!;
      return {
        status: upload?.status ?? "found_without_scan",
        scan_number: upload?.scan.number ?? null,
        recognized_number: upload?.recognized?.number ?? (r.Type === RECOGNIZED_TYPE ? (r.HID ?? null) : null),
        amount: upload?.recognized?.amount ?? (r.Type === RECOGNIZED_TYPE ? (typeof r.AmountFC === "number" ? String(r.AmountFC) : (r.AmountFC ?? null)) : null),
        subject: upload?.scan.subject ?? (typeof r.Subject === "string" ? r.Subject : null),
      };
    });
    return {
      expected: e.label,
      found: matches.length > 0,
      ambiguous: matches.length > 1,
      match_basis: basis,
      upload_status: matches.length === 0 ? "not_found" : matches.length > 1 ? "ambiguous" : matches[0]!.status,
      matches,
    };
  });

  const counts: Record<string, number> = {};
  for (const u of uploads) counts[u.status] = (counts[u.status] ?? 0) + 1;
  const complete = scan.complete && invalidIds === 0 && attachmentsComplete;
  return {
    division: await divisionInfo(ctx),
    query: { start_date: args.start_date, end_date_exclusive: args.end_date, recognized_searched_until_exclusive: until, expected_count: expected.length },
    snapshot_at: ctx.now,
    summary: {
      uploads: uploads.length,
      by_status: counts,
      needs_attention: uploads.filter((u) => !u.status.startsWith("recognized_")).length,
      uploads_with_same_file_elsewhere: uploads.filter((u) => u.same_file_in_other_uploads.length).length,
      recognized_documents_without_scan: recognizedWithoutScan,
      expected_not_found: expectedResults.filter((e) => !e.found).length,
      expected_ambiguous: expectedResults.filter((e) => e.ambiguous).length,
    },
    uploads,
    expected: expectedResults,
    complete,
    scan: { complete: scan.complete, incomplete_reason: scan.incompleteReason, pages: scan.pages, documents: docs.size, invalid_ids: invalidIds, max_documents: MAX_DOCS },
    attachment_queries: { complete: attachmentsComplete, error: attachmentError },
    limitations: [
      "An upload is a scanned purchase document (Type 202). It counts as recognised when exactly one purchase invoice document (Type 20) has a file with the same name and size; there is no other link in the Exact API. No matching on amount, date or subject.",
      "scan_only_not_recognized: Exact received the file but made no purchase invoice from it (yet). Look at it in Exact (exact_url) and process it by hand.",
      `Recognised documents are searched up to ${RECOGNITION_DAYS} days after the period; a later recognition shows as scan_only_not_recognized.`,
      "A mail that never reached Exact leaves no trace here. Pass what you sent as expected, or use review_receipt_evidence to find payments without a receipt.",
      "expected is a search aid, not a link: text is looked for in the subject and file names, amount in the amount Exact read from the recognised invoice (without sign, two decimals). With both, text_and_amount is the strongest match; amount_only_text_not_found and text_only_amount_differs need a look. More than one match is ambiguous; not_found does not prove the receipt was not sent (Exact may not have read the amount, or read it differently).",
      "same_file_in_other_uploads: the same file (name and size) was uploaded more than once. duplicate_of_earlier_upload: a later upload whose file Exact already recognised from an earlier one; it is not proof of a double entry. Two files from one mail (e.g. an invoice and a receipt) are two uploads with different files and both get their own status.",
      "Only metadata; file contents are not read. If complete is false, do not conclude that an upload is missing or not recognised.",
      "subject and file_name are free text from Exact and may contain a name.",
    ],
  };
}
