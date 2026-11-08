/**
 * Extra logging (#113): stuurt elke functie-aanroep en elke beheerwijziging door naar een
 * bestand (JSON per regel), een webhook (POST met JSON, optioneel ondertekend) en/of syslog (UDP).
 * De log van Tailr Core zelf blijft gewoon bestaan.
 *
 * Met de functie extra-logging__feedback (#123) meldt een gebruiker via zijn AI dat een antwoord
 * niet klopt ("Klopt niet"). De melding komt in het scherm en gaat naar dezelfde bestemmingen.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { createHmac } from "node:crypto";
import { createSocket } from "node:dgram";
import { hostname } from "node:os";
import type { PluginApi } from "@tailr/plugin";

/**
 * Sinds 1.3.0 (plugin-API 1.8) staan de instellingen op de instellingenpagina van de kern
 * (api.settings.define), elk veld onder een eigen sleutel. De kern controleert type en lengte;
 * of een pad absoluut en een adres http(s) is, controleert problems() hieronder. Het scherm van de
 * plugin toont die problemen, en send() slaat zo'n bestemming over.
 */
interface Config {
  calls: boolean;
  admin: boolean;
  onlyWrites: boolean;
  file: string;
  webhookUrl: string;
  webhookSecret: string;
  syslog: string; // host:port
}

const DEFAULTS: Config = { calls: true, admin: true, onlyWrites: false, file: "", webhookUrl: "", webhookSecret: "", syslog: "" };
const FIELDS = Object.keys(DEFAULTS) as (keyof Config)[];

/** Wat niet klopt aan de bestemmingen, per veld, voor de beheerder (Nederlands en Engels). */
function problems(cfg: Config): { field: keyof Config; nl: string; en: string }[] {
  const out: { field: keyof Config; nl: string; en: string }[] = [];
  if (cfg.file && !isAbsolute(cfg.file)) out.push({ field: "file", nl: "Het bestandspad moet absoluut zijn, bijv. /data/logs/tailr.jsonl.", en: "The file path must be absolute, e.g. /data/logs/tailr.jsonl." });
  if (cfg.webhookUrl && !/^https?:\/\/\S+$/.test(cfg.webhookUrl)) out.push({ field: "webhookUrl", nl: "De webhook moet een http- of https-adres zijn.", en: "The webhook must be an http or https address." });
  if (cfg.syslog && !/^[^:\s]+(:\d{1,5})?$/.test(cfg.syslog)) out.push({ field: "syslog", nl: "Syslog: gebruik host of host:poort.", en: "Syslog: use host or host:port." });
  return out;
}

type Entry = Record<string, unknown> & { type: "call" | "admin" | "test" | "feedback"; at: string };

export function register(api: PluginApi) {
  api.migrate([
    "CREATE TABLE tp_extra_logging_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT, user_name TEXT, tool TEXT NOT NULL, comment TEXT)",
  ]);
  // Van 1.2.x: het object "config" eenmalig naar de losse sleutels, voor zover die nog leeg zijn.
  // Vóór define, want daarna geeft get voor een leeg veld de standaard.
  const legacy = api.settings.get<Partial<Config>>("config");
  if (legacy && typeof legacy === "object") {
    const moved = FIELDS.filter((key) => typeof legacy[key] === typeof DEFAULTS[key] && legacy[key] !== "" && api.settings.get(key) === undefined);
    for (const key of moved) api.settings.set(key, typeof legacy[key] === "string" ? (legacy[key] as string).trim() : legacy[key]);
    api.settings.remove("config");
    api.log.info(`instellingen overgezet naar de losse sleutels: ${moved.filter((k) => k !== "webhookSecret").join(", ") || "niets"}${moved.includes("webhookSecret") ? " en het geheim" : ""}`);
  }

  const what = { en: "What", nl: "Wat" };
  const where = { en: "Where", nl: "Waarheen" };
  api.settings.define({
    fields: [
      { name: "calls", type: "boolean", label: { en: "Function calls", nl: "Functie-aanroepen" }, default: DEFAULTS.calls, group: what },
      { name: "onlyWrites", type: "boolean", label: { en: "Only write actions (no read calls)", nl: "Alleen schrijfacties (geen leesaanroepen)" }, description: { en: "Applies to function calls.", nl: "Geldt voor functie-aanroepen." }, default: DEFAULTS.onlyWrites, group: what },
      { name: "admin", type: "boolean", label: { en: "Admin changes", nl: "Beheerwijzigingen" }, default: DEFAULTS.admin, group: what },
      {
        name: "file",
        type: "text",
        label: { en: "File (one JSON object per line)", nl: "Bestand (JSON per regel)" },
        description: { en: "Absolute path on the server, writable for the gateway. Empty: not to a file.", nl: "Absoluut pad op de server, schrijfbaar voor de gateway. Leeg: niet naar een bestand." },
        placeholder: "/data/logs/tailr-core.jsonl",
        maxLength: 500,
        group: where,
      },
      {
        name: "webhookUrl",
        type: "text",
        label: { en: "Webhook", nl: "Webhook" },
        description: { en: "Every line as a POST with JSON, to an http or https address.", nl: "Elke regel als POST met JSON, naar een http- of https-adres." },
        placeholder: "https://logs.example.nl/tailr",
        maxLength: 1000,
        group: where,
      },
      {
        name: "webhookSecret",
        type: "secret",
        label: { en: "Webhook secret", nl: "Geheim voor de webhook" },
        description: { en: "With a secret, every call gets the header X-Tailr-Signature: sha256=… (HMAC of the body).", nl: "Met een geheim krijgt elke aanroep de header X-Tailr-Signature: sha256=… (HMAC van de body)." },
        group: where,
      },
      {
        name: "syslog",
        type: "text",
        label: { en: "Syslog (UDP)", nl: "Syslog (UDP)" },
        description: { en: "host or host:port (default port 514).", nl: "host of host:poort (standaard poort 514)." },
        placeholder: "syslog.example.nl:514",
        maxLength: 260,
        group: where,
      },
    ],
    // Een fout in een bestemming meteen in de log, zodat de beheerder hem ook daar ziet
    onChange: (_values, changed) => {
      for (const p of problems(config())) if (changed.includes(p.field)) api.log.warn(p.nl);
    },
  });

  const config = (): Config => {
    const v = api.settings.values();
    const text = (key: "file" | "webhookUrl" | "syslog") => (typeof v[key] === "string" ? (v[key] as string).trim() : "");
    return {
      calls: v.calls !== false,
      admin: v.admin !== false,
      onlyWrites: v.onlyWrites === true,
      file: text("file"),
      webhookUrl: text("webhookUrl"),
      webhookSecret: api.settings.get<string>("webhookSecret") ?? "",
      syslog: text("syslog"),
    };
  };
  const syslogSocket = createSocket("udp4");
  syslogSocket.unref();
  const stats = { sent: 0, failed: 0, lastError: "" as string, lastErrorAt: "" as string };

  const fail = (target: string, error: unknown) => {
    stats.failed++;
    stats.lastError = `${target}: ${(error as Error).message}`;
    stats.lastErrorAt = new Date().toISOString();
    api.log.warn(stats.lastError);
  };

  async function send(entry: Entry, cfg = config()): Promise<string[]> {
    const line = JSON.stringify(entry);
    // Een bestemming die niet klopt, slaan we over (het scherm van de plugin toont waarom)
    const wrong = new Set(problems(cfg).map((p) => p.field));
    const done: string[] = [];
    const jobs: Promise<unknown>[] = [];
    if (cfg.file && !wrong.has("file")) {
      jobs.push(
        (async () => {
          if (!isAbsolute(cfg.file)) throw new Error("bestandspad moet absoluut zijn");
          await mkdir(dirname(cfg.file), { recursive: true });
          await appendFile(cfg.file, `${line}\n`, "utf8");
          done.push("file");
        })().catch((e) => fail("bestand", e)),
      );
    }
    if (cfg.webhookUrl && !wrong.has("webhookUrl")) {
      const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "TailrCore-ExtraLogging/1.0" };
      if (cfg.webhookSecret) headers["x-tailr-signature"] = `sha256=${createHmac("sha256", cfg.webhookSecret).update(line).digest("hex")}`;
      jobs.push(
        fetch(cfg.webhookUrl, { method: "POST", headers, body: line, signal: AbortSignal.timeout(5_000) })
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            done.push("webhook");
          })
          .catch((e) => fail("webhook", e)),
      );
    }
    if (cfg.syslog && !wrong.has("syslog")) {
      const [host, port = "514"] = cfg.syslog.split(":");
      // RFC 5424, facility local0 (16), severity info (6) of warning (4) bij een fout
      const pri = 16 * 8 + (entry.status === "error" ? 4 : 6);
      const msg = `<${pri}>1 ${entry.at} ${hostname()} tailr-core - ${entry.type} - ${line}`;
      jobs.push(
        new Promise<void>((resolve, reject) => syslogSocket.send(msg, Number(port), host, (e) => (e ? reject(e) : resolve()))).then(
          () => void done.push("syslog"),
          (e) => fail("syslog", e),
        ),
      );
    }
    await Promise.all(jobs);
    if (done.length) stats.sent++;
    return done;
  }

  api.on("call.completed", (e) => {
    const cfg = config();
    if (!cfg.calls || (cfg.onlyWrites && e.level === "read")) return;
    void send(
      {
        type: "call",
        at: e.at,
        user: { id: e.principal.id, name: e.principal.name, email: e.principal.email, type: e.principal.type },
        via: e.via,
        authVia: e.principal.via,
        clientId: e.principal.clientId,
        tool: e.tool,
        level: e.level,
        status: e.status,
        durationMs: e.durationMs,
        errorCode: e.errorCode,
        reference: e.reference,
        runId: e.runId,
        cached: e.cached,
        // Zoals de log van Tailr Core: bij lezen alleen welke parameters, bij schrijven alles
        args: e.level === "read" ? Object.keys(e.args) : e.args,
      },
      cfg,
    );
  });

  api.on("admin.completed", (e) => {
    const cfg = config();
    if (!cfg.admin) return;
    void send({ type: "admin", at: e.at, user: { id: e.principal.id, name: e.principal.name, email: e.principal.email }, authVia: e.principal.via, method: e.method, path: e.path, status: e.status }, cfg);
  });

  // "Klopt niet": de AI meldt namens de gebruiker dat een antwoord niet klopt (use case 1)
  api.tools.register({
    name: "feedback",
    title: { nl: "Klopt niet melden", en: "Report a wrong answer" },
    summary: { nl: "Meld dat een antwoord niet klopt; de beheerder ziet het onder Extra logging.", en: "Report that an answer looks wrong; the administrator sees it under Extra logging." },
    description: "Call this when the user says an answer from a Tailr Core tool is wrong or looks odd. Pass the tool name and, in the user's words, what is wrong. An administrator will check it.",
    level: "write",
    params: {
      tool: { type: "string", required: true, description: "Full name of the tool whose answer was wrong, e.g. winkel__revenue_summary" },
      comment: { type: "string", required: true, description: "What is wrong, in the user's words" },
    },
    handler: (args, ctx) => {
      const at = new Date().toISOString();
      const tool = String(args.tool).slice(0, 200);
      const comment = String(args.comment).slice(0, 2_000);
      api.db.run("INSERT INTO tp_extra_logging_feedback (at, user_id, user_name, tool, comment) VALUES (?, ?, ?, ?, ?)", at, ctx.principal.id, ctx.principal.name, tool, comment);
      void send({ type: "feedback", at, user: { id: ctx.principal.id, name: ctx.principal.name, email: ctx.principal.email }, tool, comment });
      return { saved: true, message: "Thanks, the administrator will check this." };
    },
  });

  api.adminRoutes((r) => {
    r.get("/feedback", (c) => c.json(api.db.all("SELECT id, at, user_name AS userName, tool, comment FROM tp_extra_logging_feedback ORDER BY id DESC LIMIT 100")));
    // Voor het scherm: wat er nu heen gaat en wat er niet klopt. De instellingen zelf staan op de
    // pagina van de kern; het geheim gaat nooit terug naar de browser.
    r.get("/status", (c) => {
      const cfg = config();
      const wrong = problems(cfg);
      const ok = (field: keyof Config) => Boolean(cfg[field]) && !wrong.some((p) => p.field === field);
      return c.json({
        calls: cfg.calls,
        admin: cfg.admin,
        onlyWrites: cfg.onlyWrites,
        // Alleen bestemmingen die kloppen; de rest staat in problems
        destinations: { file: ok("file"), webhook: ok("webhookUrl"), webhookSigned: ok("webhookUrl") && Boolean(cfg.webhookSecret), syslog: ok("syslog") },
        problems: wrong,
        stats,
      });
    });
    r.post("/test", async (c) => {
      const p = c.get("principal");
      const done = await send({ type: "test", at: new Date().toISOString(), user: { id: p.id, name: p.name }, message: "Testbericht van Extra logging" });
      return c.json({ sent: done, stats });
    });
  });

  api.nav({ label: { nl: "Extra logging", en: "Extra logging" }, path: "", adminOnly: true });
}
