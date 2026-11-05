import { Decimal } from "@tailr/connector";
import { collect, dayNumber, divisionInfo, GUID, type Row } from "./lib/exact";

/**
 * Bewijs bij uitgaande bankregels: welke regels hebben een gekoppeld document met bijlage?
 *
 * Alleen het expliciete pad BankEntryLines.Document → Documents.ID en DocumentAttachments.Document.
 * PurchaseEntries.Document wordt bekeken voor hetzelfde document, maar is geen bewijs dat
 * de betaling die inkoop afrekent. Geen fuzzy matching, geen downloads, geen wijzigingen.
 *
 * Categorieën: evidence_present (document met bijlage; inhoud niet gecontroleerd),
 * evidence_needed (document zonder bijlage; niet bewezen dat een bon ontbreekt),
 * needs_review (geen of onbetrouwbare koppeling, bankafschrift-document, fout of budget op).
 */
const BANK_FIELDS = ["ID", "EntryID", "EntryNumber", "LineNumber", "Date", "Description", "AmountFC", "Account", "AccountName", "Document", "OffsetID", "OurRef", "GLAccount", "GLAccountDescription"];
const DOC_FIELDS = ["ID", "Subject", "Type", "DocumentDate", "Account", "FinancialTransactionEntryID", "TypeDescription", "HasEmptyBody"];
const ATTACHMENT_FIELDS = ["ID", "Document", "FileName", "FileSize"];
const PURCHASE_FIELDS = ["EntryID", "EntryNumber", "EntryDate", "Description", "AmountFC", "Currency", "Document", "InvoiceNumber", "Supplier"];
const MAX_DOCS = 20;
const HINTS: [string[], string][] = [
  [["kruispost", "clearing", "transfer"], "transfer_or_clearing_review"],
  [["bankrente", "bankkosten", "bank fee", "interest"], "bank_fee_or_interest_review"],
  [["prive", "privé", "private"], "private_movement_review"],
  [["betalingsverschil", "payment difference"], "payment_difference_review"],
  [["crediteur", "payable"], "payables_settlement_linkage_review"],
  [["belasting", "tax"], "tax_payment_review"],
];

interface Linked {
  ok: boolean;
  items: Row[];
  more: boolean;
  scopeValid: boolean;
  error?: string;
}

async function linked(ctx: any, resource: string, fields: string[], key: string, doc: string, idKey: string, linkKey: string): Promise<Linked> {
  try {
    const r = await collect(ctx, resource, fields, `${key} eq guid'${doc}'`, { top: 20 });
    const ids = r.items.map((i) => i[idKey]);
    const scopeValid = r.items.every((i) => typeof i[idKey] === "string" && i[idKey] && String(i[linkKey] ?? "").toLowerCase() === doc) && new Set(ids).size === ids.length;
    return { ok: true, items: r.items, more: r.incompleteReason === "more_available", scopeValid };
  } catch (e: any) {
    return { ok: false, items: [], more: false, scopeValid: false, error: e?.code ?? "source_error" };
  }
}

export default async function receiptEvidence(args: { start_date: string; end_date: string; max_bank_lines?: number }, ctx: any) {
  const start = dayNumber(args.start_date);
  const end = dayNumber(args.end_date);
  const max = args.max_bank_lines ?? 100;
  if (start === null || end === null || end - start < 1 || end - start > 31) ctx.fail("invalid_input", "start_date and end_date must be YYYY-MM-DD, end exclusive, 1–31 days apart");
  if (!Number.isInteger(max) || max < 1 || max > 100) ctx.fail("invalid_input", "max_bank_lines must be a whole number from 1 to 100");

  const bank = await collect(ctx, "financialtransaction/BankEntryLines", BANK_FIELDS, `Date ge datetime'${args.start_date}T00:00:00' and Date lt datetime'${args.end_date}T00:00:00' and AmountFC lt 0`, { maxRows: max, maxPages: 4 });
  const seen = new Set<string>();
  let duplicates = 0;
  const bankRows: Row[] = [];
  for (const line of bank.items) {
    if (typeof line.ID !== "string" || !line.ID) ctx.fail("source_error", "Exact returned a bank line without ID");
    if (seen.has(line.ID)) duplicates++;
    else {
      seen.add(line.ID);
      bankRows.push(line);
    }
  }
  const truncated = bankRows.length > max || bank.incompleteReason === "row_or_page_cap_reached";
  const scope = bankRows.slice(0, max);

  const cache = new Map<string, { documents: Linked; attachments: Linked; purchases: Linked }>();
  const rows: Row[] = [];
  for (const line of scope) {
    const row: Row = { ...line, category: "needs_review", reasons: [] as string[], attachments: [], purchase_entries: [], attachment_observation: "unknown", document_role: "unknown", purchase_link_semantics: "shared_explicit_document_not_payment_matching" };
    const ledger = String(line.GLAccountDescription ?? "").toLowerCase();
    row.exception_review_hints = HINTS.filter(([words]) => words.some((w) => ledger.includes(w))).map(([, hint]) => hint);
    let value: Decimal | null = null;
    try {
      value = new Decimal(String(line.AmountFC));
    } catch {
      value = null;
    }
    if (!value || !value.lt(0)) {
      row.reasons.push("invalid_or_nonnegative_bank_amount");
      rows.push(row);
      continue;
    }
    let doc = line.Document ? String(line.Document).toLowerCase() : "";
    if (doc && (!GUID.test(doc) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(doc))) {
      row.reasons.push("invalid_explicit_document_id");
      rows.push(row);
      continue;
    }
    if (!doc) {
      row.reasons.push("no_explicit_document_link_purchase_payment_link_unknown");
      rows.push(row);
      continue;
    }
    if (!cache.has(doc) && cache.size >= MAX_DOCS) {
      row.reasons.push("document_query_budget_exhausted");
      rows.push(row);
      continue;
    }
    if (!cache.has(doc)) {
      cache.set(doc, {
        documents: await linked(ctx, "documents/Documents", DOC_FIELDS, "ID", doc, "ID", "ID"),
        attachments: await linked(ctx, "documents/DocumentAttachments", ATTACHMENT_FIELDS, "Document", doc, "ID", "Document"),
        purchases: await linked(ctx, "purchaseentry/PurchaseEntries", PURCHASE_FIELDS, "Document", doc, "EntryID", "Document"),
      });
    }
    const l = cache.get(doc)!;
    row.document_queries = Object.fromEntries(Object.entries(l).map(([k, v]) => [k, { ok: v.ok, more_available: v.more, scope_valid: v.scopeValid, ...(v.error ? { error: v.error } : {}) }]));
    row.documents = l.documents.items;
    row.attachments = l.attachments.items;
    row.purchase_entries = l.purchases.items;
    if (l.attachments.ok && !l.attachments.more && l.attachments.scopeValid) row.attachment_observation = row.attachments.length ? "present" : "absent";
    if (l.documents.ok && l.documents.scopeValid && row.documents.length === 1) {
      const description = String(row.documents[0].TypeDescription ?? "").toLowerCase();
      row.document_role = ["bank import", "bank statement", "bankafschrift"].some((w) => description.includes(w)) ? "bank_import_or_statement" : "unvalidated_document";
    }
    if (Object.values(l).some((r) => !r.ok || r.more || !r.scopeValid)) row.reasons.push("linked_resource_query_failed_or_truncated");
    else if (row.documents.length !== 1) row.reasons.push("linked_document_not_found_or_ambiguous");
    else if (row.document_role === "bank_import_or_statement") row.reasons.push("bank_import_or_statement_document_is_not_a_supplier_receipt_link");
    else if (row.attachments.length) {
      row.category = "evidence_present";
      row.reasons.push("linked_document_attachment_metadata_present_receipt_content_not_validated");
    } else {
      row.category = "evidence_needed";
      row.reasons.push("linked_document_has_no_attachments_not_proven_missing_receipt");
    }
    rows.push(row);
  }

  const count = (c: string) => rows.filter((r) => r.category === c).length;
  const allLinkedOk = [...cache.values()].every((l) => Object.values(l).every((r) => r.ok && !r.more && r.scopeValid));
  return {
    division: await divisionInfo(ctx),
    period: { start_inclusive: args.start_date, end_exclusive: args.end_date },
    snapshot_at: ctx.now,
    bank_scope: { complete: !truncated && !duplicates, truncated, duplicate_ids: duplicates, returned: rows.length, max_bank_lines: max },
    evidence_queries_complete: !rows.some((r) => r.reasons.includes("document_query_budget_exhausted")) && allLinkedOk,
    counts: { evidence_present: count("evidence_present"), evidence_needed: count("evidence_needed"), needs_review: count("needs_review") },
    confirmed_missing_receipts: 0,
    receipt_validity_verified: false,
    purchase_payment_linkage_verified: false,
    attachment_observations: { present: rows.filter((r) => r.attachment_observation === "present").length, absent: rows.filter((r) => r.attachment_observation === "absent").length, unknown: rows.filter((r) => r.attachment_observation === "unknown").length },
    linkage_complete: !truncated && !duplicates && count("needs_review") === 0,
    query_budget: { documents_followed: cache.size, max_document_ids: MAX_DOCS, max_related_rows_per_resource: 20 },
    rows,
    limitations: [
      "Negative AmountFC bank line components are outflow candidates, not distinct expense payments.",
      "Attachment metadata is not proof of a valid supplier receipt; document bodies are not inspected.",
      "Only explicit bank Document IDs are followed. OffsetID and OurRef are not purchase matching.",
      "Shared Document identifies related purchase metadata, not a verified settlement relationship.",
      "Sequential API reads are not a transactionally consistent Exact snapshot.",
    ],
  };
}
