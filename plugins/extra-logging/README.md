# Extra logging

Stuurt elke functie-aanroep en elke beheerwijziging door naar een bestand (JSON per regel), een webhook (POST met JSON) en/of syslog (UDP, RFC 5424). De log van Tailr Core zelf blijft bestaan.

- **Instellen** op de pluginpagina, tabblad *Instellingen* (`/plugins/extra-logging`, via *Plugins → Geïnstalleerd* → *Beheren*), in twee kaarten:
  - *Wat:* functie-aanroepen (standaard aan), alleen schrijfacties (standaard uit), beheerwijzigingen (standaard aan);
  - *Waarheen:* bestand, webhook, geheim voor de webhook en syslog (standaard leeg: nergens heen).

  De kern controleert de waarden, vraagt de sudo-bevestiging en zet elke wijziging in het auditlog; het geheim gaat nooit terug naar de browser (sinds 1.3.0, `api.settings.define`, plugin-API 1.8). Bij het bijwerken van 1.2.x gaan de oude instellingen eenmalig mee.
- **Het tabblad *Extra logging*** op de pluginpagina toont wat er waarheen gaat, hoeveel er sinds de herstart is verstuurd of mislukt, een knop voor een testbericht, en de meldingen *Klopt niet*. Klopt een bestemming niet (een relatief pad, een adres zonder http(s), syslog niet als host of host:poort), dan staat dat bovenaan dat tabblad en in de log van de plugin (tabblad *Log*), en wordt die bestemming overgeslagen tot je hem aanpast.
- Een geheim voor de webhook voegt `X-Tailr-Signature: sha256=<HMAC van de body>` toe.
- Bij leesaanroepen gaan alleen de namen van de parameters mee, zoals in de log van Tailr Core.
- Het bestandspad moet absoluut zijn en schrijfbaar voor de gateway, bijvoorbeeld `/data/logs/tailr-core.jsonl`.
- **Klopt niet:** met de functie `extra-logging__feedback` meldt een gebruiker via zijn AI dat een antwoord niet klopt. De meldingen staan op het tabblad *Extra logging* en gaan als `type: "feedback"` naar dezelfde bestemmingen. Geef rollen toegang onder *Toegang → Rechten*, in de rij *Extra logging* (niveau Schrijven).
