# Koppelingen goedkeuren

Nieuwe koppelingen, connectors (opslaan en bijwerken) en Git-bronnen die via de AI komen, wachten op goedkeuring van een beheerder. Standaard is dat een andere beheerder dan de aanvrager.

- **Waar:** de verzoeken staan in **Te bevestigen** van Tailr Core, met *Van: Koppelingen goedkeuren* (sinds 2.0.0, via `api.pending`). Daar bevestig je ze of wijs je ze af, eventueel met een toelichting. Ze tellen mee in de teller in het menu.
- **Koppeling via de AI:** keur je vooraf goed. De AI krijgt toch een invullink, en de aanvrager mag die connector daarna 24 uur opzetten.
- **Connector of Git-bron:** na goedkeuren voert de plugin het verzoek uit namens de aanvrager. Lukt dat niet, dan staat het item op *Mislukt* met de reden.
- **Mail:** goedkeurders krijgen een mail van Tailr Core bij een nieuw verzoek; de aanvrager krijgt een mail over de beslissing (als er een mailserver is).
- **Geheimen:** tokens uit een verzoek worden alleen versleuteld bij het item bewaard en na de beslissing gewist.
- **Instellingen**, onder Beheer → *Koppelingen goedkeuren* (het enige wat dat scherm nog doet):
  - alleen via de AI, of altijd;
  - wie mag goedkeuren (geldt voor nieuwe verzoeken);
  - of de aanvrager zelf mag goedkeuren (handig met één beheerder).
- **Bijwerken van 1.x:** open verzoeken uit de eigen lijst gaan bij het opstarten vanzelf naar *Te bevestigen*.
