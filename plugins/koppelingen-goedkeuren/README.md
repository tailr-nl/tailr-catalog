# Koppelingen goedkeuren

Nieuwe koppelingen, connectors (opslaan en bijwerken) en Git-bronnen die via de AI komen, wachten op goedkeuring van een beheerder. Standaard is dat een andere beheerder dan de aanvrager.

- **Waar:** de verzoeken staan in **Te bevestigen** van Tailr Core, met *Van: Koppelingen goedkeuren* (sinds 2.0.0, via `api.pending`). Daar bevestig je ze of wijs je ze af, eventueel met een toelichting. Ze tellen mee in de teller in het menu.
- **Koppeling via de AI:** keur je vooraf goed. De AI krijgt toch een invullink, en de aanvrager mag die connector daarna 24 uur opzetten.
- **Connector of Git-bron:** na goedkeuren voert de plugin het verzoek uit namens de aanvrager. Lukt dat niet, dan staat het item op *Mislukt* met de reden.
- **Mail:** goedkeurders krijgen een mail van Tailr Core bij een nieuw verzoek; de aanvrager krijgt een mail over de beslissing (als er een mailserver is).
- **Geheimen:** tokens uit een verzoek worden alleen versleuteld bij het item bewaard en na de beslissing gewist.
- **Instellingen** op de pluginpagina, tabblad *Instellingen* (`/plugins/koppelingen-goedkeuren`, via *Plugins → Geïnstalleerd* → *Beheren*). De kern controleert de waarden, vraagt de sudo-bevestiging en zet elke wijziging in het auditlog (sinds 2.2.0, `api.settings.define`, plugin-API 1.8):
  - **wat wacht op goedkeuring:** alleen wat via de AI komt (standaard), of altijd;
  - **of de aanvrager zelf mag goedkeuren** (standaard niet; handig met één beheerder).
- **Het tabblad *Koppelingen goedkeuren*** op de pluginpagina toont hoe het nu staat en verwijst naar *Te bevestigen*. Is er maar één beheerder en mag de aanvrager niet zelf goedkeuren, dan staat er een waarschuwing op het *Beheeroverzicht* (zijn eigen verzoeken blijven dan wachten).
- **Wie mag goedkeuren:** alle beheerders. Dat is geen instelling meer (sinds 2.2.0): een plugin regelt geen toegang in zijn instellingen.
- **Bijwerken van 2.1.x:** de oude instellingen gaan bij het laden eenmalig naar de losse velden. Waren alleen bepaalde beheerders goedkeurder, dan staat er een waarschuwing in de log van de plugin (tabblad *Log*): nieuwe verzoeken kunnen nu alle beheerders goedkeuren.
- **Bijwerken van 1.x:** open verzoeken uit de eigen lijst gaan bij het opstarten vanzelf naar *Te bevestigen*.
