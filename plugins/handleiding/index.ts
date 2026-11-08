/**
 * Handleiding (#193, eerder in de kern als #50).
 *
 * - De standaardtekst per taal staat in content/handleiding.<taal>.md en komt mee met elke versie
 *   van de plugin. Hij wordt bij elke aanroep gelezen, zodat een update meteen zichtbaar is.
 * - De beheerder past hem per taal aan in markdown. Die tekst staat in tp_handleiding_texts, samen
 *   met de standaardversie (hash en tekst) waarop hij is gebaseerd. Zo zie je na een update wat er
 *   in de standaard veranderde (diffLines).
 * - Placeholders {{organisatie}}, {{beheerder}} en {{koppelingen}} (en de Engelse namen) worden
 *   per lezer ingevuld. {{koppelingen}} komt uit api.users.tools: precies wat de AI-tool van de
 *   lezer krijgt, met per koppeling voorbeeldvragen op basis van zijn leesfuncties.
 * - De markdown gaat naar HTML met de veilige omzetter van de kern (api.markdown.render).
 *
 * - Naam van de organisatie en contact staan sinds 1.2.0 in api.settings.define: de kern toont ze op
 *   het tabblad Instellingen van /plugins/handleiding. Het eigen scherm (web/beheer.html) is alleen
 *   nog de teksteditor, als tabblad naast Instellingen.
 *
 * Los van de bedrijfsregels van de kern: die gaan altijd mee naar de AI. De handleiding is uitleg
 * en inspiratie; de AI leest hem met handleiding__read als de beheerder die functie toestaat.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { PluginApi, ToolLevel, UserTool } from "@tailr/plugin";

type Lang = "nl" | "en";
const LANGS: Lang[] = ["nl", "en"];
const MAX_LENGTH = 50_000;
const lang = (value: unknown): Lang => (value === "nl" ? "nl" : "en");
const isLang = (value: unknown): value is Lang => value === "nl" || value === "en";

// ---------------------------------------------------------------------------------------------
// Placeholders, hash en verschillen (uit @tailr/core, daar alleen voor de handleiding)
// ---------------------------------------------------------------------------------------------

export interface GuideValues {
  organisation: string;
  admin: string;
  /** Markdown: de koppelingen waar de lezer bij kan, met voorbeeldvragen */
  connections: string;
}

const PLACEHOLDERS: Record<string, keyof GuideValues> = {
  organisatie: "organisation",
  organisation: "organisation",
  organization: "organisation",
  beheerder: "admin",
  admin: "admin",
  koppelingen: "connections",
  connections: "connections",
};

/** Vult {{organisatie}}, {{beheerder}} en {{koppelingen}} in (en de Engelse namen). Onbekende placeholders blijven staan. */
export function fillPlaceholders(text: string, values: GuideValues): string {
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, name: string) => {
    const key = PLACEHOLDERS[name.toLowerCase()];
    return key ? values[key] : match;
  });
}

/** Korte, stabiele hash: op welke standaardversie is een aanpassing gebaseerd. */
export function hashText(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
}

export interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

/** Verschil per regel (langste gemeenschappelijke deelreeks). Voor teksten van enkele honderden regels. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let x = n - 1; x >= 0; x--) {
    for (let y = m - 1; y >= 0; y--) lcs[x]![y] = a[x] === b[y] ? lcs[x + 1]![y + 1]! + 1 : Math.max(lcs[x + 1]![y]!, lcs[x]![y + 1]!);
  }
  const out: DiffLine[] = [];
  let x = 0;
  let y = 0;
  while (x < n && y < m) {
    if (a[x] === b[y]) (out.push({ type: "same", text: a[x]! }), x++, y++);
    else if (lcs[x + 1]![y]! >= lcs[x]![y + 1]!) out.push({ type: "removed", text: a[x++]! });
    else out.push({ type: "added", text: b[y++]! });
  }
  while (x < n) out.push({ type: "removed", text: a[x++]! });
  while (y < m) out.push({ type: "added", text: b[y++]! });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Teksten voor de schermen (api.texts): sleutel = de Nederlandse tekst in web/*.html
// ---------------------------------------------------------------------------------------------

const TEXTS_EN: Record<string, string> = {
  "Handleiding": "Guide",
  "Handleiding aanpassen": "Edit guide",
  "Bekijk de handleiding": "View the guide",
  "Laden…": "Loading…",
  "Uitleg en ideeën voor iedereen in je organisatie, onder Handleiding in het menu. Pas hem aan in markdown; de standaardtekst van de plugin blijft bewaard.": "Explanation and ideas for everyone in your organisation, under Guide in the menu. Edit it in markdown; the default text of the plugin is kept.",
  "Opslaan": "Save",
  "Er is een nieuwe standaardversie.": "There is a new default version.",
  "Je aanpassing is gebaseerd op een oudere standaardtekst. Bekijk wat er in de standaard is veranderd en neem over wat je wilt.": "Your version is based on an older default text. See what changed in the default and copy what you want.",
  "Verschillen tonen": "Show changes",
  "Verschillen verbergen": "Hide changes",
  "Bekeken, mijn tekst houden": "Reviewed, keep my text",
  "Gemarkeerd als bijgewerkt": "Marked as up to date",
  "Aangepast door {name}": "Customised by {name}",
  "Aangepast": "Customised",
  "Standaardtekst": "Default text",
  "Bewerken": "Edit",
  "Voorbeeld": "Preview",
  "Tekst in markdown": "Text in markdown",
  "Markdown: # kop, **vet**, *cursief*, - lijst, 1. genummerd, > citaat, [tekst](https://…), `code` en tabellen. HTML wordt niet uitgevoerd.": "Markdown: # heading, **bold**, *italic*, - list, 1. numbered, > quote, [text](https://…), `code` and tables. HTML is not executed.",
  "Niet-opgeslagen wijzigingen weggooien?": "Discard unsaved changes?",
  "Je wijzigingen ({lang}) gaan verloren als je naar {next} wisselt.": "Your changes ({lang}) will be lost if you switch to {next}.",
  "Weggooien en wisselen": "Discard and switch",
  "{lang} terugzetten naar de standaardtekst?": "Reset {lang} to the default text?",
  "Je aanpassingen gaan verloren. Dit kun je niet ongedaan maken.": "Your changes will be lost. This cannot be undone.",
  "Terugzetten": "Reset",
  "Terug naar standaard": "Back to default",
  "Terug naar de standaardtekst": "Back to the default text",
  "Wijzigingen weggooien": "Discard changes",
  "Handleiding opgeslagen": "Guide saved",
  "De naam van de organisatie en wie je kunt vragen, vul je in op het tabblad Instellingen. De lijst met koppelingen wordt voor elke lezer ingevuld, met voorbeeldvragen.": "Fill in the organisation name and who to ask on the Settings tab. The list of connections is filled in for each reader, with example questions.",
  "Je AI-tool kan de handleiding ook lezen, met de functie Handleiding lezen. Geef rollen daar toegang toe onder Toegang → Rechten, rij Handleiding.": "Your AI tool can read the guide too, with the function Read the guide. Give roles access under Access → Permissions, row Guide.",
};

// ---------------------------------------------------------------------------------------------

interface Custom {
  text: string;
  baseHash: string;
  baseText: string;
  updatedAt: string;
  updatedBy: string | null;
}

const LEVEL_LABEL: Record<Lang, Record<ToolLevel, string>> = {
  nl: { read: "lezen", write: "lezen en schrijven", admin: "beheer" },
  en: { read: "read", write: "read and write", admin: "admin" },
};
const RANK: Record<string, number> = { read: 1, write: 2, admin: 3 };

/** Tekens die de opmaak van een regel kunnen breken, uit namen halen. */
const plain = (text: string) => text.replace(/[*_`[\]|\n\r]/g, "").trim();

function titleOf(tool: UserTool, l: Lang): string {
  const t = tool.title;
  const value = typeof t === "string" ? t : (t?.[l] ?? t?.en ?? t?.nl);
  return plain(value || tool.name.replace(/_/g, " "));
}

export function register(api: PluginApi) {
  api.migrate([
    `CREATE TABLE tp_handleiding_texts (
      locale TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      base_hash TEXT NOT NULL,
      base_text TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    )`,
  ]);

  // --- Teksten ---------------------------------------------------------------------------------

  /** De meegeleverde standaardtekst. Klein bestand: bij elke aanroep vers gelezen. */
  function defaultText(l: Lang): string {
    for (const candidate of [l, "nl"]) {
      const file = new URL(`./content/handleiding.${candidate}.md`, import.meta.url);
      if (existsSync(file)) return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    }
    return l === "nl" ? "# Handleiding\n\nEr is nog geen handleiding." : "# Guide\n\nThere is no guide yet.";
  }

  const custom = (l: Lang) =>
    api.db.get<Custom>("SELECT body AS text, base_hash AS baseHash, base_text AS baseText, updated_at AS updatedAt, updated_by AS updatedBy FROM tp_handleiding_texts WHERE locale = ?", l);

  function source(l: Lang): { text: string; customized: boolean } {
    const own = custom(l);
    return own ? { text: own.text, customized: true } : { text: defaultText(l), customized: false };
  }

  // --- Placeholders ----------------------------------------------------------------------------

  // Naam van de organisatie en contact: het tabblad Instellingen van de kern (sinds 1.2.0, plugin-API
  // 1.8). Dezelfde sleutels als de eigen beheerroute van daarvoor, dus zonder migratie.
  api.settings.define({
    fields: [
      {
        name: "orgName",
        type: "text",
        label: { en: "Organisation name", nl: "Naam van de organisatie" },
        description: { en: "Fills in {{organisation}}. Empty: “your organisation”.", nl: "Vult {{organisatie}} in. Leeg: ‘je organisatie’." },
        maxLength: 120,
        group: { en: "Values for the placeholders", nl: "Gegevens voor de placeholders" },
      },
      {
        name: "contact",
        type: "text",
        label: { en: "Who to ask", nl: "Bij wie kun je terecht" },
        description: {
          en: "Fills in {{admin}}. Empty: the administrators with their e-mail address. {{connections}} is filled in for each reader, with example questions.",
          nl: "Vult {{beheerder}} in. Leeg: de beheerders met hun e-mailadres. {{koppelingen}} wordt voor elke lezer ingevuld, met voorbeeldvragen.",
        },
        maxLength: 500,
        group: { en: "Values for the placeholders", nl: "Gegevens voor de placeholders" },
      },
    ],
    onChange: (_values, changed, ctx) => api.log.info(`${ctx.principal.name} wijzigde ${changed.join(" en ")} van de handleiding`),
  });

  const organisationName = (l: Lang) => api.settings.get<string>("orgName")?.trim() || (l === "nl" ? "je organisatie" : "your organisation");

  /** Contact uit de instellingen, anders de namen en e-mailadressen van de beheerders. */
  function adminContact(l: Lang): string {
    const contact = api.settings.get<string>("contact")?.trim();
    if (contact) return contact;
    const admins = api.users.list().filter((u) => u.isAdmin && !u.disabled);
    if (!admins.length) return l === "nl" ? "je beheerder" : "your administrator";
    return admins.map((u) => `${u.name} (${u.email})`).join(l === "nl" ? " of " : " or ");
  }

  /**
   * Markdown-lijst van de koppelingen waar deze lezer bij kan, met zijn hoogste niveau en tot twee
   * voorbeeldvragen op basis van zijn leesfuncties. Mijn functies en functies van plugins horen
   * er niet bij: dat zijn geen koppelingen.
   */
  async function connectionsList(userId: string | null, l: Lang): Promise<string> {
    const tools = userId ? await api.users.tools(userId) : [];
    const per = new Map<string, { name: string; slug: string; level: ToolLevel; reads: UserTool[] }>();
    for (const tool of tools) {
      const c = tool.connection;
      if (c.id === "my" || c.id.startsWith("plugin:")) continue;
      const level = tool.level;
      const entry = per.get(c.id) ?? per.set(c.id, { name: c.name, slug: c.slug, level, reads: [] }).get(c.id)!;
      if ((RANK[level] ?? 0) > (RANK[entry.level] ?? 0)) entry.level = level;
      if (level === "read" && entry.reads.length < 2) entry.reads.push(tool);
    }
    const items = [...per.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => {
        const name = plain(c.name);
        const examples = c.reads.map((t) =>
          l === "nl" ? `*"Gebruik ‘${titleOf(t, l)}’ van ${name} en vat de uitkomst kort voor me samen."*` : `*"Use ‘${titleOf(t, l)}’ from ${name} and summarise the result for me."*`,
        );
        const ask = examples.length ? ` ${l === "nl" ? "Vraag bijvoorbeeld" : "For example"}: ${examples.join(l === "nl" ? " of " : " or ")}` : "";
        return `- **${name}** (\`${c.slug}__…\`): ${LEVEL_LABEL[l][c.level]}.${ask}`;
      });
    if (items.length) return items.join("\n");
    return l === "nl"
      ? "_Je hebt nog geen toegang tot koppelingen. Je beheerder kan je een rol geven._"
      : "_You do not have access to any connections yet. Your administrator can give you a role._";
  }

  const values = async (userId: string | null, l: Lang): Promise<GuideValues> => ({
    organisation: organisationName(l),
    admin: adminContact(l),
    connections: await connectionsList(userId, l),
  });

  /** De handleiding voor deze lezer: markdown met ingevulde placeholders. */
  async function guideFor(userId: string | null, l: Lang) {
    const src = source(l);
    return { locale: l, markdown: fillPlaceholders(src.text, await values(userId, l)), customized: src.customized };
  }

  /** Wat de editor per taal nodig heeft, met de verschillen als de standaard nieuwer is dan de basis. */
  function adminState(l: Lang) {
    const standard = defaultText(l);
    const defaultHash = hashText(standard);
    const own = custom(l);
    const outdated = Boolean(own && own.baseHash !== defaultHash);
    return {
      text: own?.text ?? standard,
      defaultText: standard,
      defaultHash,
      customized: Boolean(own),
      baseHash: own?.baseHash ?? null,
      updatedAt: own?.updatedAt ?? null,
      updatedBy: own?.updatedBy ? (api.users.get(own.updatedBy)?.name ?? null) : null,
      outdated,
      defaultChanges: outdated ? diffLines(own!.baseText, standard) : null,
    };
  }

  // --- Routes ----------------------------------------------------------------------------------

  const readerId = (p: { type: string; id: string }) => (p.type === "user" ? p.id : null);

  api.routes((r) => {
    // Lezen: iedere ingelogde gebruiker, met zijn eigen rechten voor {{koppelingen}}
    r.get("/guide", async (c) => {
      const guide = await guideFor(readerId(c.get("principal")), lang(c.req.query("locale")));
      return c.json({ ...guide, html: api.markdown.render(guide.markdown), canEdit: c.get("principal").isAdmin });
    });

    // Voorbeeld in de editor: zelfde omzetter en placeholders als voor de lezer, met de rechten van de
    // beheerder. Een gewone route (geen beheerroute), zodat niet elke toetsaanslag in het auditlog komt.
    r.post("/preview", async (c) => {
      if (!c.get("principal").isAdmin) return c.json({ error: "Only administrators can preview the guide." }, 403);
      const body = ((await c.req.json().catch(() => null)) ?? {}) as { text?: unknown; locale?: unknown };
      if (typeof body.text !== "string" || body.text.length > MAX_LENGTH) return c.json({ error: `text is required (max ${MAX_LENGTH} characters)` }, 400);
      const l = body.locale === undefined ? "nl" : body.locale;
      if (!isLang(l)) return c.json({ error: "Unknown language. Use nl or en." }, 400);
      return c.json({ html: api.markdown.render(fillPlaceholders(body.text, await values(readerId(c.get("principal")), l))) });
    });
  });

  api.adminRoutes((r) => {
    // De editor: per taal de tekst, de standaard en de verschillen
    r.get("/texts", (c) => c.json({ locales: Object.fromEntries(LANGS.map((l) => [l, adminState(l)])) }));

    // Opslaan: de aanpassing is gebaseerd op de huidige standaardtekst
    r.put("/text/:locale", async (c) => {
      const l = c.req.param("locale");
      if (!isLang(l)) return c.json({ error: "Unknown language. Use nl or en." }, 400);
      const body = ((await c.req.json().catch(() => null)) ?? {}) as { text?: unknown };
      if (typeof body.text !== "string") return c.json({ error: "text is required" }, 400);
      if (body.text.length > MAX_LENGTH) return c.json({ error: `Text is too long (max ${MAX_LENGTH} characters)` }, 400);
      if (!body.text.trim()) return c.json({ error: "The guide cannot be empty. Use reset to go back to the default text." }, 400);
      const standard = defaultText(l);
      api.db.run(
        `INSERT INTO tp_handleiding_texts (locale, body, base_hash, base_text, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(locale) DO UPDATE SET body = excluded.body, base_hash = excluded.base_hash, base_text = excluded.base_text, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        l,
        body.text.replace(/\r\n/g, "\n"),
        hashText(standard),
        standard,
        new Date().toISOString(),
        c.get("principal").id,
      );
      api.log.info(`${c.get("principal").name} paste de handleiding (${l}) aan`);
      return c.json({ ok: true, ...adminState(l) });
    });

    // Terug naar standaard: de aanpassing verwijderen
    r.delete("/text/:locale", (c) => {
      const l = c.req.param("locale");
      if (!isLang(l)) return c.json({ error: "Unknown language. Use nl or en." }, 400);
      api.db.run("DELETE FROM tp_handleiding_texts WHERE locale = ?", l);
      api.log.info(`${c.get("principal").name} zette de handleiding (${l}) terug naar de standaard`);
      return c.json({ ok: true, ...adminState(l) });
    });

    // Nieuwe standaard bekeken: eigen tekst houden, melding weg
    r.post("/text/:locale/accept-default", (c) => {
      const l = c.req.param("locale");
      if (!isLang(l)) return c.json({ error: "Unknown language. Use nl or en." }, 400);
      if (!custom(l)) return c.json({ error: "This guide has not been customised" }, 404);
      const standard = defaultText(l);
      api.db.run("UPDATE tp_handleiding_texts SET base_hash = ?, base_text = ? WHERE locale = ?", hashText(standard), standard, l);
      return c.json({ ok: true, ...adminState(l) });
    });

  });

  // --- Voor de AI ------------------------------------------------------------------------------

  api.tools.register({
    name: "read",
    title: { nl: "Handleiding lezen", en: "Read the guide" },
    summary: { nl: "De handleiding van de organisatie, voor deze gebruiker ingevuld", en: "The organisation's guide, filled in for this user" },
    description:
      "The guide of this organisation for the current user, in markdown: what Tailr Core is for, the connections this user can use with example questions, and who to ask. Read it when the user asks what they can do or ask, or needs ideas.",
    level: "read",
    params: { language: { type: "string", enum: ["nl", "en"], description: "Language of the guide: nl (default) or en" } },
    handler: async (args, ctx) => (await guideFor(ctx.principal.type === "user" ? ctx.principal.id : null, args.language === "en" ? "en" : "nl")).markdown,
  });
  api.help.instructions("The organisation's guide (what to ask, example questions per connection, who to contact) is available: read it with handleiding__read when the user asks what they can do or needs ideas.");

  // --- Schermen, menu en een verwijzing op Verbinden -------------------------------------------

  api.texts("en", TEXTS_EN);
  api.nav({ label: { nl: "Handleiding", en: "Guide" }, path: "" });
  api.nav({ label: { nl: "Handleiding aanpassen", en: "Edit guide" }, path: "beheer", adminOnly: true });
  api.slots.register("connect", () => ({
    id: "guide",
    text: { nl: "**Wat kun je vragen?** Voorbeelden en ideeën staan in de handleiding.", en: "**What can you ask?** Examples and ideas are in the guide." },
    actions: [{ id: "open", label: { nl: "Lees de handleiding", en: "Read the guide" }, href: "/p/handleiding" }],
  }));
}
