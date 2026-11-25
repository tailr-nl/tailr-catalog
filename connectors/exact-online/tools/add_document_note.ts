import { collect, divisionInfo, divisionOf, documentUrl, GUID, type Row } from "./lib/exact";

/**
 * Een opmerking van de gebruiker bij een document in Exact zetten (tekstveld Body).
 *
 * - Voegt toe achter wat er al staat, met datum en "Tailr" ervoor; bestaande tekst blijft staan.
 * - Leest het document eerst (bestaat het, wat staat er al) en daarna nog eens ter controle.
 * - Eén PUT met alleen Body; verder verandert er niets aan het document.
 */
const FIELDS = ["ID", "HID", "Subject", "Type", "TypeDescription", "Body"];
const NOTE_MAX = 500;
const BODY_LIMIT = 4000;
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

function preview(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

async function findDocument(ctx: any, args: { document_id?: string; document_number?: number }): Promise<Row> {
  let filter: string;
  if (args.document_id !== undefined && args.document_id !== null && args.document_id !== "") {
    const id = String(args.document_id).toLowerCase();
    if (!GUID.test(id) || id === ZERO_GUID) ctx.fail("invalid_input", "document_id must be the GUID of a document (see list_documents or check_uploads)");
    filter = `ID eq guid'${id}'`;
  } else {
    const n = args.document_number;
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 999_999_999) ctx.fail("invalid_input", "Give document_id or document_number (the document number in Exact, a whole number)");
    filter = `HID eq ${n}`;
  }
  const r = await collect(ctx, "documents/Documents", FIELDS, filter, { maxRows: 5, maxPages: 1 });
  if (r.items.length === 0) ctx.fail("not_found", "No document found with that id or number in this administration");
  if (r.items.length > 1) ctx.fail("invalid_input", "More than one document has that number; use document_id");
  return r.items[0]!;
}

export default async function addDocumentNote(args: { document_id?: string; document_number?: number; note: string }, ctx: any) {
  const note = typeof args.note === "string" ? args.note.replace(/\r\n?/g, "\n").trim() : "";
  if (note.length < 2 || note.length > NOTE_MAX) ctx.fail("invalid_input", `note must be 2–${NOTE_MAX} characters`);
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(note)) ctx.fail("invalid_input", "note must not contain control characters (line breaks are fine)");
  if (/<[a-z!/][^>]*>/i.test(note)) ctx.fail("invalid_input", "note must be plain text, without HTML tags");

  const doc = await findDocument(ctx, args);
  const id = String(doc.ID).toLowerCase();
  const before = typeof doc.Body === "string" ? doc.Body : "";
  const line = `[${ctx.today ?? String(ctx.now ?? "").slice(0, 10)} Tailr] ${note}`;
  // Exact toont Body als HTML: tekens escapen en regels met <br> scheiden, anders komt alles op één regel
  const html = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  // Een veld met alleen lege HTML (bijv. na wissen in Exact) telt als leeg
  const hasText = preview(before) !== null;
  const body = hasText ? `${before.replace(/(\s|<br\s*\/?>|&nbsp;)+$/gi, "")}<br><br>${html}` : html;
  if (body.length > BODY_LIMIT) ctx.fail("invalid_input", `The document text would become longer than ${BODY_LIMIT} characters; use a shorter note`);

  await ctx.request({ method: "PUT", path: `/${divisionOf(ctx)}/documents/Documents(guid'${id}')`, body: { Body: body } });

  // Ter controle opnieuw lezen
  let verified: boolean | null = null;
  let after: string | null = null;
  try {
    const r = await collect(ctx, "documents/Documents", FIELDS, `ID eq guid'${id}'`, { maxRows: 1, maxPages: 1 });
    after = typeof r.items[0]?.Body === "string" ? r.items[0]!.Body : null;
    verified = after !== null && after.includes(html);
  } catch {
    verified = null;
  }

  return {
    division: await divisionInfo(ctx),
    document: {
      id,
      number: doc.HID ?? null,
      subject: typeof doc.Subject === "string" ? doc.Subject : null,
      type: doc.Type ?? null,
      type_description: doc.TypeDescription ?? null,
      exact_url: documentUrl(ctx, id),
    },
    added: line,
    previous_text: preview(before),
    replaced_empty_markup: !hasText && before.length > 0,
    text_now: preview(after),
    verified,
    limitations: [
      "The note is added to the document's text field (Body) in Exact, after any existing text; nothing else on the document changes.",
      "verified = true: the note was read back from Exact. null: the read-back failed; check the document in Exact (exact_url) before adding it again.",
      "For an upload, add the note to the recognised purchase invoice (type 20) that the bookkeeper processes, not only to the raw scan (type 202); see check_uploads.",
    ],
  };
}
