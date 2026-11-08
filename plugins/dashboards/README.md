# Mijn dashboards

Medewerkers laten hun AI-tool (bijvoorbeeld Claude.ai, zonder iets te installeren) een dashboard maken: *"maak een dashboard met de omzet per week en de openstaande facturen"*. Het ontwerp en de afweging over veiligheid staan in `docs/dashboards.md` (Tailr Core).

## Hoe het werkt

1. De AI bouwt een HTML-pagina en bewaart hem met `dashboards__save`, met in `uses` de functies die de pagina aanroept.
2. Het dashboard staat in *Mijn dashboards* bij **Te bevestigen**. De medewerker ziet welke functies het gebruikt, kan de code en een voorbeeld zonder data bekijken, en bevestigt (alleen in de beheeromgeving, niet via de AI).
3. Daarna opent hij het onder *Mijn dashboards*. Het draait in het afgeschermde frame van Tailr Core: geen netwerk, geen cookies, geen toegang tot de beheeromgeving. Data komt alleen via `tailr.call(...)`, alleen voor functies uit `uses`, en met de rechten van de kijker.
4. Een nieuwe versie (de AI slaat met dezelfde naam opnieuw op) is ook eerst te bevestigen. Oudere bevestigde versies kun je terugzetten. Dashboards kun je uitzetten en verwijderen.

## Instellen

1. Installeer de plugin onder *Plugins → Beschikbaar*.
2. Geef rollen toegang onder **Toegang → Rechten**, rij *Mijn dashboards*: *Schrijven* om dashboards te maken (`dashboards__save`), *Lezen* voor `dashboards__list` en `dashboards__get`. Wie dashboards mag maken is dus een recht, geen instelling van de plugin.
3. De instellingen staan op de pluginpagina, tabblad *Instellingen* (`/plugins/dashboards`): via *Plugins → Geïnstalleerd* → *Beheren*, of het menu-item *Dashboards* voor beheerders. De kern toont en controleert de velden, vraagt de sudo-bevestiging en zet elke wijziging in het auditlog (sinds 1.3.0, `api.settings.define`, plugin-API 1.8):
   - **Maximale grootte per dashboard** (standaard 200 kB, hooguit 2048 kB).
   - **Bibliotheken** uit de vaste lijst van Tailr Core (standaard Chart.js).
   - **Alleen leesfuncties** (standaard aan): een dashboard kan dan niets wijzigen.

De plugin zelf aan- en uitzetten doe je in het menu van de pluginpagina of van zijn rij op *Plugins → Geïnstalleerd* (*Uitzetten*); een eigen aan/uit heeft hij niet meer. Een beheerder ziet op *Mijn dashboards* ook hoeveel dashboards er zijn, van hoeveel medewerkers, en hoeveel er wachten op bevestiging door hun eigenaar.

**Bijwerken van 1.2.x:** de oude instellingen (één object `config`) gaan bij het laden eenmalig naar de losse velden. Twee oude instellingen bestaan niet meer; staat er een waarschuwing in de log van de plugin (tabblad *Log* op de pluginpagina), dan:
- *Dashboards aanzetten* stond uit: zet de plugin uit op *Plugins → Geïnstalleerd* (*Uitzetten* in het menu);
- *Wie mag dashboards maken* was beperkt tot rollen: geef alleen die rollen *Schrijven* op *Mijn dashboards* onder *Toegang → Rechten*.

## Functies voor de AI

| Functie | Niveau | Wat |
| --- | --- | --- |
| `dashboards__save` | schrijven | Een dashboard of nieuwe versie opslaan; altijd te bevestigen |
| `dashboards__list` | lezen | De eigen dashboards |
| `dashboards__get` | lezen | HTML en `uses` van een dashboard, om bij te werken |

**Uitleg voor de AI** (`api.help`, sinds plugin-API 1.3): een regel in de MCP-instructies (*"offer to build a dashboard with dashboards__save"*) en het onderwerp `tailr__help topic=dashboards__building`. Alleen voor wie een functie van deze plugin mag gebruiken.

In de pagina: `await tailr.call("webshop__list_orders", { status: "open" })`, `await tailr.tools()`, `tailr.locale`, `tailr.theme`. Met `libraries: ["chartjs"]` staat `Chart` klaar.

## Niet in deze versie

Delen met collega's, een server koppelen als werkplaats, en automatisch verversen. Zie *Buiten scope* in het ontwerp.
