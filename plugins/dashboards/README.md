# Mijn dashboards

Medewerkers laten hun AI-tool (bijvoorbeeld Claude.ai, zonder iets te installeren) een dashboard maken: *"maak een dashboard met de omzet per week en de openstaande facturen"*. Het ontwerp en de afweging over veiligheid staan in `docs/dashboards.md` (Tailr Core).

## Hoe het werkt

1. De AI bouwt een HTML-pagina en bewaart hem met `dashboards__save`, met in `uses` de functies die de pagina aanroept.
2. Het dashboard staat in *Mijn dashboards* bij **Te bevestigen**. De medewerker ziet welke functies het gebruikt, kan de code en een voorbeeld zonder data bekijken, en bevestigt (alleen in de beheeromgeving, niet via de AI).
3. Daarna opent hij het onder *Mijn dashboards*. Het draait in het afgeschermde frame van Tailr Core: geen netwerk, geen cookies, geen toegang tot de beheeromgeving. Data komt alleen via `tailr.call(...)`, alleen voor functies uit `uses`, en met de rechten van de kijker.
4. Een nieuwe versie (de AI slaat met dezelfde naam opnieuw op) is ook eerst te bevestigen. Oudere bevestigde versies kun je terugzetten. Dashboards kun je uitzetten en verwijderen.

## Instellen

1. Installeer de plugin in de *Catalogus*, tabblad *Plugins*, en herstart.
2. Geef rollen toegang onder **Toegang → Rechten**, rij *Mijn dashboards*: *Schrijven* om dashboards te maken (`dashboards__save`), *Lezen* voor `dashboards__list` en `dashboards__get`.
3. Onder **Plugins → Dashboards (instellingen)**:
   - **Aan of uit.**
   - **Wie mag maken:** leeg = iedereen met recht in Toegang; anders alleen de gekozen rollen.
   - **Maximale grootte** (standaard 200 kB, hooguit 2 MB).
   - **Bibliotheken** uit de vaste lijst van Tailr Core (nu Chart.js).
   - **Alleen leesfuncties** (standaard aan): een dashboard kan dan niets wijzigen.

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
