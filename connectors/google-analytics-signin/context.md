Google Analytics 4 (Data API v1beta):

Welke functie:
- Gebruik run_report_flat voor analyses en antwoorden in een gesprek: rijen als gewone objecten, metrics als getal. run_report is dezelfde vraag in de ruwe vorm van Google (kopregels en rijen apart), voor dashboards en tools.
- Twijfel je over de naam van een dimensie of metric, of zoek je een eigen dimensie (bijv. auteur): gebruik eerst find_dimensions_metrics. Gok geen namen.
- Meldt Google dat een combinatie niet mag: check_compatibility met compatibilityFilter "COMPATIBLE" laat zien wat wel kan.
- Meerdere invalshoeken over dezelfde periode: batch_run_reports (tot 5 rapporten). Een tabel met een dimensie in de kolommen: run_pivot_report.
- "Nu", "op dit moment", "live": run_realtime_report. Dat toont alleen de laatste 30 minuten, met een eigen, kleinere set namen (unifiedScreenName in plaats van pagePath; geen sessies of datums).
- Een property-id is alleen het nummer. Zonder property gebruikt Tailr Core de ingestelde property; andere properties vind je met list_properties.

Datums (dateRanges, startDate en endDate zijn allebei inclusief):
- today, yesterday, NdaysAgo (bijv. 7daysAgo, 28daysAgo) of JJJJ-MM-DD. "Vorige maand" reken je zelf om naar de eerste en laatste dag van die maand.
- Datums volgen de tijdzone van de property (staat in metadata.timeZone van het antwoord).
- De dimensie date komt terug als JJJJMMDD (20261101).
- Data van vandaag en gisteren is nog onvolledig: Google verwerkt gegevens met 24 tot 48 uur vertraging. Eindig een vergelijking daarom liefst op een dag eerder, en zeg het erbij als je vandaag of gisteren meeneemt.

Veelgebruikte dimensies: date, sessionDefaultChannelGroup (kanaal), sessionSource, sessionSourceMedium, sessionCampaignName, landingPagePlusQueryString (landingspagina), pagePath, pageTitle, country, deviceCategory (desktop, mobile, tablet), eventName.
Veelgebruikte metrics: activeUsers (gebruikers), newUsers, sessions, engagedSessions, engagementRate (0 tot 1), averageSessionDuration (seconden), screenPageViews (paginaweergaven), eventCount, keyEvents (conversies; de oude naam conversions bestaat niet meer), totalRevenue.

Lezen van het antwoord:
- rowCount is het totaal aantal rijen, ook voorbij limit. Is complete false, vraag dan de volgende pagina met offset = nextOffset, of zeg dat de lijst is ingekort.
- Totalen: vraag metricAggregations ["TOTAL"]; tel gebruikers niet zelf op over rijen (één gebruiker kan op meerdere dagen of pagina's voorkomen).
- metadata.dataLossFromOtherRow = true: een deel zit in een rij "(other)". metadata.subjectToThresholding = true: Google laat kleine aantallen weg om bezoekers niet herkenbaar te maken. Noem dat bij je antwoord.
- "(not set)" is een gewone waarde: Google kende de bron, pagina of campagne niet.

Quota: een standaard property heeft 200.000 tokens per dag en 40.000 per uur; een gewoon rapport kost meestal 1 tot 10 tokens, grote rapporten (lange periode, veel dimensies) meer. Realtime heeft een eigen potje. Met returnPropertyQuota: true zie je de stand. Krijg je een quotafout, wacht dan en vraag kleiner (kortere periode, minder dimensies, lagere limit).

Inrichting van de property (Admin API):
- Vraag list_key_events op voordat je de metric keyEvents duidt: die telt alle key events bij elkaar, en welke gebeurtenissen dat zijn (en of ze per gebeurtenis of per sessie tellen) verschilt per property. Eén key event apart: metric keyEvents:<eventName>.
- Eigen dimensies en metrics: list_custom_dimensions en list_custom_metrics geven de parameterName; in een rapport heet die customEvent:<parameterName> (scope EVENT), customUser:<parameterName> (USER) of customItem:<parameterName> (ITEM). find_dimensions_metrics vindt dezelfde namen op een zoekwoord.
- get_property geeft de tijdzone en valuta van de property: noem de valuta bij bedragen en reken datums niet om naar een andere tijdzone.
- get_data_retention verklaart waarom analyses per gebruiker over een oudere periode leeg zijn (Google bewaart gebruikersgegevens 2 of 14 maanden); totalen in gewone rapporten blijven wel beschikbaar.
- list_data_streams zegt welke websites en apps in deze property meten (measurement-id G-…); gebruik dit als iemand twijfelt of een site of app wel in deze property zit.
- Het toegangsrapport (run_access_report) gaat over collega's die rapporten bekeken en is alleen voor apps en dashboards. Noem geen e-mailadressen van GA-gebruikers in een antwoord, tenzij de gebruiker er uitdrukkelijk om vraagt.

Persoonsgegevens: GA-rapporten bevatten geen gegevens van individuele personen, alleen tellingen over groepen bezoekers. Uitzondering: een eigen (custom) dimensie kan iets persoonlijks bevatten, zoals een klant- of gebruikers-id. Vraag die niet per persoon op en noem zulke waarden niet in een antwoord.

Tailr Core wijzigt niets in Google Analytics: alle functies lezen alleen.
