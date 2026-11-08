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

/** De mededeling zoals de banner hem gebruikt, samengesteld uit de velden van de instellingenpagina. */
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
  /** Elke wijziging een nieuwe versie: wie de vorige wegklikte, ziet de nieuwe weer */
  version: string;
  at: string;
  by: string;
}

/** Wie de mededeling het laatst wijzigde, en de versie voor het wegklikken (sleutel "meta"). */
interface Meta {
  version: string;
  at: string;
  by: string;
}

const TEXTS_EN: Record<string, string> = {
  "Mededeling": "Announcement",
  "Een korte mededeling bovenaan elke pagina, voor iedereen of voor bepaalde rollen.": "A short announcement at the top of every page, for everyone or for certain roles.",
  "Laden…": "Loading…",
  "Aanpassen": "Edit",
  "Voorbeeld": "Preview",
  "Er staat nu geen mededeling.": "There is no announcement right now.",
  "Te zien voor iedereen.": "Visible to everyone.",
  "Te zien voor {n} rol(len).": "Visible to {n} role(s).",
  "Tot en met {date}.": "Up to and including {date}.",
  "Verlopen op {date}: niemand ziet hem nog.": "Expired on {date}: nobody sees it anymore.",
  "De einddatum {date} klopt niet: niemand ziet de mededeling. Gebruik JJJJ-MM-DD, bijv. 2026-12-31.": "The end date {date} is not valid: nobody sees the announcement. Use YYYY-MM-DD, e.g. 2026-12-31.",
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
/** De einddatum als JJJJ-MM-DD; ook DD-MM-JJJJ (zoals je hem in het Nederlands typt). Leeg: null; ongeldig: undefined. */
const normaliseDate = (raw: unknown): string | null | undefined => {
  if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return null;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : s;
  return isDate(iso) ? iso : undefined;
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

  // Van 1.1.x: het object "announcement" eenmalig naar de losse sleutels (als die nog leeg zijn)
  // en "meta". Vóór define, want daarna geeft get voor een leeg veld de standaard.
  const legacy = api.settings.get<Announcement>("announcement");
  if (legacy && typeof legacy === "object") {
    const values: Record<string, unknown> = {
      textNl: typeof legacy.text?.nl === "string" ? legacy.text.nl : undefined,
      textEn: typeof legacy.text?.en === "string" ? legacy.text.en : undefined,
      until: typeof legacy.until === "string" ? legacy.until : undefined,
      roles: Array.isArray(legacy.roles) ? legacy.roles.filter((r) => typeof r === "string") : undefined,
      tone: TONES.includes(legacy.tone) ? legacy.tone : undefined,
      dismissible: typeof legacy.dismissible === "boolean" ? legacy.dismissible : undefined,
    };
    const moved = Object.keys(values).filter((key) => values[key] !== undefined && api.settings.get(key) === undefined);
    for (const key of moved) api.settings.set(key, values[key]);
    if (!api.settings.get("meta") && legacy.version) api.settings.set("meta", { version: legacy.version, at: legacy.at, by: legacy.by } satisfies Meta);
    api.settings.remove("announcement");
    api.log.info(`mededeling overgezet naar de instellingenpagina van de kern: ${moved.join(", ") || "niets"}`);
  }

  api.settings.define({
    fields: [
      {
        name: "textNl",
        type: "markdown",
        label: { en: "Text (Dutch)", nl: "Tekst (Nederlands)" },
        description: { en: "Markdown: **bold**, *italic*, [text](https://…) and lists. HTML is not executed. Empty: no announcement.", nl: "Markdown: **vet**, *cursief*, [tekst](https://…) en lijsten. HTML wordt niet uitgevoerd. Leeg: geen mededeling." },
        maxLength: MAX_TEXT,
      },
      {
        name: "textEn",
        type: "markdown",
        label: { en: "Text (English)", nl: "Tekst (Engels)" },
        description: { en: "Empty: people who use English see the Dutch text.", nl: "Leeg: wie Engels gebruikt, ziet de Nederlandse tekst." },
        maxLength: MAX_TEXT,
      },
      {
        name: "until",
        type: "text",
        label: { en: "End date", nl: "Einddatum" },
        description: { en: "Up to and including this day, as YYYY-MM-DD (or DD-MM-YYYY). Empty: until you remove the text.", nl: "Tot en met deze dag, als JJJJ-MM-DD (of DD-MM-JJJJ). Leeg: tot je de tekst weghaalt." },
        placeholder: "2026-12-31",
        maxLength: 10,
      },
      {
        name: "roles",
        type: "roles",
        label: { en: "For whom", nl: "Voor wie" },
        description: { en: "No selection: everyone.", nl: "Niets aangevinkt: iedereen." },
      },
      {
        name: "tone",
        type: "select",
        label: { en: "Colour", nl: "Kleur" },
        options: [
          { value: "info", label: { en: "Information", nl: "Informatie" } },
          { value: "success", label: { en: "Good news", nl: "Goed nieuws" } },
          { value: "warning", label: { en: "Warning", nl: "Waarschuwing" } },
        ],
        default: "info",
      },
      {
        name: "dismissible",
        type: "boolean",
        label: { en: "Allow dismissing", nl: "Wegklikken toestaan" },
        description: { en: "Someone who dismisses it only sees it again when you change the announcement.", nl: "Iemand die hem wegklikt, ziet hem pas weer als je de mededeling wijzigt." },
        default: true,
      },
    ],
    // Elke wijziging is een nieuwe versie: wie de vorige wegklikte, ziet hem weer; oude wegklikken vervallen
    onChange: (values, changed, ctx) => {
      const meta: Meta = { version: randomBytes(6).toString("hex"), at: new Date().toISOString(), by: ctx.principal.name };
      api.settings.set("meta", meta);
      api.db.run("DELETE FROM tp_mededeling_dismissed WHERE version <> ?", meta.version);
      const m = current();
      if (!m) api.log.info(`${ctx.principal.name} haalde de mededeling weg`);
      else api.log.info(`${ctx.principal.name} wijzigde de mededeling (${changed.join(", ")})${m.roles.length ? ` voor ${m.roles.length} rol(len)` : " voor iedereen"}${m.until ? ` tot en met ${m.until}` : ""}`);
      if (typeof values.until === "string" && values.until.trim() && normaliseDate(values.until) === undefined) api.log.warn(`De einddatum "${values.until}" klopt niet; niemand ziet de mededeling tot je hem aanpast (JJJJ-MM-DD).`);
    },
  });

  /** De mededeling uit de velden; null als er geen Nederlandse tekst is. */
  function current(): (Announcement & { badDate?: string }) | null {
    const v = api.settings.values();
    const nl = typeof v.textNl === "string" ? v.textNl.trim() : "";
    if (!nl) return null;
    const en = typeof v.textEn === "string" ? v.textEn.trim() : "";
    const until = normaliseDate(v.until);
    const meta = api.settings.get<Meta>("meta");
    return {
      text: { nl, ...(en ? { en } : {}) },
      until: until ?? null,
      ...(until === undefined ? { badDate: String(v.until) } : {}),
      roles: Array.isArray(v.roles) ? v.roles : [],
      tone: TONES.includes(v.tone as Tone) ? (v.tone as Tone) : "info",
      dismissible: v.dismissible !== false,
      version: meta?.version ?? "1",
      at: meta?.at ?? new Date(0).toISOString(),
      by: meta?.by ?? "",
    };
  }
  /** Verlopen, of een einddatum die niet klopt: niet tonen */
  const expired = (m: Announcement & { badDate?: string }) => Boolean(m.badDate) || Boolean(m.until && today() > m.until);
  const dismissedCount = (m: Announcement) => api.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tp_mededeling_dismissed WHERE version = ?", m.version)?.n ?? 0;

  /** Het blok voor de banner: de tekst met wie hem schreef, wegklikken en (voor beheerders) aanpassen. */
  function block(m: Announcement, opts: { isAdmin: boolean; dismiss: boolean }): SlotContent {
    const footer = (l: "nl" | "en") => (!m.by ? "" : l === "nl" ? `\n\n_Bericht van ${m.by}, ${day(m.at, "nl")}_` : `\n\n_Message from ${m.by}, ${day(m.at, "en")}_`);
    return {
      id: "announcement",
      tone: m.tone,
      text: { nl: `${m.text.nl}${footer("nl")}`, ...(m.text.en ? { en: `${m.text.en}${footer("en")}` } : {}) },
      actions: [
        ...(opts.dismiss ? [{ id: "dismiss", label: { nl: "Sluiten", en: "Dismiss" }, post: "dismiss" }] : []),
        ...(opts.isAdmin ? [{ id: "edit", label: { nl: "Aanpassen", en: "Edit" }, href: "/plugins/mededeling/settings" }] : []),
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
  });

  api.adminRoutes((r) => {
    // Voor het scherm: hoe de mededeling er nu voor staat, met het voorbeeld in de taal van de
    // beheerder (dezelfde omzetter als de banner). Wijzigen gebeurt op de instellingenpagina van de kern.
    r.get("/status", (c) => {
      const m = current();
      const locale = c.req.query("locale") === "en" ? "en" : "nl";
      const text = m ? (locale === "en" && m.text.en) || m.text.nl : "";
      return c.json({ announcement: m, expired: m ? expired(m) : false, dismissed: m ? dismissedCount(m) : 0, today: today(), html: text ? api.markdown.render(text) : "" });
    });
  });

  api.texts("en", TEXTS_EN);
  api.nav({ label: { nl: "Mededeling", en: "Announcement" }, path: "", adminOnly: true });
}
