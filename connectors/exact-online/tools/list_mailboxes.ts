import { collect, divisionInfo, divisionOf, GUID } from "./lib/exact";

/**
 * Mailboxen van Exact voor deze administratie, om de scanmailbox voor upload_receipt te vinden.
 * Alleen lezen. Mailboxadressen zijn adressen van Exact (bijv. ...@exactonline.nl), geen gegevens van klanten.
 */
const FIELDS = ["ID", "Mailbox", "ForDivision", "Type", "Publish", "ValidFrom", "ValidTo"];
const TYPES: Record<number, string> = { 0: "unknown", 1: "exact", 2: "government", 3: "manual_input" };

export default async function listMailboxes(_args: Record<string, never>, ctx: any) {
  const division = divisionOf(ctx);
  const r = await collect(ctx, "mailbox/Mailboxes", FIELDS, `ForDivision eq ${division}`, { maxRows: 50, maxPages: 2 });
  const mailboxes = r.items.map((m) => ({
    id: typeof m.ID === "string" && GUID.test(m.ID.toLowerCase()) ? m.ID.toLowerCase() : null,
    mailbox: typeof m.Mailbox === "string" ? m.Mailbox : null,
    for_division: m.ForDivision ?? null,
    type: m.Type ?? null,
    type_label: typeof m.Type === "number" ? (TYPES[m.Type] ?? "unknown") : null,
    publish: m.Publish ?? null,
  }));
  return {
    division: await divisionInfo(ctx),
    mailboxes,
    count: mailboxes.length,
    complete: r.complete,
    limitations: [
      "Only mailboxes with ForDivision = this administration. The scan mailbox for purchase invoices is usually one of these; upload_receipt uses it when there is exactly one, otherwise pass recipient_mailbox_id.",
      "The Exact API does not mark which mailbox is the scan mailbox; that is read from the address or tried with upload_receipt.",
    ],
  };
}
