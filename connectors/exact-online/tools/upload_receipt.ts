import { collect, divisionInfo, divisionOf, documentUrl, GUID } from "./lib/exact";

/**
 * Een bon (pdf, jpg, png) naar Exact sturen. Alleen via de API (audience "api"): het bestand gaat nooit via de chat.
 *
 * Routes:
 * - "scan" (standaard): een bericht naar de scanmailbox van de administratie (mailbox/MailMessagesSent,
 *   Operation 1 = inkoopfactuur zonder details) met het bestand als bijlage, zodat de scanservice van Exact
 *   het uitleest zoals een gemailde bon. Daarna zichtbaar in check_uploads.
 * - "document": een document (documents/Documents) met het bestand als bijlage, zonder herkenning.
 *
 * Het bestand wordt alleen op soort (magische bytes) en grootte gecontroleerd en ongewijzigd doorgestuurd.
 */
const MAX_BYTES = 1_400_000; // ctx.request mag hoogstens 2 MB zijn; base64 is ~4/3 groter
const KINDS: { ext: RegExp; prefix: string; label: string; attachmentType: number | null }[] = [
  { ext: /\.pdf$/i, prefix: "JVBERi0", label: "pdf", attachmentType: 10 },
  { ext: /\.jpe?g$/i, prefix: "/9j/", label: "jpg", attachmentType: null },
  { ext: /\.png$/i, prefix: "iVBORw0KGgo", label: "png", attachmentType: null },
];
const SCAN_OPERATION_PURCHASE_INVOICE = 1;
const MAIL_TYPE_PURCHASE_INVOICE = 1000;
const DEFAULT_DOCUMENT_TYPE = 20;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

function guidArg(ctx: any, name: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const g = String(value).toLowerCase();
  if (!GUID.test(g)) ctx.fail("invalid_input", `${name} must be a GUID (see list_mailboxes)`);
  return g;
}

function createdId(res: any): string | null {
  const id = res?.data?.d?.ID ?? res?.data?.ID;
  return typeof id === "string" && GUID.test(id.toLowerCase()) ? id.toLowerCase() : null;
}

export default async function uploadReceipt(
  args: { file_base64: string; file_name: string; note?: string; subject?: string; route?: string; recipient_mailbox_id?: string; sender_mailbox_id?: string; document_type?: number },
  ctx: any,
) {
  // 1. Invoer
  const fileName = typeof args.file_name === "string" ? args.file_name.trim() : "";
  if (!fileName || fileName.length > 120 || /[\u0000-\u001f\u007f\\/]/.test(fileName)) ctx.fail("invalid_input", "file_name must be 1–120 characters, without slashes or control characters, e.g. bon-hornbach.pdf");
  const kind = KINDS.find((k) => k.ext.test(fileName));
  if (!kind) ctx.fail("invalid_input", "file_name must end in .pdf, .jpg, .jpeg or .png");
  const data = typeof args.file_base64 === "string" ? args.file_base64.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "") : "";
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) ctx.fail("invalid_input", "file_base64 must be the file as standard base64");
  const bytes = (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
  if (bytes > MAX_BYTES) ctx.fail("invalid_input", `The file is ${Math.round(bytes / 1000)} kB; at most ${MAX_BYTES / 1000} kB. Make a photo smaller first (e.g. jpg, 1600 px).`);
  if (bytes < 100) ctx.fail("invalid_input", "The file is too small to be a receipt");
  if (!data.startsWith(kind!.prefix)) ctx.fail("invalid_input", `The file content is not a ${kind!.label}, although the name ends in .${kind!.label}`);
  const note = args.note === undefined || args.note === null ? "" : String(args.note).replace(/\r\n?/g, "\n").trim();
  if (note.length > 500 || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(note)) ctx.fail("invalid_input", "note must be at most 500 characters, without control characters");
  const subject = (args.subject === undefined || args.subject === null || args.subject === "" ? `Tailr: ${fileName}` : String(args.subject).trim());
  if (subject.length < 2 || subject.length > 200 || /[\u0000-\u001f\u007f]/.test(subject)) ctx.fail("invalid_input", "subject must be 2–200 characters without control characters");
  const route = args.route ?? "scan";
  if (route !== "scan" && route !== "document") ctx.fail("invalid_input", 'route must be "scan" or "document"');
  const division = divisionOf(ctx);

  // 2a. Via de scanmailbox
  if (route === "scan") {
    let recipient = guidArg(ctx, "recipient_mailbox_id", args.recipient_mailbox_id);
    if (!recipient) {
      const r = await collect(ctx, "mailbox/Mailboxes", ["ID", "Mailbox"], `ForDivision eq ${division}`, { maxRows: 20, maxPages: 1 });
      const ids = r.items.map((m) => String(m.ID ?? "").toLowerCase()).filter((id) => GUID.test(id));
      if (ids.length !== 1) ctx.fail("invalid_input", `Found ${ids.length} mailboxes for this administration; pass recipient_mailbox_id (see list_mailboxes), or use route "document"`);
      recipient = ids[0]!;
    }
    const sender = guidArg(ctx, "sender_mailbox_id", args.sender_mailbox_id) ?? recipient;
    const message = await ctx.request({
      method: "POST",
      path: `/${division}/mailbox/MailMessagesSent`,
      body: { Subject: subject, RecipientMailboxID: recipient, SenderMailboxID: sender, Type: MAIL_TYPE_PURCHASE_INVOICE, Operation: SCAN_OPERATION_PURCHASE_INVOICE, ...(note ? { Body: note } : {}) },
    });
    const messageId = createdId(message);
    if (!messageId) ctx.fail("source_error", "Exact did not return the ID of the mail message; check the Exact mailbox before trying again");
    await ctx.request({
      method: "POST",
      path: `/${division}/mailbox/MailMessageAttachments`,
      body: { MailMessageID: messageId, AttachmentFileName: fileName, Attachment: data, ...(kind!.attachmentType !== null ? { Type: kind!.attachmentType } : {}) },
    });
    return {
      division: await divisionInfo(ctx),
      route,
      file: { file_name: fileName, kind: kind!.label, bytes },
      mail_message_id: messageId,
      recipient_mailbox_id: recipient,
      next_step: `Exact's scan service processes the mail; after a few minutes check_uploads with expected [{"text": "${fileName.replace(/"/g, "")}"}] shows whether it arrived and was recognised. Then add_document_note can add the note to the recognised invoice.`,
      limitations: [
        "Sent to the scan mailbox; whether and when Exact recognises it is not known at this point. A file that is not recognised shows as scan_only_not_recognized in check_uploads.",
        "Do not send the same file again before checking check_uploads: that creates a duplicate upload.",
      ],
    };
  }

  // 2b. Als document met bijlage
  const docType = args.document_type ?? DEFAULT_DOCUMENT_TYPE;
  if (!Number.isInteger(docType) || docType < 1 || docType > 99999) ctx.fail("invalid_input", "document_type must be a document type number");
  const doc = await ctx.request({
    method: "POST",
    path: `/${division}/documents/Documents`,
    body: { Subject: subject, Type: docType, ...(note ? { Body: escapeHtml(`[${ctx.today ?? String(ctx.now ?? "").slice(0, 10)} Tailr] ${note}`) } : {}) },
  });
  const documentId = createdId(doc);
  if (!documentId) ctx.fail("source_error", "Exact did not return the ID of the document; check Exact before trying again");
  await ctx.request({
    method: "POST",
    path: `/${division}/documents/DocumentAttachments`,
    body: { Document: documentId, FileName: fileName, Attachment: data },
  });
  return {
    division: await divisionInfo(ctx),
    route,
    file: { file_name: fileName, kind: kind!.label, bytes },
    document_id: documentId,
    document_type: docType,
    exact_url: documentUrl(ctx, documentId),
    next_step: "The document is in Exact without recognition: process it by hand in Exact (exact_url).",
    limitations: ["route document does not use Exact's scan service; supplier, amount and date are not read."],
  };
}
