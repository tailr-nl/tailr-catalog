/**
 * Koppelingen goedkeuren (#113).
 *
 * Maakt iemand via de AI een koppeling, connector of Git-bron aan, dan gebeurt dat niet direct:
 * het verzoek wacht op goedkeuring van een beheerder (standaard een andere beheerder dan de
 * aanvrager). Na goedkeuren voert de plugin het verzoek alsnog uit namens de aanvrager.
 *
 * Een koppeling via de AI (direct of met het stappenplan) maakt Tailr Core nooit zelf aan: de AI
 * krijgt een invullink. Die wordt daarom vooraf goedgekeurd: daarna mag de aanvrager 24 uur die
 * connector opzetten, en vraagt hij zijn AI-tool opnieuw.
 *
 * Instelling "altijd": ook wat beheerders in de beheeromgeving doen, moet worden goedgekeurd.
 *
 * Sinds 2.0.0 staan de verzoeken in Te bevestigen van Tailr Core (api.pending, #125): dezelfde lijst
 * en teller als de beheeracties van de AI. Tailr Core mailt de goedkeurders; Bevestigen en Afwijzen
 * komen terug in onDecide hieronder.
 *
 * Sinds 2.2.0 (plugin-API 1.8) staan de instellingen op de instellingenpagina van de kern
 * (api.settings.define), elk veld onder een eigen sleutel. Het eigen scherm toont nog hoe het nu
 * staat en verwijst naar Te bevestigen. Wie mag goedkeuren is geen instelling meer (tailr-core #298:
 * plugins regelen geen toegang in hun instellingen): alle beheerders, zoals Te bevestigen dat doet.
 */
import { createHash } from "node:crypto";
import type { PluginApi, PluginPrincipal } from "@tailr/plugin";

type Kind = "connection" | "connector" | "connector-update" | "source" | "setup";

interface Config {
  /** "ai": alleen wat via de AI komt; "always": ook de beheeromgeving */
  scope: "ai" | "always";
  /** Mag de aanvrager zijn eigen verzoek goedkeuren? (handig met één beheerder) */
  allowSelf: boolean;
}
const DEFAULTS: Config = { scope: "ai", allowSelf: false };
const FIELDS = Object.keys(DEFAULTS) as (keyof Config)[];
const SETUP_GRANT_HOURS = 24;

const LABEL: Record<Kind, string> = {
  connection: "Nieuwe koppeling",
  connector: "Connector opslaan",
  "connector-update": "Connector bijwerken",
  source: "Git-bron toevoegen",
  setup: "Koppeling opzetten (stappenplan)",
};
const LABEL_EN: Record<Kind, string> = {
  connection: "New connection",
  connector: "Save connector",
  "connector-update": "Update connector",
  source: "Add Git source",
  setup: "Set up connection (guide)",
};

/** Welke beheeracties bewaakt worden */
function classify(method: string, path: string): Kind | undefined {
  if (method !== "POST") return undefined;
  if (path === "/api/admin/connections") return "connection";
  if (path === "/api/admin/adapters") return "connector";
  if (/^\/api\/admin\/connections\/[^/]+\/update-adapter$/.test(path)) return "connector-update";
  if (path === "/api/admin/sources") return "source";
  if (path === "/api/admin/setup-guides") return "setup";
  return undefined;
}

/** Wat de goedkeurder te zien krijgt; nooit de waarden van instellingen of tokens. */
function summarize(kind: Kind, body: Record<string, unknown> | undefined, path: string): Record<string, unknown> {
  const b = body ?? {};
  const adapter = (b.adapter ?? (kind === "connector" ? b : undefined)) as Record<string, unknown> | undefined;
  const out: Record<string, unknown> = {};
  if (b.adapterId) out.adapterId = b.adapterId;
  if (adapter?.id) out.adapterId = adapter.id;
  if (adapter?.name) out.adapterName = adapter.name;
  if (adapter?.type) out.type = adapter.type;
  if (adapter?.baseUrl) out.baseUrl = adapter.baseUrl;
  if (Array.isArray(adapter?.hosts)) out.hosts = adapter.hosts;
  if (Array.isArray(adapter?.tools)) out.tools = (adapter.tools as { name?: string }[]).map((t) => t.name).filter(Boolean);
  if (b.slug) out.slug = b.slug;
  if (b.name && kind !== "connector") out.name = b.name;
  if (b.vars && typeof b.vars === "object") out.vars = Object.keys(b.vars as object);
  if (b.repo) out.repo = b.repo;
  if (b.token) out.token = "(ingevuld)";
  if (kind === "connector-update") out.connectionId = path.split("/")[4];
  return out;
}

/** Namen voor de beheerder in Te bevestigen */
const NAMES: Record<string, string> = { adapterId: "Connector", adapterName: "Naam connector", type: "Soort", baseUrl: "Adres", hosts: "Hosts", tools: "Functies", slug: "Korte naam", name: "Naam", vars: "Instellingen", repo: "Repo", token: "Token", connectionId: "Koppeling" };
const labelled = (summary: Record<string, unknown>) => Object.fromEntries(Object.entries(summary).map(([k, v]) => [NAMES[k] ?? k, Array.isArray(v) ? v.map(String) : String(v)]));

const isAi = (via: string) => via === "internal" || via === "oauth";
/** Vooraf goedkeuren (recht voor 24 uur) in plaats van achteraf uitvoeren */
const isGrant = (kind: Kind, via: string) => kind === "setup" || (kind === "connection" && isAi(via));
const adapterIdOf = (body: unknown) => {
  const b = (body ?? {}) as { adapterId?: unknown; adapter?: { id?: unknown } };
  return String(b.adapterId ?? b.adapter?.id ?? "");
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

/** Wat versleuteld bij het item in Te bevestigen staat (de body kan tokens bevatten) */
interface RequestData {
  kind: Kind;
  method: string;
  path: string;
  via: string;
  body: unknown;
  requesterEmail: string | null;
}

/** De eigen tabel van 1.x; open verzoeken daarin gaan bij het laden naar Te bevestigen */
interface LegacyRow {
  id: string;
  requester_id: string;
  requester_name: string;
  requester_email: string | null;
  via: string;
  kind: Kind;
  method: string;
  path: string;
  summary_json: string;
  body_hash: string;
}

export function register(api: PluginApi) {
  api.migrate([
    `CREATE TABLE tp_koppelingen_goedkeuren_requests (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      requester_id TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      requester_email TEXT,
      via TEXT NOT NULL,
      kind TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      decided_by TEXT,
      decided_by_name TEXT,
      decided_at TEXT,
      note TEXT,
      result_status INTEGER,
      result_json TEXT
    );
    CREATE TABLE tp_koppelingen_goedkeuren_grants (
      requester_id TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (requester_id, adapter_id)
    );`,
  ]);

  // Van 2.1.x: het object "config" eenmalig naar de losse sleutels, voor zover die nog leeg zijn.
  // Vóór define, want daarna geeft get voor een leeg veld de standaard.
  const legacy = api.settings.get<Partial<Config> & { approvers?: unknown }>("config");
  if (legacy && typeof legacy === "object") {
    const clean: Partial<Config> = {
      scope: legacy.scope === "ai" || legacy.scope === "always" ? legacy.scope : undefined,
      allowSelf: typeof legacy.allowSelf === "boolean" ? legacy.allowSelf : undefined,
    };
    const moved = FIELDS.filter((key) => clean[key] !== undefined && api.settings.get(key) === undefined);
    for (const key of moved) api.settings.set(key, clean[key]);
    api.settings.remove("config");
    api.log.info(`instellingen overgezet naar de losse sleutels: ${moved.join(", ") || "niets"}`);
    if (Array.isArray(legacy.approvers) && legacy.approvers.length) api.log.warn("Alleen bepaalde beheerders mochten verzoeken goedkeuren. Dat is geen instelling meer: nieuwe verzoeken kunnen alle beheerders goedkeuren.");
  }

  const activeAdmins = () => api.users.list().filter((u) => u.isAdmin && !u.disabled);
  api.settings.define({
    fields: [
      {
        name: "scope",
        type: "select",
        label: { en: "What waits for approval", nl: "Wat wacht op goedkeuring" },
        description: { en: "Always: also what administrators do in the admin environment.", nl: "Altijd: ook wat beheerders in de beheeromgeving doen." },
        options: [
          { value: "ai", label: { en: "Only what comes through the AI", nl: "Alleen wat via de AI komt" } },
          { value: "always", label: { en: "Always", nl: "Altijd" }, description: { en: "Also what administrators do in the admin environment.", nl: "Ook wat beheerders in de beheeromgeving doen." } },
        ],
        default: DEFAULTS.scope,
      },
      {
        name: "allowSelf",
        type: "boolean",
        label: { en: "The requester may approve their own request", nl: "De aanvrager mag zijn eigen verzoek goedkeuren" },
        description: {
          en: "Only useful with a single administrator. All administrators can approve requests; they get an email for each new request if a mail server is set up.",
          nl: "Alleen handig met één beheerder. Alle beheerders kunnen verzoeken goedkeuren; ze krijgen een mail bij elk nieuw verzoek als er een mailserver is.",
        },
        default: DEFAULTS.allowSelf,
      },
    ],
  });

  const config = (): Config => ({
    scope: api.settings.get<Config["scope"]>("scope") === "always" ? "always" : "ai",
    allowSelf: api.settings.get<boolean>("allowSelf") === true,
  });
  /** Goedgekeurde verzoeken die de plugin nu zelf uitvoert: één keer doorlaten */
  const replaying = new Set<string>();
  const replayKey = (requesterId: string, method: string, path: string, body: unknown) => `${requesterId}|${method}|${path}|${hash(body)}`;
  const link = (id: string) => `${api.publicUrl}/pending?id=${encodeURIComponent(id)}`;

  const what = (summary: Record<string, unknown>) => [summary.adapterName ?? summary.adapterId, summary.name ?? summary.slug, summary.repo].filter(Boolean).join(" · ");

  /** Een verzoek in Te bevestigen zetten. Hetzelfde verzoek dat al open staat, geeft hetzelfde id. */
  function addRequest(requester: { id: string; name: string; email: string | null }, data: RequestData, key: string, summary: Record<string, unknown>): { id: string; fresh: boolean } {
    const existing = api.pending.open("request", key);
    if (existing) return { id: existing, fresh: false };
    const cfg = config();
    const subject = what(summary);
    const grant = isGrant(data.kind, data.via);
    const id = api.pending.add({
      kind: "request",
      key,
      title: { nl: `${LABEL[data.kind]}${subject ? `: ${subject}` : ""}`, en: `${LABEL_EN[data.kind]}${subject ? `: ${subject}` : ""}` },
      summary: grant
        ? {
            nl: `${requester.name} wil via de AI deze koppeling opzetten. Na bevestigen mag dat ${SETUP_GRANT_HOURS} uur; de aanvrager vraagt zijn AI-tool dan opnieuw.`,
            en: `${requester.name} wants to set up this connection through the AI. Once confirmed, that is allowed for ${SETUP_GRANT_HOURS} hours; the requester then asks their AI tool again.`,
          }
        : {
            nl: `${requester.name} wil dit ${isAi(data.via) ? "via de AI" : "in de beheeromgeving"} doen. Na bevestigen voert Tailr Core het uit namens de aanvrager.`,
            en: `${requester.name} wants to do this ${isAi(data.via) ? "through the AI" : "in the admin environment"}. Once confirmed, Tailr Core carries it out on behalf of the requester.`,
          },
      details: labelled(summary),
      requester: { id: requester.id, name: requester.name },
      allowSelf: cfg.allowSelf,
      data: { ...data, requesterEmail: requester.email } satisfies RequestData,
    });
    return { id, fresh: true };
  }

  // Open verzoeken uit de eigen tabel van 1.x naar Te bevestigen (één keer)
  for (const row of api.db.all<LegacyRow>("SELECT * FROM tp_koppelingen_goedkeuren_requests WHERE status = 'pending'")) {
    const body = api.settings.get<unknown>(`body:${row.id}`) ?? null;
    const key = `${row.requester_id}|${row.body_hash}`;
    const { id } = addRequest({ id: row.requester_id, name: row.requester_name, email: row.requester_email }, { kind: row.kind, method: row.method, path: row.path, via: row.via, body, requesterEmail: row.requester_email }, key, JSON.parse(row.summary_json));
    api.db.run("UPDATE tp_koppelingen_goedkeuren_requests SET status = 'moved', note = ? WHERE id = ?", id, row.id);
    api.settings.remove(`body:${row.id}`);
    api.log.info(`verzoek ${row.id} staat nu in Te bevestigen als ${id}`);
  }

  async function notifyRequester(data: RequestData, approved: boolean, approver: string, note?: string, extra = "") {
    if (!api.users.mailEnabled() || !data.requesterEmail) return;
    const subject = approved ? `Goedgekeurd: ${LABEL[data.kind]}` : `Afgewezen: ${LABEL[data.kind]}`;
    const text = approved
      ? isGrant(data.kind, data.via)
        ? `Je verzoek is goedgekeurd door ${approver}. Vraag je AI-tool opnieuw om de koppeling op te zetten; dat kan de komende ${SETUP_GRANT_HOURS} uur.\n${extra}`
        : `Je verzoek is goedgekeurd door ${approver} en uitgevoerd.\n${extra}`
      : `Je verzoek is afgewezen door ${approver}.${note ? `\n\nReden: ${note}` : ""}\n`;
    await api.sendMail(data.requesterEmail, subject, text).catch((e) => api.log.warn("mail aan aanvrager mislukt:", e));
  }

  api.guard("admin.before", async (ctx) => {
    const kind = classify(ctx.method, ctx.path);
    if (!kind) return;
    const p: PluginPrincipal = ctx.principal;
    // Een goedgekeurd verzoek dat de plugin nu zelf uitvoert
    const replay = replayKey(p.id, ctx.method, ctx.path, ctx.body);
    if (replaying.has(replay)) {
      replaying.delete(replay);
      return;
    }
    const cfg = config();
    if (cfg.scope === "ai" && !isAi(p.via)) return;
    const body = (ctx.body && typeof ctx.body === "object" ? ctx.body : {}) as Record<string, unknown>;
    const grantMode = isGrant(kind, p.via);

    if (grantMode) {
      const grant = api.db.get<{ request_id: string }>(
        "SELECT request_id FROM tp_koppelingen_goedkeuren_grants WHERE requester_id = ? AND adapter_id = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        p.id,
        adapterIdOf(body),
      );
      if (grant) return;
    }

    // Hetzelfde verzoek staat al open: niet nog een keer (vooraf goedkeuren: dezelfde connector)
    const key = grantMode ? `${p.id}|grant:${adapterIdOf(body)}` : `${p.id}|${ctx.method} ${ctx.path}|${hash(ctx.body)}`;
    const summary = summarize(kind, body, ctx.path);
    // De volledige body (met eventuele tokens) staat alleen versleuteld bij het item, en is weg na de beslissing
    const { id, fresh } = addRequest({ id: p.id, name: p.name, email: p.email ?? null }, { kind, method: ctx.method, path: ctx.path, via: p.via, body: ctx.body ?? null, requesterEmail: p.email ?? null }, key, summary);
    if (fresh) api.log.info(`verzoek ${id}: ${LABEL[kind]} door ${p.name} (${p.via})`);
    return {
      deny: grantMode
        ? `Setting up this connection needs approval by an administrator first. It is waiting as request ${id} in Tailr Core under "To confirm" (${link(id)}). Tell the user; once it is approved, they can ask you again.`
        : `This change needs approval by an administrator first. It is waiting as request ${id} in Tailr Core under "To confirm" (${link(id)}). Once approved, Tailr Core carries it out; do not retry.`,
      code: "approval_required",
    };
  });

  api.pending.onDecide("request", async (item, decision, approver, note) => {
    const data = item.data as RequestData | null;
    if (!data || !item.requester) throw new Error("Het verzoek is niet meer volledig (gegevens ontbreken)");
    if (decision === "reject") {
      void notifyRequester(data, false, approver.name, note);
      return { rejected: true };
    }
    if (isGrant(data.kind, data.via)) {
      const adapterId = adapterIdOf(data.body);
      const expires = new Date(Date.now() + SETUP_GRANT_HOURS * 3_600_000).toISOString();
      api.db.run(
        "INSERT INTO tp_koppelingen_goedkeuren_grants (requester_id, adapter_id, request_id, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(requester_id, adapter_id) DO UPDATE SET request_id = excluded.request_id, expires_at = excluded.expires_at",
        item.requester.id, adapterId, item.id, expires,
      );
      void notifyRequester(data, true, approver.name);
      return { grantedUntil: expires };
    }
    // Uitvoeren namens de aanvrager, met dezelfde controles als altijd
    const replay = replayKey(item.requester.id, data.method, data.path, data.body);
    replaying.add(replay);
    let result: { status: number; data: unknown };
    try {
      result = await api.adminFetch(item.requester.id, data.method, data.path, data.body);
    } finally {
      replaying.delete(replay);
    }
    if (result.status >= 400) {
      const message = (result.data as { error?: string } | null)?.error ?? JSON.stringify(result.data).slice(0, 300);
      void notifyRequester(data, true, approver.name, undefined, `Uitvoeren mislukte: ${message}`);
      throw new Error(`Carrying out the request failed (${result.status}): ${message}`);
    }
    void notifyRequester(data, true, approver.name);
    return { status: result.status, data: result.data };
  });

  api.adminRoutes((r) => {
    // Voor het scherm: hoe het nu staat. Wijzigen gebeurt op de instellingenpagina van de kern.
    r.get("/status", (c) => {
      const cfg = config();
      return c.json({ scope: cfg.scope, allowSelf: cfg.allowSelf, admins: activeAdmins().length, mailEnabled: api.users.mailEnabled() });
    });
  });

  // Eén beheerder die zijn eigen verzoeken niet mag goedkeuren: die blijven dan wachten
  api.slots.register("admin.overview", () => {
    if (config().allowSelf || activeAdmins().length !== 1) return null;
    return {
      id: "single-admin",
      tone: "warning",
      title: { en: "Approve connections", nl: "Koppelingen goedkeuren" },
      text: {
        en: "There is only one administrator, and requesters may not approve their own requests. Their own requests then stay waiting. Allow self-approval, or add an administrator.",
        nl: "Er is maar één beheerder, en een aanvrager mag zijn eigen verzoek niet goedkeuren. Zijn eigen verzoeken blijven dan wachten. Sta zelf goedkeuren toe, of voeg een beheerder toe.",
      },
      actions: [{ id: "settings", label: { en: "Settings", nl: "Instellingen" }, href: "/plugins/koppelingen-goedkeuren" }],
    };
  });

  api.nav({ label: { nl: "Koppelingen goedkeuren", en: "Approve connections" }, path: "", adminOnly: true });
}
