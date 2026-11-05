/**
 * Mededeling (#194, eerder in de kern als #80).
 *
 * Een beheerder zet een korte tekst bovenaan elke pagina (plek banner, haakje F), eventueel per
 * taal, met een einddatum en een doelgroep: iedereen, of alleen bepaalde rollen. Iedereen kan hem
 * wegklikken (als de beheerder dat toestaat); een nieuwe versie verschijnt dan weer.
 *
 * De kern tekent het blok met zijn veilige markdown-omzetter: geen HTML van de plugin op de pagina.
 */
import { randomBytes } from "node:crypto";
import type { PluginApi, SlotContent } from "@tailr/plugin";

type Tone = "info" | "success" | "warning";
const TONES: Tone[] = ["info", "success", "warning"];
const MAX_TEXT = 2_000;
const MAX_ROLES = 50;

export interface Announcement {
  /** Markdown; Nederlands verplicht, Engels optioneel (anders ziet iedereen het Nederlands) */
  text: { nl: string; en?: string };
  /** Laatste dag waarop hij te zien is (JJJJ-MM-DD, tijdzone van de server), of null: geen einde */
  until: string | null;
  /** Rollen die hem zien; leeg = iedereen */
  roles: string[];
  tone: Tone;
  /** Mag iemand hem wegklikken */
  dismissible: boolean;
  /** Elke opslag een nieuwe versie: wie de vorige wegklikte, ziet de nieuwe weer */
  version: string;
  at: string;
  by: string;
}

const TEXTS_EN: Record<string, string> = {
  "Mededeling": "Announcement",
  "Een korte mededeling bovenaan elke pagina, voor iedereen of voor bepaalde rollen.": "A short announcement at the top of every page, for everyone or for certain roles.",
  "Laden…": "Loading…",
  "Tekst (Nederlands)": "Text (Dutch)",
  "Tekst (Engels, optioneel)": "Text (English, optional)",
  "Leeg: wie Engels gebruikt, ziet de Nederlandse tekst.": "Empty: people who use English see the Dutch text.",
  "Markdown: **vet**, *cursief*, [tekst](https://…) en lijsten. HTML wordt niet uitgevoerd.": "Markdown: **bold**, *italic*, [text](https://…) and lists. HTML is not executed.",
  "Einddatum": "End date",
  "Tot en met deze dag. Leeg: tot je hem weghaalt.": "Up to and including this day. Empty: until you remove it.",
  "Voor wie": "For whom",
  "Iedereen": "Everyone",
  "Alleen deze rollen": "Only these roles",
  "Nog geen rollen.": "No roles yet.",
  "Kleur": "Colour",
  "Informatie": "Information",
  "Goed nieuws": "Good news",
  "Waarschuwing": "Warning",
  "Wegklikken toestaan": "Allow dismissing",
  "Iemand die hem wegklikt, ziet hem pas weer als je de mededeling opnieuw opslaat.": "Someone who dismisses it only sees it again when you save the announcement again.",
  "Voorbeeld": "Preview",
  "Opslaan": "Save",
  "Weghalen": "Remove",
  "Opgeslagen": "Saved",
  "Mededeling weggehaald": "Announcement removed",
  "De mededeling weghalen? Niemand ziet hem dan nog.": "Remove the announcement? Nobody will see it anymore.",
  "Kies minstens één rol, of kies Iedereen.": "Choose at least one role, or choose Everyone.",
  "Er staat nu geen mededeling.": "There is no announcement right now.",
  "Te zien voor iedereen.": "Visible to everyone.",
  "Te zien voor {n} rol(len).": "Visible to {n} role(s).",
  "Tot en met {date}.": "Up to and including {date}.",
  "Verlopen op {date}: niemand ziet hem nog.": "Expired on {date}: nobody sees it anymore.",
  "{n} keer weggeklikt.": "Dismissed {n} times.",
  "Bericht van {name}, {date}": "Message from {name}, {date}",
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** Een echte dag als JJJJ-MM-DD (dus geen 31 februari). */
const isDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const day = (iso: string, locale: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", { day: "numeric", month: "long", year: "numeric" });

export function register(api: PluginApi) {
  api.migrate([
    `CREATE TABLE tp_mededeling_dismissed (
      user_id TEXT NOT NULL,
      version TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (user_id, version)
    )`,
  ]);

  const current = () => api.settings.get<Announcement>("announcement") ?? null;
  const expired = (m: Announcement) => Boolean(m.until && today() > m.until);
  const dismissedCount = (m: Announcement) => api.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tp_mededeling_dismissed WHERE version = ?", m.version)?.n ?? 0;

  /** Wat een beheerder opslaat: gecontroleerd en schoongemaakt, of een fout in het Engels. */
  function parse(body: Record<string, unknown>, by: string): Announcement | string {
    const raw = body.text;
    const nl = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as Record<string, unknown>).nl : undefined;
    const en = raw && typeof raw === "object" ? (raw as Record<string, unknown>).en : undefined;
    if (typeof nl !== "string" || !nl.trim()) return "text.nl is required: the announcement in Dutch (markdown).";
    if (en !== undefined && en !== null && typeof en !== "string") return "text.en must be a text.";
    if (nl.length > MAX_TEXT || (typeof en === "string" && en.length > MAX_TEXT)) return `The text is too long (max ${MAX_TEXT} characters per language).`;
    const until = body.until === undefined || body.until === null || body.until === "" ? null : body.until;
    if (until !== null && (typeof until !== "string" || !isDate(until))) return "until must be a date as YYYY-MM-DD, or empty.";
    const roles = body.roles === undefined ? [] : body.roles;
    if (!Array.isArray(roles) || roles.length > MAX_ROLES || roles.some((r) => typeof r !== "string" || !r || r.length > 100)) return `roles must be a list of role ids (at most ${MAX_ROLES}); empty is everyone.`;
    const tone = body.tone === undefined ? "info" : body.tone;
    if (!TONES.includes(tone as Tone)) return "tone must be info, success or warning.";
    return {
      text: { nl: nl.trim(), ...(typeof en === "string" && en.trim() ? { en: en.trim() } : {}) },
      until: until as string | null,
      roles: [...new Set(roles as string[])],
      tone: tone as Tone,
      dismissible: body.dismissible === undefined ? true : Boolean(body.dismissible),
      version: randomBytes(6).toString("hex"),
      at: new Date().toISOString(),
      by,
    };
  }

  /** Het blok voor de banner: de tekst met wie hem schreef, wegklikken en (voor beheerders) aanpassen. */
  function block(m: Announcement, opts: { isAdmin: boolean; dismiss: boolean }): SlotContent {
    const footer = (l: "nl" | "en") => (l === "nl" ? `_Bericht van ${m.by}, ${day(m.at, "nl")}_` : `_Message from ${m.by}, ${day(m.at, "en")}_`);
    return {
      id: "announcement",
      tone: m.tone,
      text: { nl: `${m.text.nl}\n\n${footer("nl")}`, ...(m.text.en ? { en: `${m.text.en}\n\n${footer("en")}` } : {}) },
      actions: [
        ...(opts.dismiss ? [{ id: "dismiss", label: { nl: "Sluiten", en: "Dismiss" }, post: "dismiss" }] : []),
        ...(opts.isAdmin ? [{ id: "edit", label: { nl: "Aanpassen", en: "Edit" }, href: "/p/mededeling" }] : []),
      ],
    };
  }

  api.slots.register("banner", (user) => {
    const m = current();
    if (!m || expired(m)) return null;
    if (m.roles.length && !m.roles.some((r) => user.roleIds.includes(r))) return null;
    if (m.dismissible && api.db.get("SELECT 1 FROM tp_mededeling_dismissed WHERE user_id = ? AND version = ?", user.id, m.version)) return null;
    return block(m, { isAdmin: user.isAdmin, dismiss: m.dismissible });
  });

  api.routes((r) => {
    // Wegklikken: alleen deze versie, alleen voor deze gebruiker
    r.post("/dismiss", (c) => {
      const p = c.get("principal");
      if (p.type !== "user") return c.json({ error: "Only users can dismiss the announcement." }, 403);
      const m = current();
      if (!m) return c.json({ ok: true });
      if (!m.dismissible) return c.json({ error: "This announcement cannot be dismissed." }, 409);
      api.db.run("INSERT OR IGNORE INTO tp_mededeling_dismissed (user_id, version, at) VALUES (?, ?, ?)", p.id, m.version, new Date().toISOString());
      return c.json({ ok: true });
    });

    // Voorbeeld in het beheerscherm: dezelfde omzetter als de banner. Een gewone route, zodat niet
    // elke toetsaanslag in het auditlog komt; alleen voor beheerders.
    r.post("/preview", async (c) => {
      if (!c.get("principal").isAdmin) return c.json({ error: "Only administrators can preview the announcement." }, 403);
      const body = ((await c.req.json().catch(() => null)) ?? {}) as { text?: unknown };
      if (typeof body.text !== "string" || body.text.length > MAX_TEXT) return c.json({ error: `text is required (max ${MAX_TEXT} characters)` }, 400);
      return c.json({ html: api.markdown.render(body.text) });
    });
  });

  api.adminRoutes((r) => {
    r.get("/settings", (c) => {
      const m = current();
      return c.json({ announcement: m, expired: m ? expired(m) : false, dismissed: m ? dismissedCount(m) : 0, today: today() });
    });
    r.put("/settings", async (c) => {
      const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
      const m = parse(body, c.get("principal").name);
      if (typeof m === "string") return c.json({ error: m }, 400);
      api.settings.set("announcement", m);
      // Oude wegklikken horen bij een vorige versie: die tellen niet meer
      api.db.run("DELETE FROM tp_mededeling_dismissed WHERE version <> ?", m.version);
      api.log.info(`${c.get("principal").name} zette een mededeling${m.roles.length ? ` voor ${m.roles.length} rol(len)` : " voor iedereen"}${m.until ? ` tot en met ${m.until}` : ""}`);
      return c.json({ announcement: m, expired: expired(m), dismissed: 0, today: today() });
    });
    r.delete("/settings", (c) => {
      api.settings.remove("announcement");
      api.db.run("DELETE FROM tp_mededeling_dismissed");
      api.log.info(`${c.get("principal").name} haalde de mededeling weg`);
      return c.json({ ok: true });
    });
  });

  api.texts("en", TEXTS_EN);
  api.nav({ label: { nl: "Mededeling", en: "Announcement" }, path: "", adminOnly: true });
}
