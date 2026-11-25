import { Decimal } from "@tailr/connector";
import { collect, dayNumber, divisionInfo, GUID, type Row } from "./lib/exact";

/**
 * Bewijs bij uitgaande bankregels: welke regels hebben een gekoppeld document met bijlage?
 *
 * Twee expliciete paden, geen fuzzy matching, geen downloads, geen wijzigingen:
 *
 * 1. bank_line_document: BankEntryLines.Document → Documents.ID en DocumentAttachments.Document.
 *    PurchaseEntries.Document wordt bekeken voor hetzelfde document, maar is geen bewijs dat
 *    de betaling die inkoop afrekent.
 * 2. purchase_invoice_document (alleen als pad 1 geen bijlage opleverde): de regels van de
 *    bankboeking (TransactionLines op EntryID) → de tegenregel met hetzelfde LineNumber op de
 *    tegenrekening van de bankregel (dus niet de regel op de bankrekening zelf), met een
 *    InvoiceNumber → de inkoopboeking: TransactionLines met EntryNumber = dat factuurnummer en
 *    Type 30/31 (inkoopboeking, inkoopcreditnota) → het veld Document van die boeking →
 *    Documents en DocumentAttachments.
 *    Bron voor de inkoopboeking is TransactionLines en niet PurchaseEntries: dit pad is in een
 *    echte administratie nagelopen, dekt elke inkoopboeking ongeacht hoe ze is gemaakt, en Type
 *    sluit een boeking met hetzelfde nummer in een ander soort dagboek uit.
 *    Nooit op bedrag, datum, OffsetID of omschrijving.
 *
 * Documenten, bijlagen, boekingsregels en grootboekrekeningen gaan per tien in één verzoek
 * (or-filter). Is een verzoek afgekapt, dan geldt dat voor alle tien: nooit een halve uitkomst.
 * Na een limietfout doet de functie geen verdere verzoeken; die regels krijgen een eigen reden.
 *
 * Categorieën: evidence_present (document met bijlage; inhoud niet gecontroleerd),
 * evidence_needed (document zonder bijlage; niet bewezen dat een bon ontbreekt),
 * needs_review (geen of onbetrouwbare koppeling, bankafschrift-document, fout of limiet).
 *
 * Ergste geval aan verzoeken (100 bankregels, alles verschillend, elk verzoek tot de laatste
 * pagina): 4 bankregels + 10 grootboek + pad 1: 10 documenten, 20 bijlagen, 10 inkoopboekingen
 * + pad 2: 40 bankboekingsregels, 30 inkoopregels, 10 documenten, 20 bijlagen + 1 administratie
 * = 155 (maxCalls 160 in connector.json).
 */
const BANK_FIELDS = ["ID", "EntryID", "EntryNumber", "LineNumber", "Date", "Description", "AmountFC", "Account", "AccountName", "Document", "OffsetID", "OurRef", "GLAccount", "GLAccountCode", "GLAccountDescription"];
const DOC_FIELDS = ["ID", "Subject", "Type", "DocumentDate", "Account", "FinancialTransactionEntryID", "TypeDescription", "HasEmptyBody"];
const ATTACHMENT_FIELDS = ["ID", "Document", "FileName", "FileSize"];
const PURCHASE_FIELDS = ["EntryID", "EntryNumber", "EntryDate", "Description", "AmountFC", "Currency", "Document", "InvoiceNumber", "Supplier"];
const GL_FIELDS = ["ID", "Code", "Description", "Type", "TypeDescription"];
const ENTRY_LINE_FIELDS = ["ID", "EntryID", "EntryNumber", "LineNumber", "JournalCode", "Type", "GLAccount", "InvoiceNumber", "Document"];
const MAX_DOCS = 100;
const BATCH = 10;
/** Pagina's (60 regels) per verzoek van tien sleutels. */
const PAGES = { gl_accounts: 1, documents: 1, attachments: 2, purchase_entries: 1, bank_entry_lines: 4, purchase_entry_lines: 3 };
const MAX_ACCOUNTS_IN_FILTER = 10;
const NIL_GUID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;
const LIMIT_ERRORS = ["rate_limited", "user_rate_limited", "daily_limit_reached"];
const RATE_LIMITED = "rate_limited_evidence_not_checked";
const INCOMPLETE_REASONS = [
  RATE_LIMITED,
  "document_query_budget_exhausted",
  "linked_resource_query_failed_or_truncated",
  "bank_entry_lines_query_failed_or_truncated",
  "purchase_entry_query_failed_or_truncated",
  "purchase_invoice_document_query_failed_or_truncated",
];
const CATEGORIES = ["evidence_present", "evidence_needed", "needs_review"];
const NO_PURCHASE_LINK = "shared_explicit_document_not_payment_matching";

/** TransactionLines.Type volgens de Exact-documentatie: 30 = Purchase entry, 31 = Purchase credit note. */
const PURCHASE_LINE_TYPES = [30, 31];

/**
 * Soort beweging op de tegenrekening. GLAccounts.Type volgens de Exact-documentatie:
 * 10 Cash, 12 Bank, 14 Credit card, 16 Payment services, 22 Accounts payable, 24 VAT,
 * 29 Income taxes payable, 30 Fixed assets, 40 Inventory, 100 Tax payable, 111 Cost of goods,
 * 120 Other costs, 121 Sales, general administrative expenses, 122 Depreciation costs,
 * 123 Research and development, 125 Employee costs, 126 Employment costs, 130 Exceptional costs,
 * 150 Income taxes. Andere typen (bijv. 90 General, 20 Accounts receivable) zeggen te weinig.
 *
 * Volgorde: een type dat de soort vastlegt, dan de naam (privé, betalingsverschil, kruispost
 * en bankkosten hebben geen eigen type), dan een algemeen type, anders unknown.
 */
const MOVEMENT_KINDS = ["expense", "transfer", "private", "payment_difference", "clearing", "bank_fee_or_interest", "tax", "payables_settlement", "unknown"];
const KIND_BY_SPECIFIC_TYPE: Record<number, string> = { 22: "payables_settlement", 24: "tax", 29: "tax", 100: "tax", 150: "tax" };
const KIND_BY_GENERAL_TYPE: Record<number, string> = {
  10: "transfer", 12: "transfer", 14: "transfer", 16: "transfer",
  30: "expense", 40: "expense", 111: "expense", 120: "expense", 121: "expense", 122: "expense", 123: "expense", 125: "expense", 126: "expense", 130: "expense",
};
const KIND_BY_NAME: [RegExp, string, string][] = [
  [/kruispost|clearing|tussenrekening/, "clearing", "transfer_or_clearing_review"],
  [/overboeking|transfer/, "transfer", "transfer_or_clearing_review"],
  [/bankrente|bankkosten|bank fee|bank charge|interest/, "bank_fee_or_interest", "bank_fee_or_interest_review"],
  [/prive|privé|private/, "private", "private_movement_review"],
  [/betalingsverschil|payment difference/, "payment_difference", "payment_difference_review"],
  [/crediteur|creditor|payable/, "payables_settlement", "payables_settlement_linkage_review"],
  [/belasting|\btax(es)?\b|\bbtw\b|\bvat\b/, "tax", "tax_payment_review"],
];

/** Uitkomst van één gebatcht verzoek, per gevraagde sleutel. */
interface Slot {
  ok: boolean;
  items: Row[];
  more: boolean;
  scopeValid: boolean;
  error?: string;
}
interface Run {
  ctx: any;
  /** Gezet na een limietfout: daarna geen verzoeken meer. */
  halted: string | null;
}
/** Tussenstand per bankregel die niet in de uitkomst hoort. */
interface Work {
  row: Row;
  valid: boolean;
  bankDocument?: string;
  invoiceNumber?: string;
  purchaseDocument?: string;
  purchasePathFailed?: boolean;
}

const usable = (s: Slot | undefined): s is Slot => !!s && s.ok && !s.more && s.scopeValid;
const limited = (s: Slot | undefined) => !!s?.error && LIMIT_ERRORS.includes(s.error);
const slotView = (s: Slot) => ({ ok: s.ok, more_available: s.more, scope_valid: s.scopeValid, ...(s.error ? { error: s.error } : {}) });
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const guidLiteral = (v: string) => `guid'${v}'`;
/** Een bruikbare GUID in kleine letters, anders "". */
function guid(value: unknown): string {
  const v = value ? String(value).toLowerCase() : "";
  return GUID.test(v) && !NIL_GUID.test(v) ? v : "";
}

/**
 * Eén resource voor veel sleutels, per tien in een or-filter en met paginering.
 * Elke sleutel krijgt zijn eigen regels; is het verzoek afgekapt of mislukt, dan geldt dat
 * voor alle sleutels van die tien, want welke regels ontbreken is niet te zien.
 */
async function batched(run: Run, resource: string, fields: string[], key: string, values: string[], literal: (v: string) => string, maxPages: number, and?: (part: string[]) => string): Promise<Map<string, Slot>> {
  const out = new Map<string, Slot>();
  for (let i = 0; i < values.length; i += BATCH) {
    const part = values.slice(i, i + BATCH);
    const fail = (error: string) => part.forEach((v) => out.set(v, { ok: false, items: [], more: false, scopeValid: false, error }));
    if (run.halted) {
      fail(run.halted);
      continue;
    }
    try {
      const filter = `(${part.map((v) => `${key} eq ${literal(v)}`).join(" or ")})${and ? and(part) : ""}`;
      const r = await collect(run.ctx, resource, fields, filter, { maxPages });
      const groups = new Map<string, Row[]>(part.map((v) => [v, []]));
      let foreign = false;
      for (const item of r.items) {
        const group = groups.get(String(item[key] ?? "").toLowerCase());
        if (group) group.push(item);
        else foreign = true;
      }
      const more = r.incompleteReason === "row_or_page_cap_reached";
      const scopeValid = !foreign && r.incompleteReason !== "duplicate_rows_between_pages" && r.items.every((item) => typeof item[fields[0]!] === "string" && item[fields[0]!]);
      for (const v of part) out.set(v, { ok: true, items: groups.get(v)!, more, scopeValid });
    } catch (e: any) {
      const code = typeof e?.code === "string" && e.code ? e.code : "source_error";
      if (LIMIT_ERRORS.includes(code)) run.halted = code;
      fail(code);
    }
  }
  return out;
}

function movementKind(type: unknown, name: string): { kind: string; source: string } {
  const t = Number.isInteger(type) ? (type as number) : null;
  if (t !== null && KIND_BY_SPECIFIC_TYPE[t]) return { kind: KIND_BY_SPECIFIC_TYPE[t]!, source: "gl_account_type" };
  const named = KIND_BY_NAME.find(([words]) => words.test(name));
  if (named) return { kind: named[1], source: "gl_account_name" };
  if (t !== null && KIND_BY_GENERAL_TYPE[t]) return { kind: KIND_BY_GENERAL_TYPE[t]!, source: "gl_account_type" };
  return { kind: "unknown", source: "none" };
}

/** Eén document met zijn bijlagen beoordelen; voor beide paden hetzelfde. */
function assess(documents: Slot, attachments: Slot, purchases?: Slot) {
  const slots = [documents, attachments, ...(purchases ? [purchases] : [])];
  const observation = usable(attachments) ? (attachments.items.length ? "present" : "absent") : "unknown";
  let role = "unknown";
  if (documents.ok && documents.scopeValid && documents.items.length === 1) {
    const description = String(documents.items[0]!.TypeDescription ?? "").toLowerCase();
    role = ["bank import", "bank statement", "bankafschrift"].some((w) => description.includes(w)) ? "bank_import_or_statement" : "unvalidated_document";
  }
  let outcome: "rate_limited" | "failed" | "not_found" | "bank_import" | "present" | "needed";
  if (slots.some(limited)) outcome = "rate_limited";
  else if (!slots.every(usable)) outcome = "failed";
  else if (documents.items.length !== 1) outcome = "not_found";
  else if (role === "bank_import_or_statement") outcome = "bank_import";
  else outcome = attachments.items.length ? "present" : "needed";
  return { outcome, observation, role };
}

const BANK_DOCUMENT_REASONS = {
  rate_limited: RATE_LIMITED,
  failed: "linked_resource_query_failed_or_truncated",
  not_found: "linked_document_not_found_or_ambiguous",
  bank_import: "bank_import_or_statement_document_is_not_a_supplier_receipt_link",
  present: "linked_document_attachment_metadata_present_receipt_content_not_validated",
  needed: "linked_document_has_no_attachments_not_proven_missing_receipt",
};
const PURCHASE_DOCUMENT_REASONS = {
  rate_limited: RATE_LIMITED,
  failed: "purchase_invoice_document_query_failed_or_truncated",
  not_found: "purchase_invoice_document_not_found_or_ambiguous",
  bank_import: "purchase_invoice_document_is_bank_import_or_statement",
  present: "purchase_invoice_document_attachment_metadata_present_receipt_content_not_validated",
  needed: "purchase_invoice_document_has_no_attachments_not_proven_missing_receipt",
};

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
  const run: Run = { ctx, halted: null };

  // Soort beweging: het type van de tegenrekening uit GLAccounts, anders de naam
  const glAccounts = await batched(run, "financial/GLAccounts", GL_FIELDS, "ID", unique(scope.map((l) => guid(l.GLAccount))), guidLiteral, PAGES.gl_accounts);
  const glTypesComplete = [...glAccounts.values()].every((s) => usable(s) && s.items.length === 1);

  const work: Work[] = scope.map((line) => {
    const account = glAccounts.get(guid(line.GLAccount));
    const gl = usable(account) && account.items.length === 1 ? account.items[0]! : null;
    const name = String(line.GLAccountDescription ?? gl?.Description ?? "").toLowerCase();
    const movement = movementKind(gl?.Type, name);
    const row: Row = {
      ...line,
      category: "needs_review",
      reasons: [] as string[],
      evidence_path: "none",
      movement_kind: movement.kind,
      movement_kind_source: movement.source,
      gl_account_type: gl?.Type ?? null,
      gl_account_type_description: gl?.TypeDescription ?? null,
      exception_review_hints: unique(KIND_BY_NAME.filter(([words]) => words.test(name)).map(([, , hint]) => hint)),
      attachments: [],
      purchase_entries: [],
      attachment_observation: "unknown",
      document_role: "unknown",
      purchase_link_semantics: NO_PURCHASE_LINK,
      purchase_invoice: null,
    };
    let value: Decimal | null = null;
    try {
      value = new Decimal(String(line.AmountFC));
    } catch {
      value = null;
    }
    const valid = !!value && value.lt(0);
    if (!valid) row.reasons.push("invalid_or_nonnegative_bank_amount");
    return { row, valid };
  });
  const valid = work.filter((w) => w.valid);

  // Pad 1: het document van de bankregel zelf
  const bankDocs: string[] = [];
  for (const w of valid) {
    const doc = guid(w.row.Document);
    if (w.row.Document && !doc) w.row.reasons.push("invalid_explicit_document_id");
    else if (!doc) w.row.reasons.push("no_explicit_document_link_purchase_payment_link_unknown");
    else if (!bankDocs.includes(doc) && bankDocs.length >= MAX_DOCS) w.row.reasons.push("document_query_budget_exhausted");
    else {
      w.bankDocument = doc;
      if (!bankDocs.includes(doc)) bankDocs.push(doc);
    }
  }
  const documents = await batched(run, "documents/Documents", DOC_FIELDS, "ID", bankDocs, guidLiteral, PAGES.documents);
  const attachments = await batched(run, "documents/DocumentAttachments", ATTACHMENT_FIELDS, "Document", bankDocs, guidLiteral, PAGES.attachments);
  const purchases = await batched(run, "purchaseentry/PurchaseEntries", PURCHASE_FIELDS, "Document", bankDocs, guidLiteral, PAGES.purchase_entries);
  for (const { row, bankDocument } of valid) {
    if (!bankDocument) continue;
    const l = { documents: documents.get(bankDocument)!, attachments: attachments.get(bankDocument)!, purchases: purchases.get(bankDocument)! };
    row.document_queries = { documents: slotView(l.documents), attachments: slotView(l.attachments), purchases: slotView(l.purchases) };
    row.documents = l.documents.items;
    row.attachments = l.attachments.items;
    row.purchase_entries = l.purchases.items;
    const a = assess(l.documents, l.attachments, l.purchases);
    row.attachment_observation = a.observation;
    row.document_role = a.role;
    row.reasons.push(BANK_DOCUMENT_REASONS[a.outcome]);
    if (a.outcome === "present" || a.outcome === "needed") {
      row.category = a.outcome === "present" ? "evidence_present" : "evidence_needed";
      row.evidence_path = "bank_line_document";
    }
  }

  // Pad 2: bankboeking → tegenregel met factuurnummer → inkoopboeking → document
  const candidates: Work[] = [];
  for (const w of valid) {
    if (w.row.category === "evidence_present") continue;
    if (guid(w.row.EntryID) && Number.isInteger(w.row.LineNumber) && guid(w.row.GLAccount)) candidates.push(w);
    else w.row.reasons.push("bank_line_lacks_entry_line_number_or_counter_account");
  }
  // Alleen regels op de tegenrekeningen van deze bankregels: een dagafschrift heeft al snel honderden regels
  const onCounterAccounts = (part: string[]) => {
    const accounts = unique(candidates.filter((w) => part.includes(guid(w.row.EntryID))).map((w) => guid(w.row.GLAccount)));
    return accounts.length > MAX_ACCOUNTS_IN_FILTER ? "" : ` and (${accounts.map((a) => `GLAccount eq guid'${a}'`).join(" or ")})`;
  };
  const entryLines = await batched(run, "financialtransaction/TransactionLines", ENTRY_LINE_FIELDS, "EntryID", unique(candidates.map((w) => guid(w.row.EntryID))), guidLiteral, PAGES.bank_entry_lines, onCounterAccounts);
  const withInvoice: Work[] = [];
  for (const w of candidates) {
    const { row } = w;
    const slot = entryLines.get(guid(row.EntryID))!;
    row.purchase_invoice = { queries: { bank_entry_lines: slotView(slot) } };
    if (!usable(slot)) {
      w.purchasePathFailed = true;
      row.reasons.push(limited(slot) ? RATE_LIMITED : "bank_entry_lines_query_failed_or_truncated");
      continue;
    }
    const counterLines = slot.items.filter((l) => l.LineNumber === row.LineNumber && guid(l.GLAccount) === guid(row.GLAccount) && Number.isInteger(l.InvoiceNumber) && l.InvoiceNumber > 0);
    const numbers = unique(counterLines.map((l) => String(l.InvoiceNumber)));
    if (numbers.length !== 1) {
      row.reasons.push(numbers.length ? "multiple_invoice_numbers_on_bank_entry_counter_line" : "no_invoice_number_on_bank_entry_counter_line");
      continue;
    }
    w.invoiceNumber = numbers[0];
    row.purchase_invoice.invoice_number = Number(numbers[0]);
    withInvoice.push(w);
  }

  const purchaseLines = await batched(run, "financialtransaction/TransactionLines", ENTRY_LINE_FIELDS, "EntryNumber", unique(withInvoice.map((w) => w.invoiceNumber!)), (v) => v, PAGES.purchase_entry_lines);
  const withDocument: Work[] = [];
  const purchaseDocs: string[] = [];
  for (const w of withInvoice) {
    const { row } = w;
    const slot = purchaseLines.get(w.invoiceNumber!)!;
    row.purchase_invoice.queries.purchase_entry_lines = slotView(slot);
    if (!usable(slot)) {
      w.purchasePathFailed = true;
      row.reasons.push(limited(slot) ? RATE_LIMITED : "purchase_entry_query_failed_or_truncated");
      continue;
    }
    const lines = slot.items.filter((l) => PURCHASE_LINE_TYPES.includes(l.Type));
    const entries = unique(lines.map((l) => String(l.EntryID ?? "").toLowerCase()));
    if (entries.length !== 1) {
      row.reasons.push(entries.length ? "multiple_purchase_entries_for_invoice_number" : "no_purchase_entry_found_for_invoice_number");
      continue;
    }
    row.purchase_invoice.purchase_entry = { EntryID: lines[0]!.EntryID, EntryNumber: lines[0]!.EntryNumber, JournalCode: lines[0]!.JournalCode, Type: lines[0]!.Type };
    const docs = unique(lines.map((l) => guid(l.Document)));
    if (docs.length !== 1) {
      row.reasons.push(docs.length ? "multiple_documents_on_purchase_entry" : "purchase_entry_has_no_document");
      continue;
    }
    const doc = docs[0]!;
    row.purchase_link_semantics = "explicit_invoice_number_on_bank_entry_counter_line_to_single_purchase_entry";
    row.purchase_invoice.document_id = doc;
    if (!purchaseDocs.includes(doc) && purchaseDocs.length >= MAX_DOCS) {
      w.purchasePathFailed = true;
      row.reasons.push("document_query_budget_exhausted");
      continue;
    }
    if (!purchaseDocs.includes(doc)) purchaseDocs.push(doc);
    w.purchaseDocument = doc;
    withDocument.push(w);
  }

  // Een inkoopdocument dat ook al aan een bankregel hing, is in pad 1 al opgehaald
  const fresh = purchaseDocs.filter((d) => !documents.has(d));
  const purchaseDocuments = await batched(run, "documents/Documents", DOC_FIELDS, "ID", fresh, guidLiteral, PAGES.documents);
  const purchaseAttachments = await batched(run, "documents/DocumentAttachments", ATTACHMENT_FIELDS, "Document", fresh, guidLiteral, PAGES.attachments);
  for (const w of withDocument) {
    const { row } = w;
    const doc = w.purchaseDocument!;
    const d = documents.get(doc) ?? purchaseDocuments.get(doc)!;
    const at = attachments.get(doc) ?? purchaseAttachments.get(doc)!;
    const a = assess(d, at);
    Object.assign(row.purchase_invoice.queries, { documents: slotView(d), attachments: slotView(at) });
    Object.assign(row.purchase_invoice, { documents: d.items, attachments: at.items, attachment_observation: a.observation, document_role: a.role });
    row.reasons.push(PURCHASE_DOCUMENT_REASONS[a.outcome]);
    if (a.outcome === "present" || a.outcome === "needed") {
      row.category = a.outcome === "present" ? "evidence_present" : "evidence_needed";
      row.evidence_path = "purchase_invoice_document";
    } else if (a.outcome === "rate_limited" || a.outcome === "failed") w.purchasePathFailed = true;
  }

  for (const w of work) {
    // Een afgebroken controle is geen "document zonder bijlage"
    if (w.purchasePathFailed && w.row.category !== "evidence_present") {
      w.row.category = "needs_review";
      w.row.evidence_path = "none";
    }
    w.row.reasons = unique(w.row.reasons);
  }
  const rows = work.map((w) => w.row);

  const count = (c: string) => rows.filter((r) => r.category === c).length;
  const having = (reason: string) => rows.filter((r) => r.reasons.includes(reason)).length;
  const incomplete = rows.filter((r) => INCOMPLETE_REASONS.some((reason) => r.reasons.includes(reason))).length;
  return {
    // Na een limietfout ook de naam van de administratie niet meer opvragen
    division: run.halted ? { code: Number(ctx.vars.DIVISION), name: null, currency: null } : await divisionInfo(ctx),
    period: { start_inclusive: args.start_date, end_exclusive: args.end_date },
    snapshot_at: ctx.now,
    bank_scope: { complete: !truncated && !duplicates, truncated, duplicate_ids: duplicates, returned: rows.length, max_bank_lines: max },
    evidence_queries_complete: incomplete === 0,
    query_failures: { stopped_after_limit_error: run.halted, rate_limited_rows: having(RATE_LIMITED), other_failed_or_truncated_rows: incomplete - having(RATE_LIMITED) },
    counts: Object.fromEntries(CATEGORIES.map((c) => [c, count(c)])),
    evidence_paths: Object.fromEntries(["bank_line_document", "purchase_invoice_document", "none"].map((p) => [p, rows.filter((r) => r.evidence_path === p).length])),
    movement_kinds: Object.fromEntries(MOVEMENT_KINDS.map((kind) => {
      const of = rows.filter((r) => r.movement_kind === kind);
      return [kind, { rows: of.length, ...Object.fromEntries(CATEGORIES.map((c) => [c, of.filter((r) => r.category === c).length])) }];
    })),
    movement_kind_gl_types_complete: glTypesComplete,
    confirmed_missing_receipts: 0,
    receipt_validity_verified: false,
    purchase_payment_linkage_verified: false,
    purchase_payment_linkage: {
      basis: "invoice_number_on_bank_entry_counter_line_equals_entry_number_of_exactly_one_purchase_entry",
      rows_with_explicit_purchase_link: rows.filter((r) => r.purchase_link_semantics !== NO_PURCHASE_LINK).length,
      amounts_and_settlement_status_verified: false,
    },
    attachment_observations: { present: rows.filter((r) => r.attachment_observation === "present").length, absent: rows.filter((r) => r.attachment_observation === "absent").length, unknown: rows.filter((r) => r.attachment_observation === "unknown").length },
    linkage_complete: !truncated && !duplicates && count("needs_review") === 0,
    query_budget: { documents_followed: bankDocs.length, purchase_documents_followed: purchaseDocs.length, max_document_ids: MAX_DOCS, ids_per_request: BATCH, max_pages_per_request: PAGES },
    rows,
    limitations: [
      "Negative AmountFC bank line components are outflow candidates, not distinct expense payments.",
      "Attachment metadata is not proof of a valid supplier receipt; document bodies are not inspected.",
      "evidence_path says where the document came from: bank_line_document is the bank line's own Document; purchase_invoice_document follows the invoice number on the bank entry's counter line to exactly one purchase entry (TransactionLines Type 30 or 31 with that EntryNumber) and its Document.",
      "The purchase path shows which invoice the payment was booked against. Amounts, partial payments and matching status are not checked, so purchase_payment_linkage_verified stays false; use get_matching_details for that.",
      "No matching on amount, date, description, OffsetID or OurRef. Without an invoice number, or without exactly one purchase entry and document, the row keeps its category and gets a reason.",
      "attachment_observation, document_role and purchase_entries describe the bank line's own document; purchase_invoice has its own. A shared Document identifies related purchase metadata, not a settlement.",
      "movement_kind comes from the counter account: its Exact G/L account type, else words in its name (see movement_kind_source). It is a label for review, not a ruling; clearing accounts go through the same evidence check as every other row.",
      "A row with rate_limited_evidence_not_checked was not checked because the Exact rate limit was reached; it says nothing about missing evidence. Run again later or for a shorter period.",
      "Requests cover ten keys each; a truncated or failed request counts for all ten, so those rows are needs_review unless the other path found a document with attachment.",
      "Sequential API reads are not a transactionally consistent Exact snapshot.",
    ],
  };
}
