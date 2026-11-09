#!/usr/bin/env node
/**
 * Maakt een variant van een connector (bijv. inloggen met je eigen Google-account naast
 * een serviceaccount) uit de hoofdconnector, zodat de functies van beide altijd gelijk zijn.
 *
 *   node scripts/make-variants.mjs                    alle connectors in VARIANTS
 *   node scripts/make-variants.mjs google-analytics   alleen deze
 *   node scripts/make-variants.mjs --check            alleen controleren of de varianten bij zijn
 *
 * Bron:  connectors/<id>/connector.json (een map) of connectors/<id>.json (een los bestand).
 * Doel:  connectors/<variant-id>/ als de hoofdconnector een map is (connector.json, README.md,
 *        en context.md en tools/ gekopieerd), anders connectors/<variant-id>.json.
 *        Een losse JSON kan niet naar tools/*.ts verwijzen ("file" werkt alleen in een map),
 *        daarom wordt de variant van een mapconnector ook een map.
 *
 * Overgenomen uit de hoofdconnector: alles, behalve wat het configuratieblok hieronder vervangt:
 * id, name, variantOf, variantTitle, description, de inloginstellingen in vars, setup, hosts,
 * auth, en zinnen in de teksten van tools en scripts (bijv. "het serviceaccount").
 * Het versienummer is dat van de hoofdconnector; connectors/index.json wordt bijgewerkt.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONNECTORS = join(ROOT, "connectors");

/** Google: inloggen met een eigen OAuth-client in plaats van een serviceaccount. */
const GOOGLE_CLIENT_VARS = [
  {
    name: "CLIENT_ID",
    label: { en: "Client ID", nl: "Client-id" },
    description: {
      en: "From the OAuth app registration at the source.",
      nl: "Staat in het venster na het aanmaken van de OAuth-client in Google Cloud Console (eindigt op .apps.googleusercontent.com).",
    },
    secret: false,
    pattern: "\\.apps\\.googleusercontent\\.com$",
    patternHint: "Een Client-id van Google eindigt op .apps.googleusercontent.com",
  },
  {
    name: "CLIENT_SECRET",
    label: { en: "Client secret", nl: "Clientgeheim" },
    description: {
      en: "From the same app registration as the client ID.",
      nl: "Uit hetzelfde venster als de Client-id (begint meestal met GOCSPX-).",
    },
  },
];
const GOOGLE_SIGNIN_TITLE = { en: "Sign in with your own Google account", nl: "Inloggen met je eigen Google-account" };
const GOOGLE_LOGIN_NOTE = "Google toont dan mogelijk 'Google heeft deze app niet geverifieerd'. Dat is normaal voor je eigen app: klik op Geavanceerd en daarna op Ga naar Tailr Core.";
const googleAuth = (scopes) => ({
  type: "oauth2",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  authorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  scopes,
});
const googleConsentStep = {
  id: "consent",
  title: "Toestemmingsscherm instellen",
  instruction:
    "Al gedaan voor een andere Google-koppeling in hetzelfde project? Dan kun je deze stap overslaan. Anders: open de link en vul een app-naam (bijv. Tailr Core) en je e-mailadres in. Kies bij Doelgroep: Extern, en zet de publicatiestatus op In productie.",
  url: "https://console.cloud.google.com/auth/branding",
  note: "Laat je het op Testen staan, dan verloopt de login na 7 dagen.",
};
const googleClientStep = {
  id: "client",
  title: "OAuth-client aanmaken",
  instruction:
    "Open de link, klik op Client maken en kies Webapplicatie. Voeg het adres hieronder toe bij Geautoriseerde omleidings-URI's en klik op Maken. Heb je al een client voor Tailr Core in dit project, dan kun je die gebruiken.",
  url: "https://console.cloud.google.com/auth/clients",
  copy: { "Geautoriseerde omleidings-URI": "{{redirectUri}}" },
};

/**
 * Per hoofdconnector: welke variant(en) en wat daarin anders is.
 * - description: {main} wordt de beschrijving van de hoofdconnector (per taal).
 * - replaceVars: deze instelling van de hoofdconnector vervangen door deze lijst (op dezelfde plek).
 * - replaceText: zinnen in title, summary en description van tools en scripts; elke zin moet
 *   minstens één keer voorkomen, anders stopt het script (dan is de hoofdconnector veranderd).
 */
export const VARIANTS = {
  "google-analytics": [
    {
      id: "google-analytics-signin",
      name: "Google Analytics 4 (sign in)",
      variantTitle: GOOGLE_SIGNIN_TITLE,
      description: {
        en: "{main} Signed in with your own Google account instead of a service account.",
        nl: "{main} Ingelogd met je eigen Google-account in plaats van een serviceaccount.",
      },
      replaceVars: { SERVICE_ACCOUNT_KEY: GOOGLE_CLIENT_VARS },
      setup: {
        minutes: 12,
        prerequisites: [
          "Een Google-account met leestoegang tot de GA4-property",
          "Toegang tot Google Cloud Console (een nieuw project mag; gebruik je al een client voor Search Console, dan kun je die hergebruiken)",
        ],
        steps: [
          {
            id: "enable-data-api",
            title: "Google Analytics Data API inschakelen",
            instruction: "Open de link, kies bovenaan je project (of maak er een) en klik op Inschakelen.",
            url: "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com",
          },
          {
            id: "enable-admin-api",
            title: "Google Analytics Admin API inschakelen",
            instruction: "Open de link en klik op Inschakelen, in hetzelfde project. Hiermee kan Tailr Core je properties opzoeken.",
            url: "https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com",
          },
          googleConsentStep,
          googleClientStep,
        ],
        loginNote: GOOGLE_LOGIN_NOTE,
      },
      hosts: ["analyticsadmin.googleapis.com", "oauth2.googleapis.com", "accounts.google.com"],
      auth: googleAuth(["https://www.googleapis.com/auth/analytics.readonly"]),
      replaceText: [
        [
          "Laat zien welke Google Analytics-accounts en properties het serviceaccount kan zien, met hun id.",
          "Laat zien welke Google Analytics-accounts en properties er zijn, met hun id.",
        ],
        [
          "Shows which Google Analytics accounts and properties the service account can see, with their id.",
          "Shows which Google Analytics accounts and properties exist, with their id.",
        ],
        [
          "Alle GA4-accounts en properties waar het serviceaccount toegang toe heeft, met property-id.",
          "Alle GA4-accounts en properties waar het gekoppelde Google-account bij kan, met property-id.",
        ],
      ],
      readme: (main) => `# ${main.name}: inloggen met je eigen Google-account

Dit is een variant van [${main.name}](../${main.id}/README.md) met precies dezelfde functies. Het verschil zit alleen in het inloggen: in plaats van een serviceaccount maak je in Google Cloud Console een OAuth-client, en log je één keer in met een Google-account dat de property kan zien. Kies deze route als je geen beheerder van de property bent.

Dit bestand en \`connector.json\`, \`context.md\` en \`tools/\` in deze map worden gemaakt met \`node scripts/make-variants.mjs ${main.id}\`. Pas ze niet met de hand aan: wijzig de hoofdconnector en draai het script opnieuw (zie \`CONTRIBUTING.md\`).

Scope: \`${(main.auth?.scopes ?? []).join(" ")}\`. Wil je de login stoppen, trek dan de toegang in bij je Google-account (*Beveiliging → Apps van derden*).

Uitleg over de functies, persoonsgegevens en quota: zie de [README van ${main.name}](../${main.id}/README.md).
`,
    },
  ],
};

const KEY_ORDER_AFTER = "version";

function localized(template, main) {
  if (typeof template === "string") return template.replaceAll("{main}", typeof main === "string" ? main : main?.en ?? "");
  const out = {};
  for (const [lang, text] of Object.entries(template)) {
    const base = typeof main === "string" ? main : main?.[lang] ?? main?.en ?? "";
    out[lang] = text.replaceAll("{main}", base);
  }
  return out;
}

function replaceVars(vars, replacements) {
  const out = [];
  const seen = new Set();
  for (const v of vars ?? []) {
    if (replacements[v.name]) {
      out.push(...replacements[v.name]);
      seen.add(v.name);
    } else out.push(v);
  }
  for (const name of Object.keys(replacements)) if (!seen.has(name)) throw new Error(`replaceVars: the main connector has no setting ${name}`);
  return out;
}

/** Vervangt zinnen in title, summary en description (ook per taal) van tools en scripts. */
function replaceTexts(functions, pairs, used) {
  const swap = (text) => {
    if (typeof text !== "string") return text;
    let out = text;
    pairs.forEach(([from, to], i) => {
      if (out.includes(from)) {
        out = out.replaceAll(from, to);
        used[i] = true;
      }
    });
    return out;
  };
  const field = (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swap(v)])) : swap(value));
  return (functions ?? []).map((f) => {
    const copy = { ...f };
    for (const key of ["title", "summary", "description"]) if (key in copy) copy[key] = field(copy[key]);
    return copy;
  });
}

function buildVariant(main, config) {
  const used = config.replaceText.map(() => false);
  const replaced = {
    id: config.id,
    name: config.name,
    variantOf: main.id,
    variantTitle: config.variantTitle,
    description: localized(config.description, main.description),
    vars: replaceVars(main.vars, config.replaceVars ?? {}),
    setup: config.setup,
    hosts: config.hosts,
    auth: config.auth,
  };
  const out = {};
  for (const [key, value] of Object.entries(main)) {
    if (key === "variantOf" || key === "variantTitle") continue;
    if (key in replaced) out[key] = replaced[key];
    else if (key === "tools" || key === "scripts") out[key] = replaceTexts(value, config.replaceText, used);
    else out[key] = value;
    if (key === KEY_ORDER_AFTER) {
      out.variantOf = replaced.variantOf;
      out.variantTitle = replaced.variantTitle;
    }
  }
  for (const key of ["description", "setup", "hosts", "auth"]) if (!(key in out)) out[key] = replaced[key];
  const missing = config.replaceText.filter((_, i) => !used[i]).map(([from]) => from);
  if (missing.length) throw new Error(`${config.id}: these sentences are no longer in ${main.id}; update replaceText in scripts/make-variants.mjs:\n  ${missing.join("\n  ")}`);
  return out;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

/** De bestanden van de variant: { pad: inhoud }. */
function variantFiles(mainId, config) {
  const folder = join(CONNECTORS, mainId);
  const isFolder = existsSync(join(folder, "connector.json"));
  const manifestPath = isFolder ? join(folder, "connector.json") : join(CONNECTORS, `${mainId}.json`);
  if (!existsSync(manifestPath)) throw new Error(`Connector ${mainId} not found in connectors/`);
  const main = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (main.id !== mainId) throw new Error(`${manifestPath} has id ${main.id}, expected ${mainId}`);
  const variant = buildVariant(main, config);
  if (!isFolder) return { folder: false, main, files: { [`${config.id}.json`]: `${JSON.stringify(variant, null, 2)}\n` } };
  const files = { "connector.json": `${JSON.stringify(variant, null, 2)}\n` };
  for (const rel of listFiles(folder)) {
    if (rel === "connector.json" || rel === "README.md") continue;
    files[rel] = readFileSync(join(folder, rel), "utf8");
  }
  files["README.md"] = config.readme ? config.readme(main) : readFileSync(join(folder, "README.md"), "utf8");
  return { folder: true, main, files };
}

function updateIndex(entries) {
  const path = join(CONNECTORS, "index.json");
  const index = JSON.parse(readFileSync(path, "utf8"));
  for (const entry of entries) {
    const at = index.adapters.findIndex((a) => a.id === entry.id);
    if (at >= 0) index.adapters[at] = entry;
    else index.adapters.push(entry);
  }
  index.adapters.sort((a, b) => a.id.localeCompare(b.id));
  const text = `${JSON.stringify(index, null, 2)}\n`;
  return { path, text, changed: readFileSync(path, "utf8") !== text };
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const ids = args.filter((a) => !a.startsWith("--"));
for (const id of ids) if (!VARIANTS[id]) {
  console.error(`No variants configured for ${id}. Known: ${Object.keys(VARIANTS).join(", ")}`);
  process.exit(2);
}

let stale = 0;
const indexEntries = [];
for (const mainId of ids.length ? ids : Object.keys(VARIANTS)) {
  for (const config of VARIANTS[mainId]) {
    const { folder, main, files } = variantFiles(mainId, config);
    indexEntries.push({ id: config.id, file: folder ? `${config.id}/connector.json` : `${config.id}.json`, version: main.version });
    const target = folder ? join(CONNECTORS, config.id) : CONNECTORS;
    const differs = Object.entries(files).some(([rel, text]) => !existsSync(join(target, rel)) || readFileSync(join(target, rel), "utf8") !== text)
      || (folder && existsSync(target) && listFiles(target).some((rel) => !(rel in files)))
      || (folder && existsSync(join(CONNECTORS, `${config.id}.json`)));
    if (check) {
      if (differs) {
        console.error(`✗ ${config.id} is out of date with ${mainId}: run node scripts/make-variants.mjs ${mainId}`);
        stale++;
      } else console.log(`✓ ${config.id}`);
      continue;
    }
    if (folder) {
      rmSync(target, { recursive: true, force: true });
      rmSync(join(CONNECTORS, `${config.id}.json`), { force: true });
    }
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(target, rel)), { recursive: true });
      writeFileSync(join(target, rel), text);
    }
    console.log(`${differs ? "✓ wrote" : "✓ unchanged"} ${folder ? `connectors/${config.id}/` : `connectors/${config.id}.json`} (${Object.keys(files).length} files, from ${mainId} ${main.version})`);
  }
}

const index = updateIndex(indexEntries);
if (check) {
  if (index.changed) {
    console.error("✗ connectors/index.json does not list the variants with the right file and version");
    stale++;
  }
  process.exit(stale ? 1 : 0);
}
if (index.changed) {
  writeFileSync(index.path, index.text);
  console.log("✓ updated connectors/index.json");
}
