# Google Analytics 4

Rapporten uit Google Analytics 4 via de Data API (v1beta): bezoekers, sessies, bronnen, pagina's, key events en omzet over elke periode, realtime bezoekers, draaitabellen, meerdere rapporten in één aanroep, en zoeken in alle dimensies en metrics van de property. Daarnaast de inrichting van de property via de Admin API (v1beta): key events, eigen dimensies en metrics, gegevensstromen, bewaartermijn en koppelingen met Google Ads en Firebase. En uit de alpha-API's van Google: trechterrapporten, de quotastand, doelgroepen, kanaalgroepen, berekende metrics, annotaties, BigQuery-koppelingen, attributie-instellingen, verbeterde meting en gebeurtenisregels. Alles alleen lezen: Tailr Core wijzigt niets in Google Analytics.

Gebaseerd op de openbare Data API en Admin API van Google; beschrijvingen zijn eigen tekst.

## Instellen

De connector logt in met een **serviceaccount** (een technisch account met een JSON-sleutel), zodat de koppeling niet afhangt van één persoon en de login niet verloopt. Het stappenplan in Tailr Core loopt de stappen één voor één door:

1. Schakel in Google Cloud Console de Google Analytics Data API en Admin API in.
2. Maak een serviceaccount en download een JSON-sleutel.
3. Geef het serviceaccount in Google Analytics de rol **Kijker** op de property (*Beheerder → Toegangsbeheer voor property*).
4. Plak de sleutel op de invulpagina in Tailr Core en kies daarna de property uit de lijst.

Ben je geen beheerder van de property, of wil je liever met je eigen Google-account inloggen? Gebruik dan de variant [Inloggen met je eigen Google-account](../google-analytics-signin/). Die heeft dezelfde functies, met een OAuth-client in plaats van een serviceaccount.

Scope: `https://www.googleapis.com/auth/analytics.readonly`.

## Functies

| Functie | Wat | Voor |
| --- | --- | --- |
| `list_properties` | Accounts en properties met hun id (Admin API) | iedereen |
| `run_report_flat` | Rapport over een periode, als gewone tabel (code-functie) | iedereen, aanbevolen voor de AI |
| `run_report` | Hetzelfde rapport in de ruwe vorm van Google | iedereen |
| `run_realtime_report` | Bezoekers van de laatste 30 minuten, nooit uit de cache | iedereen |
| `run_pivot_report` | Draaitabel, bijvoorbeeld pagina's tegen apparaattype | iedereen |
| `batch_run_reports` | Tot vijf rapporten in één aanroep | iedereen |
| `check_compatibility` | Controleert of dimensies en metrics samen in één rapport mogen | iedereen |
| `find_dimensions_metrics` | Zoekt in alle dimensies en metrics van de property, ook eigen definities (code-functie) | iedereen |
| `get_metadata` | De volledige lijst van dimensies en metrics (groot) | alleen *Apps (API)* |

Inrichting van de property (Admin API v1beta, `analyticsadmin.googleapis.com`):

| Functie | Wat | Voor |
| --- | --- | --- |
| `get_property` | Naam, tijdzone, valuta, branche en aanmaakdatum van de property | iedereen |
| `get_data_retention` | Hoe lang Google gebeurtenis- en gebruikersgegevens bewaart | iedereen |
| `list_data_streams` | Welke websites en apps meten, met measurement-id (G-…) | iedereen |
| `get_data_stream` | Eén gegevensstroom op nummer | iedereen |
| `list_key_events` | Welke gebeurtenissen als key event (conversie) tellen, en hoe | iedereen |
| `list_custom_dimensions` | Eigen dimensies met `parameterName` en scope | iedereen |
| `list_custom_metrics` | Eigen metrics met eenheid | iedereen |
| `list_google_ads_links` | Gekoppelde Google Ads-accounts (zonder e-mailadres van de maker) | iedereen |
| `list_firebase_links` | De Firebase-koppeling, als die er is | iedereen |
| `run_access_report` | Wie wanneer rapportgegevens opvroeg (toegangslog) | alleen *Apps (API)* |

Alpha-API's (Data API v1alpha en Admin API v1alpha). Kanttekening: Google noemt deze onderdelen *alpha* en kan paden, velden en gedrag zonder aankondiging veranderen. Elke `description` voor de AI begint daarom met "Alpha-API van Google: kan veranderen.", en `context.md` vraagt de AI bij een onverwachte fout te zeggen dat het om een alpha-functie gaat. Breekt Google iets, dan is het een patch in deze catalogus.

| Functie | Wat | Voor |
| --- | --- | --- |
| `run_funnel_report` | Trechter: hoeveel gebruikers elke stap halen en waar ze afhaken, ook per dag of uitgesplitst | iedereen |
| `get_quota` | Quotastand voor rapporten, realtime en trechters, nooit uit de cache | iedereen |
| `list_audiences` | Doelgroepdefinities (niet de leden), voor de dimensie `audienceName` | iedereen |
| `list_channel_groups` | Standaard- en eigen kanaalgroepen met hun regels | iedereen |
| `list_calculated_metrics` | Eigen berekende metrics met formule (`calcMetric:<id>`) | iedereen |
| `list_annotations` | Notities op de tijdlijn die pieken en dalen verklaren, met `filter` | iedereen |
| `list_bigquery_links` | Of en hoe de ruwe gegevens naar BigQuery gaan | iedereen |
| `get_attribution_settings` | Attributiemodel en terugkijkperioden | iedereen |
| `get_enhanced_measurement` | Welke gebeurtenissen een webstroom automatisch meet | iedereen |
| `list_event_create_rules` | Regels die uit een gebeurtenis een nieuwe maken | iedereen |
| `list_event_edit_rules` | Regels die gebeurtenissen hernoemen of parameters aanpassen | iedereen |

Alle functies zijn `read`. De scope blijft `analytics.readonly`; de Admin API-functies en de alpha-functies gebruiken een volledige URL in `path`, de hosts staan in `hosts` (of zijn de host van `baseUrl`).

## Code-functies

| Functie | Wat |
| --- | --- |
| `run_report_flat` | Roept `run_report` aan (`uses`) en zet het antwoord om naar rijen als objecten met de dimensie- en metricnaam als sleutel en metrics als getal, met `rowCount`, `nextOffset` bij bladeren, totalen als die gevraagd zijn, en de quotastand als `returnPropertyQuota` aanstaat. Via `uses` in plaats van een eigen `POST` blijft de functie op niveau `read`, en gelden de cache en limieten van `run_report`. |
| `find_dimensions_metrics` | Haalt de metadata van de property op (`GET /properties/*/metadata`) en geeft hoogstens 50 treffers op een zoekwoord, met `apiName`, `uiName`, categorie, een korte beschrijving en `customDefinition`. |

De code ziet de sleutel van het serviceaccount niet: Tailr Core voegt de login toe.

## Persoonsgegevens

GA-rapporten bevatten tellingen over groepen bezoekers, geen gegevens van individuele personen. Google laat bovendien kleine aantallen weg (*thresholding*). Een eigen dimensie kan wel iets persoonlijks bevatten, zoals een klant-id; `context.md` vraagt de AI zulke waarden niet per persoon op te vragen. Doelgroep-exports met gebruikers-id's (`audienceExports`) zitten bewust niet in deze connector.

De Admin API gaat wel over mensen: de collega's die de property gebruiken. Het toegangsrapport (`run_access_report`) bevat hun e-mailadres (`userEmail`) en is daarom alleen voor *Apps (API)* (`audience: "api"`): een dashboard of tool kan het tonen, de AI ziet het niet. Een `privacy`-markering werkt per veldnaam, en in Googles rijvorm (`rows[].dimensionValues[].value`) staat het e-mailadres op een positie, niet onder een naam; de markering zou dan elke cel tot schuilnaam maken en het rapport onbruikbaar. Bij `list_google_ads_links` wordt het e-mailadres van wie de koppeling maakte (`creatorEmailAddress`) weggelaten met `transform.exclude`. Measurement Protocol-geheimen en toegangsrechten (access bindings) zitten niet in de connector. De alpha-antwoorden (doelgroepen, kanaalgroepen, berekende metrics, annotaties, BigQuery-koppelingen, instellingen en regels) bevatten volgens het schema van Google geen e-mailadressen of andere gegevens van collega's; titels en beschrijvingen van annotaties zijn vrije tekst die een collega schreef.

## Quota

Een standaard property heeft 200.000 tokens per dag en 40.000 per uur (en 14.000 per uur per Google Cloud-project), en hoogstens 10 gelijktijdige verzoeken. Een gewoon rapport kost 1 tot 10 tokens. Realtime en trechterrapporten hebben elk een eigen, even groot potje; het toegangsrapport (`run_access_report`) telt bij Google mee met de gewone rapporten. `get_quota` toont de stand van alle drie. Tailr Core bewaart rapporten en trechters 5 minuten in de cache, `check_compatibility` een uur en `get_metadata` een dag; realtime en `get_quota` nooit. De Admin API (inrichting van de property) heeft een eigen quotum, los van de tokens: 1.200 verzoeken per minuut per project en 600 per minuut per gebruiker; de inrichtingsfuncties en de alpha-lijsten staan een uur in de cache, het toegangsrapport 5 minuten.

Google laat lege lijsten weg: een `list_*`-functie geeft dan een leeg object `{}` terug. Elke `description` en `context.md` zeggen dat dat "er zijn er geen" betekent, zodat de AI het niet als fout leest.

## Een functie toevoegen

1. Neem alleen feiten over uit het discovery-document van Google (`https://analyticsdata.googleapis.com/$discovery/rest?version=v1beta`, voor de Admin API `https://analyticsadmin.googleapis.com/$discovery/rest?version=v1beta`; voor alpha `version=v1alpha`): pad, methode, parameternamen, typen en toegestane waarden. Schrijf de teksten zelf. Een Admin API-functie of alpha-functie krijgt een volledige URL in `path`; een alpha-`description` begint met "Alpha-API van Google: kan veranderen."
2. Geef `title` en `summary` in het Nederlands en Engels, en een `description` in het Nederlands voor de AI.
3. Verhoog `version` in `connector.json` en in `connectors/index.json`.
4. Maak de variant opnieuw: `node scripts/make-variants.mjs google-analytics` (zie `CONTRIBUTING.md`).
5. Draai `tailr check connectors/google-analytics` en `tailr check connectors/google-analytics-signin`: zonder waarschuwingen.
