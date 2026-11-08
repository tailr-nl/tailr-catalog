# Handleiding

Een handleiding voor iedereen in je organisatie, onder *Handleiding* in het menu: wat je met Tailr Core kunt, de koppelingen waar de lezer bij kan met voorbeeldvragen, en bij wie hij terecht kan. Vroeger zat dit in de kern; nu is het een plugin, want het is inhoud en geen toegang.

## Wat het doet

- **Standaardtekst per taal.** De plugin brengt een tekst mee in het Nederlands en het Engels (`content/handleiding.<taal>.md`). Een nieuwe versie van de plugin kan die tekst bijwerken.
- **Aanpassen in markdown.** Op de pluginpagina, tabblad *Handleiding aanpassen* (via *Plugins → Geïnstalleerd* → *Beheren*), pas je de tekst per taal aan, met een voorbeeld ernaast. *Terug naar standaard* haalt je aanpassing weg.
- **Na een update.** Is de standaardtekst veranderd sinds je hem aanpaste, dan zie je een melding met de verschillen per regel. Neem over wat je wilt en kies *Bekeken, mijn tekst houden*.
- **Placeholders,** per lezer ingevuld:

  | Placeholder | Wordt |
  | --- | --- |
  | `{{organisatie}}` (`{{organisation}}`) | de naam van de organisatie uit het beheerscherm, anders "je organisatie" |
  | `{{beheerder}}` (`{{admin}}`) | het contact uit het beheerscherm, anders de beheerders met hun e-mailadres |
  | `{{koppelingen}}` (`{{connections}}`) | de koppelingen waar de lezer bij kan, met zijn niveau en tot twee voorbeeldvragen per koppeling |

  `{{koppelingen}}` komt uit `api.users.tools`: precies wat de AI-tool van de lezer krijgt, met zijn rollen en uitzonderingen. Mijn functies en functies van plugins staan er niet in.
- **Veilige opmaak.** De markdown gaat naar HTML met de omzetter van de kern (`api.markdown.render`): alle tekst ge-escaped, geen ruwe HTML, alleen veilige links.
- **Op *Verbonden tools*** (in het menu onder je naam) staat een blok met een link naar de handleiding (plek `connect`).

## Voor de AI

De functie `handleiding__read` (niveau *lezen*) geeft de handleiding van de gebruiker in markdown, ingevuld met zijn eigen rechten. De AI krijgt in de MCP-instructies een regel wanneer hij hem leest (`api.help.instructions`).

Geef rollen toegang onder **Toegang → Rechten**, rij *Handleiding*, niveau *Lezen*. Zonder dat recht ziet de AI de functie en de regel niet; de pagina in het menu werkt dan gewoon.

## Instellen

1. Installeer de plugin onder *Plugins → Beschikbaar* (of via *Aanbevolen plugins* in de welkomstwizard).
2. Vul op het tabblad *Handleiding aanpassen* van de pluginpagina de naam van de organisatie en het contact in, en pas de tekst aan als je wilt.
3. Geef rollen eventueel toegang tot `handleiding__read` (zie hierboven).

Uitzetten (*Uitzetten* in het menu van de pluginpagina of van zijn rij op *Plugins → Geïnstalleerd*) haalt na de herstart het menu-item, het blok op *Verbonden tools* en de functie weg. De aangepaste tekst blijft bewaard (`tp_handleiding_texts`).

## API

| Route | Wie | Wat |
| --- | --- | --- |
| `GET /api/p/handleiding/guide?locale=nl` | iedereen | `{ locale, markdown, html, customized, canEdit }` |
| `GET /api/admin/p/handleiding/settings` | beheerder | naam, contact, en per taal de tekst, de standaard en de verschillen |
| `PUT /api/admin/p/handleiding/settings` | beheerder | `{ orgName, contact }` |
| `PUT /api/admin/p/handleiding/text/<taal>` | beheerder | `{ text }`: aanpassing opslaan |
| `DELETE /api/admin/p/handleiding/text/<taal>` | beheerder | terug naar de standaard |
| `POST /api/admin/p/handleiding/text/<taal>/accept-default` | beheerder | nieuwe standaard bekeken |
| `POST /api/p/handleiding/preview` | beheerder | `{ text, locale }` → `{ html }`; een gewone route, zodat het voorbeeld niet in het auditlog komt |

Test: `node scripts/e2e-handleiding.mjs` (start zelf een gateway).
