/**
 * AI-tools en apps toestaan (#113).
 *
 * Elke AI-tool of app die met OAuth verbindt (Claude, ChatGPT, Claude Code, een eigen app met
 * "Inloggen met Tailr Core") is een OAuth-client. Per client kies je toestaan of blokkeren, met
 * een standaard voor nieuwe clients en rollen die altijd mogen.
 *
 * Privé-accounts afvangen (bijv. een gratis ChatGPT die op je data traint): zet de standaard op
 * "goedkeuring nodig" en sta de client van de connector van je Claude- of ChatGPT-organisatie toe.
 * Een nieuwe client wordt dan geweigerd tot een beheerder hem toestaat. Hij komt als item in Te bevestigen
 * van Tailr Core (api.pending, #125), en de medewerker ziet het al op het toestemmingsscherm (oauth.consent).
 * Of blokkeer alles behalve de toegestane clients. De plugin houdt bij wie welke client gebruikt, zodat je ziet of
 * die echt verschillen. Let op (#118, docs/ai-clients-test.md): met CIMD gebruiken Claude en ChatGPT één client voor
 * iedereen; een aparte client voor de organisatie krijg je met een eigen app (client-id en -geheim) in de connector.
 *
 * Geldt alleen voor OAuth-tokens; sessies in de browser en API-sleutels gaan er niet langs.
 */
import type { PluginApi } from "@tailr/plugin";

type State = "allow" | "block";
type DefaultAi = State | "approve";
/**
 * Sinds 1.5.0 (plugin-API 1.8): defaultAi en exemptRoles staan op de instellingenpagina van de kern
 * (api.settings.define), elk onder een eigen sleutel. De keuze per client is geen vaste instelling
 * maar hoort bij de lijst van clients: die blijft op het scherm van de plugin, onder de sleutel "clients".
 */
interface Config {
  /** Wat geldt voor een AI-client zonder eigen keuze: toestaan, blokkeren, of eerst goedkeuren */
  defaultAi: DefaultAi;
  /** Keuze per client-id */
  clients: Record<string, State>;
  /** Rollen die elke client mogen gebruiken */
  exemptRoles: string[];
}
const DEFAULTS: Config = { defaultAi: "allow", clients: {}, exemptRoles: [] };
const isDefaultAi = (v: unknown): v is DefaultAi => v === "allow" || v === "block" || v === "approve";
const cleanClients = (v: unknown): Record<string, State> =>
  Object.fromEntries(Object.entries(v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}).filter((e): e is [string, State] => e[1] === "allow" || e[1] === "block"));

interface ClientRow {
  clientId: string;
  name: string | null;
  uri: string | null;
  redirectUris: string | null;
  createdAt: string | null;
  disabled: number | null;
  clientDiscoveryId: string | null;
  softwareId: string | null;
  softwareVersion: string | null;
  tokenEndpointAuthMethod: string | null;
}

/** Hoe de client bij Tailr Core is aangemeld (#118): via een CIMD-URL, dynamisch (DCR) of als eigen app. */
type Registration = "cimd" | "dcr" | "app";
function registrationOf(row: ClientRow | undefined, isApp: boolean): Registration | null {
  if (isApp) return "app";
  if (!row) return null;
  if (row.clientDiscoveryId === "cimd" || /^https:\/\//.test(row.clientId)) return "cimd";
  return "dcr";
}

const REGISTRATION_LABEL: Record<Registration | "unknown", string> = { cimd: "CIMD (URL)", dcr: "dynamisch (DCR)", app: "eigen app", unknown: "onbekend" };

function urisOf(redirectUris: string | null): string[] {
  if (!redirectUris) return [];
  try {
    const parsed = JSON.parse(redirectUris);
    return (Array.isArray(parsed) ? parsed : [parsed]).map(String).filter(Boolean);
  } catch {
    return redirectUris.split(/[\s,]+/).filter(Boolean);
  }
}

function hostsOf(redirectUris: string | null): string[] {
  return [...new Set(urisOf(redirectUris).map((u) => { try { return new URL(u).host; } catch { return ""; } }).filter(Boolean))];
}

export function register(api: PluginApi) {
  api.migrate([
    `CREATE TABLE tp_ai_clients_seen (
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      first_at TEXT NOT NULL,
      last_at TEXT NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (client_id, user_id)
    );`,
    // Niet meer in gebruik sinds 1.2.0 (wachtende clients staan in Te bevestigen); blijft voor de volgorde van de migraties
    `CREATE TABLE tp_ai_clients_notified (
      client_id TEXT PRIMARY KEY,
      first_user_name TEXT NOT NULL,
      at TEXT NOT NULL
    );`,
  ]);

  // Van 1.4.x: het object "config" eenmalig naar de losse sleutels, voor zover die nog leeg zijn.
  // Vóór define, want daarna geeft get voor een leeg veld de standaard.
  const legacy = api.settings.get<Partial<Config>>("config");
  if (legacy && typeof legacy === "object") {
    const moved: string[] = [];
    if (isDefaultAi(legacy.defaultAi) && api.settings.get("defaultAi") === undefined) api.settings.set("defaultAi", legacy.defaultAi), moved.push("defaultAi");
    if (Array.isArray(legacy.exemptRoles) && api.settings.get("exemptRoles") === undefined) api.settings.set("exemptRoles", [...new Set(legacy.exemptRoles.map(String))]), moved.push("exemptRoles");
    if (legacy.clients && api.settings.get("clients") === undefined) api.settings.set("clients", cleanClients(legacy.clients)), moved.push("clients");
    api.settings.remove("config");
    api.log.info(`instellingen overgezet naar de losse sleutels: ${moved.join(", ") || "niets"}`);
  }

  api.settings.define({
    fields: [
      {
        name: "defaultAi",
        type: "select",
        label: { en: "New AI tools", nl: "Nieuwe AI-tools" },
        description: {
          en: "For a client without its own choice on the Allow AI tools screen. With approval, a new client appears under To confirm (administrators get an email) and the employee already sees this on the consent screen. Your own apps (under Apps) are always allowed unless you block them there.",
          nl: "Voor een client zonder eigen keuze op het scherm AI-tools toestaan. Met goedkeuring komt een nieuwe client in Te bevestigen (beheerders krijgen een mail) en ziet de medewerker het al op het toestemmingsscherm. Eigen apps (onder Apps) mogen altijd, tenzij je ze daar blokkeert.",
        },
        options: [
          { value: "allow", label: { en: "May connect", nl: "Mogen verbinden" }, description: { en: "Unless you block them on the Allow AI tools screen.", nl: "Tenzij je ze blokkeert op het scherm AI-tools toestaan." } },
          { value: "approve", label: { en: "Need approval first", nl: "Hebben eerst goedkeuring nodig" }, description: { en: "They appear under To confirm (administrators get an email), and the employee already sees this on the consent screen.", nl: "Ze komen in Te bevestigen (beheerders krijgen een mail), en de medewerker ziet het al op het toestemmingsscherm." } },
          { value: "block", label: { en: "Only what you allow", nl: "Alleen wat je toestaat" }, description: { en: "For example only the connector of your Claude or ChatGPT organisation.", nl: "Bijvoorbeeld alleen de connector van je Claude- of ChatGPT-organisatie." } },
        ],
        default: DEFAULTS.defaultAi,
        group: { en: "Default", nl: "Standaard" },
      },
      {
        name: "exemptRoles",
        type: "roles",
        label: { en: "Roles that may use any AI tool", nl: "Rollen die elke AI-tool mogen gebruiken" },
        description: { en: "For example developers. No selection: no exceptions.", nl: "Bijvoorbeeld ontwikkelaars. Niets aangevinkt: geen uitzonderingen." },
        group: { en: "Default", nl: "Standaard" },
      },
    ],
  });

  const config = (): Config => ({
    defaultAi: api.settings.get<DefaultAi>("defaultAi") ?? DEFAULTS.defaultAi,
    clients: cleanClients(api.settings.get("clients")),
    exemptRoles: api.settings.get<string[]>("exemptRoles") ?? DEFAULTS.exemptRoles,
  });

  // Tabellen van Tailr Core en Better Auth, alleen lezen (een plugin is vertrouwde code)
  const appClients = () => new Map(api.db.all<{ oauth_client_id: string; name: string }>("SELECT oauth_client_id, name FROM tc_apps WHERE oauth_client_id IS NOT NULL").map((a) => [a.oauth_client_id, a.name]));
  const clientRows = (): ClientRow[] => {
    try {
      return api.db.all<ClientRow>('SELECT clientId, name, uri, redirectUris, createdAt, disabled, clientDiscoveryId, softwareId, softwareVersion, tokenEndpointAuthMethod FROM "oauthClient" ORDER BY createdAt DESC');
    } catch {
      return [];
    }
  };

  /** Mag deze client? Eigen apps volgen de standaard niet: die staan toe tenzij je ze blokkeert. */
  function decide(cfg: Config, clientId: string | undefined, roleIds: string[]): { allowed: boolean; reason: "role" | "client" | "app" | "default" | "approval" } {
    if (roleIds.some((r) => cfg.exemptRoles.includes(r))) return { allowed: true, reason: "role" };
    const own = clientId ? cfg.clients[clientId] : undefined;
    if (own) return { allowed: own === "allow", reason: "client" };
    if (clientId && appClients().has(clientId)) return { allowed: true, reason: "app" };
    if (cfg.defaultAi === "approve") return { allowed: false, reason: "approval" };
    return { allowed: cfg.defaultAi === "allow", reason: "default" };
  }

  /**
   * Een nieuwe client in Te bevestigen van Tailr Core (#125), één keer per client. Tailr Core mailt
   * de beheerders en toont het item in de gewone lijst en teller; Bevestigen = toestaan,
   * Afwijzen = blokkeren (zie onDecide hieronder).
   */
  function requestApproval(clientId: string, user: { id: string; name: string }): string {
    const open = api.pending.open("client", clientId);
    if (open) return open;
    const row = clientRows().find((c) => c.clientId === clientId);
    const name = row?.name ?? null;
    const hosts = hostsOf(row?.redirectUris ?? null);
    const id = api.pending.add({
      kind: "client",
      key: clientId,
      title: name ? { nl: `AI-tool "${name}" wil verbinden`, en: `AI tool "${name}" wants to connect` } : { nl: "Een AI-tool zonder naam wil verbinden", en: "An AI tool without a name wants to connect" },
      summary: {
        nl: `${user.name} wil deze AI-tool met Tailr Core verbinden. Bevestigen staat hem toe voor iedereen; afwijzen blokkeert hem.`,
        en: `${user.name} wants to connect this AI tool to Tailr Core. Confirming allows it for everyone; rejecting blocks it.`,
      },
      details: { Client: clientId, Naam: name ?? "—", Redirect: hosts.length ? hosts : ["onbekend"], Aanmelding: REGISTRATION_LABEL[registrationOf(row, appClients().has(clientId)) ?? "unknown"] },
      requester: user,
      // Beheerders kunnen een client ook zelf toestaan op het scherm van de plugin
      allowSelf: true,
      expiresInHours: 0,
      data: { clientId },
    });
    api.log.info(`nieuwe client ${clientId} (${name ?? "zonder naam"}) wacht op goedkeuring (${id}), eerst geprobeerd door ${user.name}`);
    return id;
  }

  /** Een eigen keuze voor een client: het open item in Te bevestigen is dan niet meer nodig. */
  function closeRequest(clientId: string, by: string) {
    const open = api.pending.open("client", clientId);
    if (open) api.pending.cancel(open, `Al geregeld op het scherm AI-tools toestaan door ${by}`);
  }

  function setChoice(clientId: string, choice: State | null) {
    const clients = { ...config().clients };
    if (choice) clients[clientId] = choice;
    else delete clients[clientId];
    api.settings.set("clients", clients);
  }

  api.pending.onDecide("client", async (item, decision, approver) => {
    const { clientId } = (item.data ?? {}) as { clientId?: string };
    if (!clientId) throw new Error("Client-id ontbreekt in het verzoek");
    const choice: State = decision === "confirm" ? "allow" : "block";
    setChoice(clientId, choice);
    api.log.info(`${approver.name}: client ${clientId} → ${choice} (via Te bevestigen)`);
    const requester = item.requester && api.users.list().find((u) => u.id === item.requester!.id);
    if (requester && api.users.mailEnabled()) {
      const name = clientRows().find((c) => c.clientId === clientId)?.name ?? "je AI-tool";
      await api
        .sendMail(
          requester.email,
          choice === "allow" ? `Goedgekeurd: ${name}` : `Niet toegestaan: ${name}`,
          choice === "allow" ? `${approver.name} heeft "${name}" toegestaan. Verbind je AI-tool opnieuw met Tailr Core.
` : `${approver.name} staat "${name}" niet toe. Vraag je beheerder welke AI-tool je kunt gebruiken.
`,
        )
        .catch((e) => api.log.warn("mail aan aanvrager mislukt:", e));
    }
    return { choice };
  });

  // Gebruik bijhouden, hooguit één schrijfactie per client en gebruiker per minuut (behalve bij blokkeren)
  const lastWrite = new Map<string, number>();
  function note(clientId: string, userId: string, userName: string, allowed: boolean) {
    const key = `${clientId}|${userId}|${allowed}`;
    const now = Date.now();
    if (allowed && now - (lastWrite.get(key) ?? 0) < 60_000) return;
    lastWrite.set(key, now);
    const at = new Date(now).toISOString();
    api.db.run(
      `INSERT INTO tp_ai_clients_seen (client_id, user_id, user_name, first_at, last_at, allowed, blocked) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id, user_id) DO UPDATE SET user_name = excluded.user_name, last_at = excluded.last_at,
         allowed = allowed + excluded.allowed, blocked = blocked + excluded.blocked`,
      clientId, userId, userName, at, at, allowed ? 1 : 0, allowed ? 0 : 1,
    );
  }

  api.guard("auth.before", (ctx) => {
    const p = ctx.principal;
    if (p.via !== "oauth") return;
    const clientId = p.clientId ?? "(onbekend)";
    const { allowed, reason } = decide(config(), p.clientId, p.roleIds);
    note(clientId, p.id, p.name, allowed);
    if (allowed) return;
    if (reason === "approval") {
      requestApproval(clientId, { id: p.id, name: p.name });
      return { deny: "This AI tool has not been approved yet by the administrator of this Tailr Core installation. The administrator has been notified. Tell the user to wait for approval, or to use the AI tool of the organisation (for example the company Claude or ChatGPT workspace)." };
    }
    return { deny: "This AI tool or app is not allowed by the administrator of this Tailr Core installation. Ask the administrator which AI tool to use (for example the Claude connector of your organisation)." };
  });

  // Al op het toestemmingsscherm melden, vóór de AI-tool een token krijgt (#125)
  api.guard("oauth.consent", (ctx) => {
    const p = ctx.principal;
    const { allowed, reason } = decide(config(), ctx.client.id, p.roleIds);
    if (allowed) return;
    const en = ctx.locale === "en";
    if (reason === "approval") {
      requestApproval(ctx.client.id, { id: p.id, name: p.name });
      return {
        deny: en
          ? "This AI tool is waiting for approval by your administrator. They have been notified; try again once it has been approved."
          : "Deze AI-tool wacht op goedkeuring van je beheerder. Die heeft een melding gekregen; probeer het opnieuw zodra hij is goedgekeurd.",
        code: "approval_required",
      };
    }
    return {
      deny: en
        ? "Your administrator does not allow this AI tool. Ask which AI tool you can use, for example the connector of your organisation."
        : "Je beheerder staat deze AI-tool niet toe. Vraag welke AI-tool je wel kunt gebruiken, bijvoorbeeld de connector van je organisatie.",
    };
  });

  api.adminRoutes((r) => {
    r.get("/clients", (c) => {
      const cfg = config();
      const apps = appClients();
      const seen = api.db.all<{ client_id: string; user_id: string; user_name: string; first_at: string; last_at: string; allowed: number; blocked: number }>(
        "SELECT * FROM tp_ai_clients_seen ORDER BY last_at DESC",
      );
      const known = clientRows();
      const ids = new Set([...known.map((k) => k.clientId), ...seen.map((s) => s.client_id)]);
      const clients = [...ids].map((id) => {
        const row = known.find((k) => k.clientId === id);
        const users = seen.filter((s) => s.client_id === id).map((s) => ({ id: s.user_id, name: s.user_name, firstAt: s.first_at, lastAt: s.last_at, allowed: s.allowed, blocked: s.blocked }));
        const choice = cfg.clients[id] ?? null;
        return {
          clientId: id,
          name: row?.name ?? null,
          uri: row?.uri ?? null,
          redirectHosts: hostsOf(row?.redirectUris ?? null),
          redirectUris: urisOf(row?.redirectUris ?? null),
          /** cimd, dcr of app; null als de client niet (meer) in de database staat (#118) */
          registration: registrationOf(row, apps.has(id)),
          softwareId: row?.softwareId ?? null,
          softwareVersion: row?.softwareVersion ?? null,
          /** "none" = publieke client zonder geheim; anders met client-secret */
          authMethod: row?.tokenEndpointAuthMethod ?? null,
          createdAt: row?.createdAt ?? null,
          disabled: Boolean(row?.disabled),
          app: apps.get(id) ?? null,
          choice,
          effective: decide({ ...cfg, exemptRoles: [] }, id, []).allowed ? "allow" : "block",
          /** Wacht op een keuze van de beheerder (stand "goedkeuring nodig") */
          pending: cfg.defaultAi === "approve" && !choice && !apps.has(id),
          /** Het item in Te bevestigen, als het er is */
          pendingId: api.pending.open("client", id) ?? null,
          users,
          lastAt: users[0]?.lastAt ?? null,
        };
      });
      clients.sort((a, b) => String(b.lastAt ?? b.createdAt ?? "").localeCompare(String(a.lastAt ?? a.createdAt ?? "")));
      clients.sort((a, b) => Number(b.pending) - Number(a.pending));
      return c.json({ defaultAi: cfg.defaultAi, exemptRoles: cfg.exemptRoles.length, clients, mailEnabled: api.users.mailEnabled() });
    });
    // De keuze voor één client (keuzelijst per client, en de knoppen bij een wachtende client)
    r.put("/clients/:id", async (c) => {
      const { choice } = (await c.req.json()) as { choice: State | null };
      const id = c.req.param("id");
      const valid = choice === "allow" || choice === "block" ? choice : null;
      setChoice(id, valid);
      if (valid) closeRequest(id, c.get("principal").name);
      api.log.info(`${c.get("principal").name}: client ${id} → ${choice ?? "standaard"}`);
      return c.json({ ok: true });
    });
  });

  api.nav({ label: { nl: "AI-tools toestaan", en: "Allow AI tools" }, path: "", adminOnly: true });
}
