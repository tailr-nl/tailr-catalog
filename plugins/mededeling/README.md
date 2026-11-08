# Mededeling

Een korte mededeling bovenaan elke pagina van Tailr Core, bijvoorbeeld *"Vanaf maandag kun je ook bij Exact."* Vroeger zat dit in de kern (*Bericht aan iedereen* op het Beheeroverzicht); nu is het een plugin, want het hoort niet bij toegang.

## Wat het doet

- **Tekst in markdown,** in het Nederlands en eventueel in het Engels. Zonder Engelse tekst ziet iedereen de Nederlandse. Onder de tekst staat wie hem schreef en wanneer.
- **Einddatum** (optioneel): tot en met die dag, in de tijdzone van de server. Daarna ziet niemand hem meer; op het tabblad *Mededeling* staat dan *Verlopen*.
- **Doelgroep:** iedereen, of alleen bepaalde rollen.
- **Kleur:** informatie, goed nieuws of waarschuwing.
- **Wegklikken** (standaard aan): wie op *Sluiten* drukt, ziet deze mededeling niet meer. Wijzig je hem, dan ziet iedereen hem weer.
- Beheerders zien bij de mededeling een knop *Aanpassen*.

De mededeling staat op de plek `banner` (haakje F, `api.slots`). De kern tekent het blok met zijn veilige markdown-omzetter: alle tekst ge-escaped, geen ruwe HTML, alleen veilige links.

## Instellen

1. Installeer de plugin onder *Plugins → Beschikbaar*.
2. Op de pluginpagina, tabblad *Instellingen* (`/plugins/mededeling`; via *Plugins → Geïnstalleerd* → *Beheren*, of *Aanpassen* op het tabblad *Mededeling* of bij de banner) schrijf je de tekst, kies je de einddatum, de rollen en de kleur, en sla je op. De kern controleert de waarden, vraagt de sudo-bevestiging en zet elke wijziging in het auditlog (sinds 1.2.0, `api.settings.define`, plugin-API 1.8). Het voorbeeld van de markdown staat in het veld zelf.
3. Weghalen: maak de Nederlandse tekst leeg en sla op.

| Veld | Standaard | |
| --- | --- | --- |
| Tekst (Nederlands) | leeg | markdown, hooguit 2000 tekens; leeg = geen mededeling |
| Tekst (Engels) | leeg | zonder Engelse tekst ziet iedereen de Nederlandse |
| Einddatum | leeg | `JJJJ-MM-DD` (of `DD-MM-JJJJ`), tot en met die dag; leeg = geen einde. Klopt de datum niet, dan ziet niemand de mededeling en staat dat op het tabblad *Mededeling* en in de log |
| Voor wie | niemand aangevinkt = iedereen | rollen |
| Kleur | informatie | informatie, goed nieuws of waarschuwing |
| Wegklikken toestaan | aan | |

Het tabblad *Mededeling* op de pluginpagina toont hoe hij er nu voor staat (voor wie, tot wanneer, hoe vaak weggeklikt, verlopen) en een voorbeeld in de gekozen kleur. Bij het bijwerken van 1.1.x gaat de bestaande mededeling eenmalig mee, en wie hem al had weggeklikt, ziet hem niet opnieuw.

Uitzetten (*Uitzetten* in het menu van de pluginpagina of van zijn rij op *Plugins → Geïnstalleerd*) haalt de banner weg. De instellingen blijven bewaard.

## API

| Route | Wie | Wat |
| --- | --- | --- |
| `GET`/`PUT /api/admin/plugins/mededeling/settings` | beheerder | het tabblad *Instellingen* van de kern: `PUT` met `{ values: { textNl, textEn, until, roles, tone, dismissible } }` |
| `GET /api/admin/p/mededeling/status?locale=nl` | beheerder | `{ announcement, expired, dismissed, today, html }` voor het scherm |
| `POST /api/p/mededeling/dismiss` | gebruiker | deze versie wegklikken |

Test: `node scripts/e2e-mededeling.mjs` in Tailr Core (start zelf een gateway). Let op: die test gebruikt nog de routes van 1.1.x (`/api/admin/p/mededeling/settings`).
