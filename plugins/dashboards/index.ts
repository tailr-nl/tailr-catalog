/**
 * Mijn dashboards (#154, zie docs/dashboards.md).
 *
 * Een medewerker laat zijn AI (bijv. Claude.ai) een dashboard maken: een HTML/JS-pagina. De AI
 * slaat hem op met dashboards__save; hij is eerst te bevestigen. De gebruiker bevestigt zelf in
 * Tailr Core (alleen met een sessie) en ziet daarbij welke functies hij gebruikt (uses).
 *
 * Het dashboard draait in het afgeschermde frame van de kern (/api/frame, host.js): geen netwerk,
 * geen cookies, geen toegang tot de beheeromgeving. Data haalt hij met tailr.call(naam, args).
 * Die aanroep loopt via de route /call hieronder: alleen functies uit uses van de bevestigde
 * versie, alleen voor de eigenaar, en met de rechten van de kijker (api.callTool).
 *
 * Delen valt buiten deze versie; canView() is de ene plek waar dat later bij komt.
 */
import { createHash, randomBytes } from "node:crypto";
import type { PluginApi } from "@tailr/plugin";

interface Config {
  /** Uit: niet opslaan, niet openen, en de functies zijn niet zichtbaar */
  enabled: boolean;
  /** Rollen die mogen maken; leeg = iedereen met de functies in Toegang */
  creatorRoles: string[];
  /** Maximale grootte van de HTML in kB */
  maxKb: number;
  /** Bibliotheken uit de vaste lijst van de kern */
  libraries: string[];
  /** Alleen leesfuncties in uses */
  readOnly: boolean;
}
const DEFAULTS: Config = { enabled: true, creatorRoles: [], maxKb: 200, libraries: ["chartjs"], readOnly: true };
const HARD_MAX_KB = 2048;
const MAX_USES = 40;
const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const QUALIFIED = /^[a-z0-9][a-z0-9_-]*__[a-z0-9][a-z0-9_.-]*$/i;

interface ItemRow {
  id: string;
  owner_id: string;
  name: string;
  title: string;
  description: string;
  enabled: number;
  active_version: number | null;
  created_at: string;
  updated_at: string;
}
interface VersionRow {
  dashboard_id: string;
  version: number;
  title: string;
  description: string;
  html: string;
  uses: string;
  libraries: string;
  size: number;
  hash: string;
  status: "pending" | "confirmed" | "rejected" | "replaced";
  created_via: string;
  created_at: string;
  decided_at: string | null;
}

const now = () => new Date().toISOString();
const parseList = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export function register(api: PluginApi) {
  api.migrate([
    `CREATE TABLE tp_dashboards_items (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      active_version INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (owner_id, name)
    )`,
    `CREATE TABLE tp_dashboards_versions (
      dashboard_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL,
      uses TEXT NOT NULL,
      libraries TEXT NOT NULL,
      size INTEGER NOT NULL,
      hash TEXT NOT NULL,
      status TEXT NOT NULL,
      created_via TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      PRIMARY KEY (dashboard_id, version)
    )`,
  ]);

  const config = (): Config => {
    const stored = api.settings.get<Partial<Config>>("config") ?? {};
    return { ...DEFAULTS, ...stored };
  };
  const knownLibraries = () => api.frame.libraries.map((l) => l.id);
  const allowedLibraries = (cfg: Config) => cfg.libraries.filter((id) => knownLibraries().includes(id));
  const canCreate = (cfg: Config, roleIds: readonly string[]) => cfg.enabled && (!cfg.creatorRoles.length || roleIds.some((r) => cfg.creatorRoles.includes(r)));
  const roleIdsOf = (userId: string) => api.users.list().find((u) => u.id === userId)?.roleIds ?? [];
  const link = (id: string, what: "confirm" | "view") => (what === "view" ? `${api.publicUrl}/p/dashboards/view?id=${id}` : `${api.publicUrl}/p/dashboards?confirm=${id}`);

  // --- Opslag -------------------------------------------------------------------------------

  const item = (id: string) => api.db.get<ItemRow>("SELECT * FROM tp_dashboards_items WHERE id = ?", id);
  const itemByName = (ownerId: string, name: string) => api.db.get<ItemRow>("SELECT * FROM tp_dashboards_items WHERE owner_id = ? AND name = ?", ownerId, name);
  const versions = (id: string) => api.db.all<VersionRow>("SELECT * FROM tp_dashboards_versions WHERE dashboard_id = ? ORDER BY version DESC", id);
  const version = (id: string, v: number) => api.db.get<VersionRow>("SELECT * FROM tp_dashboards_versions WHERE dashboard_id = ? AND version = ?", id, v);
  const pendingOf = (id: string) => api.db.get<VersionRow>("SELECT * FROM tp_dashboards_versions WHERE dashboard_id = ? AND status = 'pending' ORDER BY version DESC LIMIT 1", id);

  /**
   * Mag deze gebruiker het dashboard zien en gebruiken? Nu alleen de eigenaar. Delen (later) komt
   * hier bij; het dashboard draait toch al met de rechten van de kijker.
   */
  const canView = (row: ItemRow | undefined, userId: string): row is ItemRow => Boolean(row && row.owner_id === userId);

  /** De functies uit uses die de gebruiker nu mag, met niveau; en wat ontbreekt of niet mag. */
  async function checkUses(userId: string, uses: string[], cfg: Config) {
    const available = new Map((await api.tools.available(userId)).map((t) => [t.qualifiedName, t]));
    const tools = uses.map((name) => {
      const t = available.get(name);
      const problem = !t ? "not_available" : t.level === "admin" ? "admin_not_allowed" : cfg.readOnly && t.level !== "read" ? "write_not_allowed" : name.startsWith("dashboards__") ? "not_allowed" : null;
      return { name, title: t?.title ?? null, description: t?.description ?? null, level: t?.level ?? null, problem };
    });
    return { tools, problems: tools.filter((t) => t.problem) };
  }

  function describeItem(row: ItemRow) {
    const all = versions(row.id);
    const active = all.find((v) => v.version === row.active_version);
    const pending = all.find((v) => v.status === "pending");
    return {
      id: row.id,
      name: row.name,
      title: row.title,
      description: row.description,
      enabled: Boolean(row.enabled),
      status: !active ? (pending ? "pending" : "rejected") : row.enabled ? "active" : "disabled",
      activeVersion: row.active_version,
      pendingVersion: pending?.version ?? null,
      uses: active ? parseList(active.uses) : [],
      updatedAt: row.updated_at,
      url: link(row.id, "view"),
      versions: all.map((v) => ({ version: v.version, status: v.status, title: v.title, size: v.size, uses: parseList(v.uses), libraries: parseList(v.libraries), createdVia: v.created_via, createdAt: v.created_at, decidedAt: v.decided_at, active: v.version === row.active_version })),
    };
  }

  // --- Uitleg voor de AI (#169) ---------------------------------------------------------------
  // Alleen zichtbaar voor wie een functie van deze plugin mag gebruiken

  api.help.instructions("Dashboards are available: when the user wants an overview, chart or report they will look at again, offer to build a dashboard with dashboards__save.");
  api.help.register({
    topic: "building",
    title: "Building a dashboard",
    summary: "When to offer a dashboard, and how to build one that works in the sandboxed frame.",
    text: [
      "A dashboard is one self-contained HTML page that the user opens in Tailr Core under My dashboards. It shows live data with the permissions of the person viewing it.",
      "",
      "When to offer one: the user asks for an overview, chart, KPI or report that they will want to see again (weekly revenue, open orders, stock levels). For a one-off answer, just answer.",
      "",
      "How to build one:",
      "1. Find the read functions that give the data (tailr__whoami lists them). Heavy computation belongs in a function or a my__ function, not in the page.",
      "2. Write the page: inline HTML, CSS and JavaScript only. No network: get data with `await tailr.call('<tool>', args)` and list every such tool in `uses`.",
      "3. Charts: pass libraries: ['chartjs'] and use the global `Chart`. Show a loading state and a readable error.",
      "4. Save it with dashboards__save. It is not active until the user confirms it: give them the confirmUrl from the result.",
      "5. Changing it later: dashboards__get returns the current HTML; save again with the same name for a new version.",
      "",
      "dashboards__list shows the user's dashboards and their status.",
    ].join("\n"),
  });

  // --- Functies voor de AI -------------------------------------------------------------------

  api.tools.register({
    name: "save",
    title: { nl: "Dashboard opslaan", en: "Save dashboard" },
    summary: { nl: "Een dashboard (HTML) opslaan in Mijn dashboards; de gebruiker bevestigt het zelf", en: "Save a dashboard (HTML) to My dashboards; the user confirms it" },
    level: "write",
    description: [
      "Save a dashboard (one self-contained HTML page) for the current user in Tailr Core, under My dashboards.",
      "It is NOT active until the user confirms it in Tailr Core; give them the confirmUrl from the result.",
      "Saving again with the same name creates a new version (also to be confirmed; the previous version stays active until then).",
      "",
      "How the page runs: in a sandboxed iframe with no network access. fetch, XMLHttpRequest, WebSocket, external scripts, external images, fonts and stylesheets, cookies, localStorage, forms and popups are all blocked.",
      "Put all HTML, CSS and JavaScript inline. Images only as data: URIs or inline SVG.",
      "Get data only through the bridge: `const data = await tailr.call('<tool>', { ...args })` returns the tool's result (the same data you get when you call the tool yourself) or throws an Error with .code and .message.",
      "`await tailr.tools()` lists the allowed tools. `tailr.locale` is 'nl' or 'en', `tailr.theme` is 'light' or 'dark'.",
      "List EVERY tool the page calls in `uses` (full names like webshop__list_orders or my__weekly_revenue); any other call is refused. Only read-level tools, unless the administrator allows more.",
      "Each call runs with the permissions of the person viewing the dashboard. Do the heavy lifting in tools (or a my__ function), keep the page for display.",
      "Libraries: pass e.g. libraries: ['chartjs'] to get Chart.js 4 as global `Chart` (do not add a script tag yourself).",
      "Show a loading state and a readable error message if a call fails.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name, lowercase letters, digits and hyphens, e.g. revenue-per-week. Same name = new version." },
        title: { type: "string", description: "Title shown in Tailr Core, in the user's language." },
        description: { type: "string", description: "One or two sentences on what the dashboard shows." },
        html: { type: "string", description: "The complete HTML page (inline CSS and JS)." },
        uses: { type: "array", items: { type: "string" }, description: "Every tool the page calls with tailr.call, full names." },
        libraries: { type: "array", items: { type: "string", enum: api.frame.libraries.map((l) => l.id) }, description: "Optional libraries from the fixed list, e.g. chartjs." },
      },
      required: ["name", "title", "html", "uses"],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const cfg = config();
      if (ctx.principal.type !== "user") throw api.tools.error("access_denied", "Only users can have dashboards.");
      if (!cfg.enabled) throw api.tools.error("access_denied", "Dashboards are turned off by your administrator.");
      if (!canCreate(cfg, ctx.principal.roleIds)) throw api.tools.error("access_denied", "Your role may not create dashboards. Ask your administrator.");
      const name = String(args.name ?? "").trim().toLowerCase();
      if (!NAME.test(name)) throw api.tools.error("invalid_input", "name: use lowercase letters, digits and hyphens (max 48), e.g. revenue-per-week.");
      const title = String(args.title ?? "").trim().slice(0, 120);
      if (!title) throw api.tools.error("invalid_input", "title is required.");
      const description = String(args.description ?? "").trim().slice(0, 1_000);
      const html = typeof args.html === "string" ? args.html : "";
      if (!html.trim()) throw api.tools.error("invalid_input", "html is required.");
      const size = Buffer.byteLength(html, "utf8");
      const maxKb = Math.min(cfg.maxKb, HARD_MAX_KB);
      if (size > maxKb * 1024) throw api.tools.error("invalid_input", `The page is ${Math.ceil(size / 1024)} kB; the maximum is ${maxKb} kB. Make it smaller (move work into tools, remove inline data).`);
      if (!Array.isArray(args.uses)) throw api.tools.error("invalid_input", "uses must be a list of tool names.");
      const uses = [...new Set(args.uses.map((u) => String(u).trim()).filter(Boolean))];
      if (uses.length > MAX_USES) throw api.tools.error("invalid_input", `At most ${MAX_USES} tools in uses.`);
      const malformed = uses.filter((u) => !QUALIFIED.test(u));
      if (malformed.length) throw api.tools.error("invalid_input", `Not a full tool name: ${malformed.join(", ")}. Use names like webshop__list_orders.`);
      const libs = Array.isArray(args.libraries) ? [...new Set(args.libraries.map(String))] : [];
      const notAllowed = libs.filter((l) => !allowedLibraries(cfg).includes(l));
      if (notAllowed.length) throw api.tools.error("invalid_input", `Library not allowed: ${notAllowed.join(", ")}. Allowed: ${allowedLibraries(cfg).join(", ") || "none"}.`);
      const { problems } = await checkUses(ctx.principal.id, uses, cfg);
      if (problems.length) {
        const text = problems.map((p) => `${p.name} (${p.problem === "not_available" ? "you do not have access to it or it does not exist" : p.problem === "write_not_allowed" ? "only read-level tools are allowed" : "not allowed in a dashboard"})`).join(", ");
        throw api.tools.error("invalid_input", `These tools cannot be used: ${text}. Use tools from your own list.`);
      }

      const at = now();
      const saved = api.db.tx(() => {
        let row = itemByName(ctx.principal.id, name);
        if (!row) {
          const id = `dsh_${randomBytes(9).toString("base64url")}`;
          api.db.run("INSERT INTO tp_dashboards_items (id, owner_id, name, title, description, enabled, active_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?)", id, ctx.principal.id, name, title, description, at, at);
          row = item(id)!;
        }
        // Een oudere versie die nog wachtte, vervalt: alleen de nieuwste is te bevestigen
        api.db.run("UPDATE tp_dashboards_versions SET status = 'replaced', decided_at = ? WHERE dashboard_id = ? AND status = 'pending'", at, row.id);
        const next = (api.db.get<{ v: number | null }>("SELECT MAX(version) AS v FROM tp_dashboards_versions WHERE dashboard_id = ?", row.id)?.v ?? 0) + 1;
        api.db.run(
          "INSERT INTO tp_dashboards_versions (dashboard_id, version, title, description, html, uses, libraries, size, hash, status, created_via, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
          row.id, next, title, description, html, JSON.stringify(uses), JSON.stringify(libs), size, createHash("sha256").update(html).digest("hex"), ctx.via, at,
        );
        // Nog nooit bevestigd: titel en omschrijving volgen de nieuwste versie
        if (row.active_version === null) api.db.run("UPDATE tp_dashboards_items SET title = ?, description = ?, updated_at = ? WHERE id = ?", title, description, at, row.id);
        else api.db.run("UPDATE tp_dashboards_items SET updated_at = ? WHERE id = ?", at, row.id);
        return { id: row.id, version: next, hadActive: row.active_version !== null };
      });
      return {
        id: saved.id,
        name,
        version: saved.version,
        status: "pending",
        sizeKb: Math.ceil(size / 1024),
        uses,
        libraries: libs,
        confirmUrl: link(saved.id, "confirm"),
        viewUrl: link(saved.id, "view"),
        confirm: `Saved as version ${saved.version}, but not active yet. Ask the user to confirm it in Tailr Core: ${link(saved.id, "confirm")} (they see the tools it uses).${saved.hadActive ? " Until then the previous version stays active." : ""}`,
      };
    },
  });

  api.tools.register({
    name: "list",
    title: { nl: "Mijn dashboards", en: "My dashboards" },
    summary: { nl: "De eigen dashboards, met status en versies", en: "Your own dashboards, with status and versions" },
    level: "read",
    description: "List the current user's dashboards in Tailr Core (name, title, status, active and pending version, tools used, link). Use dashboards__get to load one for editing.",
    params: {},
    handler: (_args, ctx) => {
      if (!config().enabled) throw api.tools.error("access_denied", "Dashboards are turned off by your administrator.");
      return api.db.all<ItemRow>("SELECT * FROM tp_dashboards_items WHERE owner_id = ? ORDER BY updated_at DESC", ctx.principal.id).map((row) => {
        const { versions: all, ...rest } = describeItem(row);
        return { ...rest, versionCount: all.length };
      });
    },
  });

  api.tools.register({
    name: "get",
    title: { nl: "Dashboard ophalen", en: "Get dashboard" },
    summary: { nl: "De HTML en functies van een eigen dashboard, om bij te werken", en: "The HTML and tools of one of your dashboards, for editing" },
    level: "read",
    description: "Get the HTML, uses and libraries of one of the current user's dashboards, to change it and save a new version with dashboards__save (same name). Default: the newest version.",
    params: {
      name: { type: "string", required: true, description: "The dashboard name" },
      version: { type: "number", description: "A specific version (optional)" },
    },
    handler: (args, ctx) => {
      if (!config().enabled) throw api.tools.error("access_denied", "Dashboards are turned off by your administrator.");
      const row = itemByName(ctx.principal.id, String(args.name ?? "").trim().toLowerCase());
      if (!row) throw api.tools.error("not_found", `No dashboard named ${args.name}. Use dashboards__list.`);
      const v = args.version !== undefined && args.version !== null && args.version !== "" ? version(row.id, Number(args.version)) : versions(row.id)[0];
      if (!v) throw api.tools.error("not_found", `Version ${args.version} does not exist.`);
      return { name: row.name, title: v.title, description: v.description, version: v.version, status: v.status, active: v.version === row.active_version, html: v.html, uses: parseList(v.uses), libraries: parseList(v.libraries) };
    },
  });

  // Uit, of geen rol om te maken: de functies niet tonen (weigeren doen de handlers zelf ook)
  api.filter("tools.list", (list, ctx) => {
    const cfg = config();
    if (!cfg.enabled) return list.filter((t) => !t.qualifiedName.startsWith("dashboards__"));
    if (!canCreate(cfg, ctx.principal.roleIds)) return list.filter((t) => t.qualifiedName !== "dashboards__save");
    return list;
  });

  // --- Routes voor de schermen ---------------------------------------------------------------

  api.routes((r) => {
    type P = { type: string; id: string; name: string; via: string; roleIds: string[] };
    type C = { get(key: "principal"): P };
    const user = (c: C) => {
      const p = c.get("principal");
      return p.type === "user" ? p : undefined;
    };
    /** Bevestigen, aanzetten, verwijderen: alleen de mens zelf, in de beheeromgeving */
    const sessionOnly = (c: C) => c.get("principal").via === "session";
    const OFF = { error: "Dashboards staan uit. Vraag je beheerder." };

    r.get("/config", (c) => {
      const cfg = config();
      const p = c.get("principal");
      return c.json({ enabled: cfg.enabled, canCreate: canCreate(cfg, p.roleIds), maxKb: Math.min(cfg.maxKb, HARD_MAX_KB), readOnly: cfg.readOnly, libraries: allowedLibraries(cfg) });
    });

    r.get("/dashboards", (c) => {
      const p = user(c);
      if (!p) return c.json({ error: "Alleen voor gebruikers" }, 403);
      if (!config().enabled) return c.json(OFF, 403);
      return c.json(api.db.all<ItemRow>("SELECT * FROM tp_dashboards_items WHERE owner_id = ? ORDER BY updated_at DESC", p.id).map(describeItem));
    });

    r.get("/dashboards/:id", (c) => {
      const p = user(c);
      const row = item(c.req.param("id"));
      if (!p || !canView(row, p.id)) return c.json({ error: "Dashboard niet gevonden" }, 404);
      if (!config().enabled) return c.json(OFF, 403);
      return c.json(describeItem(row));
    });

    // Een versie bekijken (ook te bevestigen): de HTML en per functie of hij mag
    r.get("/dashboards/:id/versions/:v", async (c) => {
      const p = user(c);
      const row = item(c.req.param("id"));
      if (!p || !canView(row, p.id)) return c.json({ error: "Dashboard niet gevonden" }, 404);
      const cfg = config();
      if (!cfg.enabled) return c.json(OFF, 403);
      const v = version(row.id, Number(c.req.param("v")));
      if (!v) return c.json({ error: "Versie niet gevonden" }, 404);
      const { tools, problems } = await checkUses(p.id, parseList(v.uses), cfg);
      return c.json({ version: v.version, status: v.status, title: v.title, description: v.description, html: v.html, size: v.size, hash: v.hash, libraries: parseList(v.libraries), tools, problems: problems.length, createdVia: v.created_via, createdAt: v.created_at, active: v.version === row.active_version });
    });

    r.post("/dashboards/:id/versions/:v/confirm", async (c) => {
      const p = user(c);
      const row = item(c.req.param("id"));
      if (!p || !canView(row, p.id)) return c.json({ error: "Dashboard niet gevonden" }, 404);
      if (!sessionOnly(c)) return c.json({ error: "Bevestigen kan alleen in de beheeromgeving" }, 403);
      const cfg = config();
      if (!cfg.enabled) return c.json(OFF, 403);
      const v = version(row.id, Number(c.req.param("v")));
      if (!v || v.status !== "pending") return c.json({ error: "Deze versie wacht niet op bevestiging" }, 409);
      const { problems } = await checkUses(p.id, parseList(v.uses), cfg);
      if (problems.length) return c.json({ error: `Dit dashboard gebruikt functies die niet (meer) mogen: ${problems.map((x) => x.name).join(", ")}`, problems }, 422);
      const libs = parseList(v.libraries).filter((l) => !allowedLibraries(cfg).includes(l));
      if (libs.length) return c.json({ error: `Bibliotheek niet toegestaan: ${libs.join(", ")}` }, 422);
      const at = now();
      api.db.tx(() => {
        api.db.run("UPDATE tp_dashboards_versions SET status = 'confirmed', decided_at = ? WHERE dashboard_id = ? AND version = ?", at, row.id, v.version);
        api.db.run("UPDATE tp_dashboards_items SET active_version = ?, title = ?, description = ?, updated_at = ? WHERE id = ?", v.version, v.title, v.description, at, row.id);
      });
      api.log.info(`${p.name} bevestigde dashboard ${row.name} versie ${v.version}`);
      return c.json(describeItem(item(row.id)!));
    });

    r.post("/dashboards/:id/versions/:v/reject", (c) => {
      const p = user(c);
      const row = item(c.req.param("id"));
      if (!p || !canView(row, p.id)) return c.json({ error: "Dashboard niet gevonden" }, 404);
      if (!sessionOnly(c)) return c.json({ error: "Afwijzen kan alleen in de beheeromgeving" }, 403);
      const v = version(row.id, Number(c.req.param("v")));
      if (!v || v.status !== "pending") return c.json({ error: "Deze versie wacht niet op bevestiging" }, 409);
      api.db.run("UPDATE tp_dashboards_versions SET status = 'rejected', decided_at = ? WHERE dashboard_id = ? AND version = ?", now(), row.id, v.version);
      return c.json(describeItem(item(row.id)!));
    });

    // Een eerder bevestigde versie terugzetten
    r.post("/dashboards/:id/versions/:v/activate", async (c) => {
      const p = user(c);
      const row = item(c.req.param("id"));
      if (!p || !canView(row, p.id)) return c.json({ error: "Dashboard niet gevonden" }, 404);
      if (!sessionOnly(c)) return c.json({ error: "Dit kan alleen in de beheeromgeving" }, 403);
      const cfg = config();
      if (!cfg.enabled) return c.json(OFF, 403);
      const v = version(row.id, Number(c.req.param("v")));
      if (!v || v.status !== "confirmed") return c.json({ error: "Alleen een bevestigde versie kan terug" }, 409);
      const { problems } = await checkUses(p.id, parseList(v.uses), cfg);
      if (problems.length) return c.json({ error: `Deze versie gebruikt functies die niet (meer) mogen: ${problems.map((x) => x.name).join(", ")}` }, 422);
      api.db.run("UPDATE tp_dashboards_items SET active_version = ?, title = ?, description = ?, updated_at = ? WHERE id = ?", v.version, v.title, v.description, now(), row.id);
      return c.json(describeItem(item(row.id)!));
    });

    r.post("/dashboards/:id/enabled", async (c) => {
      const p = user(c);
      const row = item(c.req.param("id"));
      if (!p || !canView(row, p.id)) return c.json({ error: "Dashboard niet gevonden" }, 404);
      if (!sessionOnly(c)) return c.json({ error: "Dit kan alleen in de beheeromgeving" }, 403);
      const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
      api.db.run("UPDATE tp_dashboards_items SET enabled = ?, updated_at = ? WHERE id = ?", body.enabled ? 1 : 0, now(), row.id);
      return c.json(describeItem(item(row.id)!));
    });

    r.delete("/dashboards/:id", (c) => {
      const p = user(c);
      const row = item(c.req.param("id"));
      if (!p || !canView(row, p.id)) return c.json({ error: "Dashboard niet gevonden" }, 404);
      if (!sessionOnly(c)) return c.json({ error: "Verwijderen kan alleen in de beheeromgeving" }, 403);
      api.db.tx(() => {
        api.db.run("DELETE FROM tp_dashboards_versions WHERE dashboard_id = ?", row.id);
        api.db.run("DELETE FROM tp_dashboards_items WHERE id = ?", row.id);
      });
      api.log.info(`${p.name} verwijderde dashboard ${row.name}`);
      return c.json({ ok: true });
    });

    /** Wat het scherm nodig heeft om het actieve dashboard te tonen. */
    r.get("/dashboards/:id/frame", async (c) => {
      const p = user(c);
      const row = item(c.req.param("id"));
      if (!p || !canView(row, p.id)) return c.json({ error: "Dashboard niet gevonden" }, 404);
      const cfg = config();
      if (!cfg.enabled) return c.json(OFF, 403);
      if (!row.enabled) return c.json({ error: "Dit dashboard staat uit", code: "disabled" }, 409);
      const v = row.active_version === null ? undefined : version(row.id, row.active_version);
      if (!v) return c.json({ error: "Dit dashboard is nog niet bevestigd", code: "not_confirmed", pendingVersion: pendingOf(row.id)?.version ?? null }, 409);
      const { tools } = await checkUses(p.id, parseList(v.uses), cfg);
      return c.json({ id: row.id, name: row.name, title: row.title, description: row.description, version: v.version, html: v.html, libraries: parseList(v.libraries).filter((l) => allowedLibraries(cfg).includes(l)), tools: tools.filter((t) => !t.problem), missing: tools.filter((t) => t.problem).map((t) => t.name), pendingVersion: pendingOf(row.id)?.version ?? null });
    });

    /**
     * Een aanroep vanuit het dashboard. De echte controle: van de kijker, aan, functie in uses van
     * de bevestigde versie, het juiste niveau. Daarna de gewone callTool met de rechten van de kijker.
     */
    r.post("/dashboards/:id/call", async (c) => {
      const p = user(c);
      const row = item(c.req.param("id"));
      if (!p || !canView(row, p.id)) return c.json({ error: "Dashboard niet gevonden" }, 404);
      if (!sessionOnly(c)) return c.json({ ok: false, error: { code: "access_denied", message: "Dashboards run in Tailr Core only." } }, 403);
      const cfg = config();
      if (!cfg.enabled) return c.json({ ok: false, error: { code: "access_denied", message: "Dashboards are turned off by your administrator." } }, 403);
      if (!row.enabled || row.active_version === null) return c.json({ ok: false, error: { code: "not_confirmed", message: "This dashboard is not active." } }, 409);
      const body = (await c.req.json().catch(() => null)) as { name?: unknown; args?: unknown } | null;
      const name = typeof body?.name === "string" ? body.name : "";
      const args = body?.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Record<string, unknown>) : {};
      const v = version(row.id, row.active_version);
      const uses = v ? parseList(v.uses) : [];
      if (!uses.includes(name)) {
        api.log.warn(`dashboard ${row.name} (${p.name}) probeerde ${name || "(geen naam)"} buiten uses`);
        return c.json({ ok: false, error: { code: "not_in_uses", message: `This dashboard may not call ${name}.` } }, 403);
      }
      const [check] = (await checkUses(p.id, [name], cfg)).tools;
      if (check.problem) return c.json({ ok: false, error: { code: "access_denied", message: check.problem === "write_not_allowed" ? `${name} is not a read-only tool.` : `You do not have access to ${name}.` } }, 403);
      const result = await api.callTool(p.id, name, args);
      if (result.isError) return c.json({ ok: false, error: { code: result.error?.code ?? "call_failed", message: result.error?.message ?? "The call failed." } });
      return c.json({ ok: true, data: result.data });
    });
  });

  // --- Beheer ---------------------------------------------------------------------------------

  api.adminRoutes((r) => {
    r.get("/settings", (c) => {
      const counts = api.db.get<{ items: number; owners: number; pending: number }>(
        "SELECT (SELECT COUNT(*) FROM tp_dashboards_items) AS items, (SELECT COUNT(DISTINCT owner_id) FROM tp_dashboards_items) AS owners, (SELECT COUNT(*) FROM tp_dashboards_versions WHERE status = 'pending') AS pending",
      );
      return c.json({ ...config(), hardMaxKb: HARD_MAX_KB, availableLibraries: api.frame.libraries, stats: counts });
    });
    r.put("/settings", async (c) => {
      const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Partial<Record<keyof Config, unknown>>;
      const current = config();
      const next: Config = {
        enabled: body.enabled === undefined ? current.enabled : Boolean(body.enabled),
        creatorRoles: body.creatorRoles === undefined ? current.creatorRoles : Array.isArray(body.creatorRoles) ? [...new Set(body.creatorRoles.map(String))] : current.creatorRoles,
        maxKb: body.maxKb === undefined ? current.maxKb : Number(body.maxKb),
        libraries: body.libraries === undefined ? current.libraries : Array.isArray(body.libraries) ? [...new Set(body.libraries.map(String))] : current.libraries,
        readOnly: body.readOnly === undefined ? current.readOnly : Boolean(body.readOnly),
      };
      if (!Number.isInteger(next.maxKb) || next.maxKb < 1 || next.maxKb > HARD_MAX_KB) return c.json({ error: `Maximale grootte: een heel getal van 1 tot ${HARD_MAX_KB} kB` }, 400);
      const unknownLibs = next.libraries.filter((l) => !knownLibraries().includes(l));
      if (unknownLibs.length) return c.json({ error: `Onbekende bibliotheek: ${unknownLibs.join(", ")}` }, 400);
      api.settings.set("config", next);
      api.log.info(`instellingen gewijzigd door ${c.get("principal").name}: ${JSON.stringify(next)}`);
      return c.json(next);
    });
  });

  // --- Menu -----------------------------------------------------------------------------------

  api.nav({ label: { nl: "Mijn dashboards", en: "My dashboards" }, path: "" });
  api.nav({ label: { nl: "Dashboards (instellingen)", en: "Dashboards (settings)" }, path: "beheer", adminOnly: true });
}
