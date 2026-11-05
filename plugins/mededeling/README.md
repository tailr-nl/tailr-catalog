# Mededeling

Een korte mededeling bovenaan elke pagina van Tailr Core, bijvoorbeeld *"Vanaf maandag kun je ook bij Exact."* Tot zat dit in de kern (*Bericht aan iedereen* op het Beheeroverzicht); nu is het een plugin, want het hoort niet bij toegang.

## Wat het doet

- **Tekst in markdown,** in het Nederlands en eventueel in het Engels. Zonder Engelse tekst ziet iedereen de Nederlandse. Onder de tekst staat wie hem schreef en wanneer.
- **Einddatum** (optioneel): tot en met die dag, in de tijdzone van de server. Daarna ziet niemand hem meer; in het beheerscherm staat dan *Verlopen*.
- **Doelgroep:** iedereen, of alleen bepaalde rollen.
- **Kleur:** informatie, goed nieuws of waarschuwing.
- **Wegklikken** (standaard aan): wie op *Sluiten* drukt, ziet deze mededeling niet meer. Sla je hem opnieuw op, dan ziet iedereen hem weer.
- Beheerders zien bij de mededeling een knop *Aanpassen*.

De mededeling staat op de plek `banner` (haakje F, `api.slots`). De kern tekent het blok met zijn veilige markdown-omzetter: alle tekst ge-escaped, geen ruwe HTML, alleen veilige links.

## Instellen

1. Installeer de plugin in de *Catalogus*, tabblad *Plugins*, en herstart.
2. Onder **Plugins → Mededeling** schrijf je de tekst, kies je de einddatum, de doelgroep en de kleur, en sla je op. *Weghalen* haalt hem weg.

Uitzetten in de Catalogus haalt de banner weg (na de herstart). De instelling blijft bewaard.

## API

| Route | Wie | Wat |
| --- | --- | --- |
| `GET /api/admin/p/mededeling/settings` | beheerder | `{ announcement, expired, dismissed, today }` |
| `PUT /api/admin/p/mededeling/settings` | beheerder | `{ text: { nl, en? }, until: "JJJJ-MM-DD" \| null, roles: [rol-id], tone, dismissible }` |
| `DELETE /api/admin/p/mededeling/settings` | beheerder | weghalen |
| `POST /api/p/mededeling/preview` | beheerder | `{ text }` → `{ html }`; een gewone route, zodat het voorbeeld niet in het auditlog komt |
| `POST /api/p/mededeling/dismiss` | gebruiker | deze versie wegklikken |

Test: `node scripts/e2e-mededeling.mjs` (start zelf een gateway).
