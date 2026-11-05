# Extra logging

Stuurt elke functie-aanroep en elke beheerwijziging door naar een bestand (JSON per regel), een webhook (POST met JSON) en/of syslog (UDP, RFC 5424). De log van Tailr Core zelf blijft bestaan.

- Instellen onder Beheer → *Extra logging*, met een knop voor een testbericht.
- Een geheim voor de webhook voegt `X-Tailr-Signature: sha256=<HMAC van de body>` toe.
- Bij leesaanroepen gaan alleen de namen van de parameters mee, zoals in de log van Tailr Core.
- Het bestandspad moet absoluut zijn en schrijfbaar voor de gateway, bijvoorbeeld `/data/logs/tailr-core.jsonl`.
- **Klopt niet:** met de functie `extra-logging__feedback` meldt een gebruiker via zijn AI dat een antwoord niet klopt. De meldingen staan op het scherm van de plugin en gaan als `type: "feedback"` naar dezelfde bestemmingen. Geef rollen toegang onder *Toegang → Rechten*, in de rij *Extra logging* (niveau Schrijven).
