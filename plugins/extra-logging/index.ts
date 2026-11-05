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

type Entry = Record<string, unknown> & { type: "call" | "admin" | "test" | "feedback"; at: string };

export function register(api: PluginApi) {
  api.migrate([
    "CREATE TABLE tp_extra_logging_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT, user_name TEXT, tool TEXT NOT NULL, comment TEXT)",
  ]);
  const config = (): Config => ({ ...DEFAULTS, ...(api.settings.get<Partial<Config>>("config") ?? {}) });
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
    const done: string[] = [];
    const jobs: Promise<unknown>[] = [];
    if (cfg.file) {
      jobs.push(
        (async () => {
          if (!isAbsolute(cfg.file)) throw new Error("bestandspad moet absoluut zijn");
          await mkdir(dirname(cfg.file), { recursive: true });
          await appendFile(cfg.file, `${line}\n`, "utf8");
          done.push("file");
        })().catch((e) => fail("bestand", e)),
      );
    }
    if (cfg.webhookUrl) {
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
    if (cfg.syslog) {
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
    r.get("/config", (c) => {
      const cfg = config();
      // Het geheim gaat nooit terug naar de browser
      return c.json({ ...cfg, webhookSecret: "", hasWebhookSecret: Boolean(cfg.webhookSecret), stats });
    });
    r.put("/config", async (c) => {
      const body = (await c.req.json()) as Partial<Config>;
      const current = config();
      const next: Config = {
        calls: body.calls ?? current.calls,
        admin: body.admin ?? current.admin,
        onlyWrites: body.onlyWrites ?? current.onlyWrites,
        file: (body.file ?? current.file).trim(),
        webhookUrl: (body.webhookUrl ?? current.webhookUrl).trim(),
        // Leeg = ongewijzigd; "-" = verwijderen
        webhookSecret: body.webhookSecret === "-" ? "" : body.webhookSecret || current.webhookSecret,
        syslog: (body.syslog ?? current.syslog).trim(),
      };
      if (next.file && !isAbsolute(next.file)) return c.json({ error: "Het bestandspad moet absoluut zijn, bijv. /data/logs/tailr.jsonl" }, 400);
      if (next.webhookUrl && !/^https?:\/\//.test(next.webhookUrl)) return c.json({ error: "De webhook moet een http- of https-adres zijn" }, 400);
      if (next.syslog && !/^[^:\s]+(:\d{1,5})?$/.test(next.syslog)) return c.json({ error: "Syslog: gebruik host of host:poort" }, 400);
      api.settings.set("config", next);
      return c.json({ ok: true });
    });
    r.post("/test", async (c) => {
      const p = c.get("principal");
      const done = await send({ type: "test", at: new Date().toISOString(), user: { id: p.id, name: p.name }, message: "Testbericht van Extra logging" });
      return c.json({ sent: done, stats });
    });
  });

  api.nav({ label: { nl: "Extra logging", en: "Extra logging" }, path: "", adminOnly: true });
}
