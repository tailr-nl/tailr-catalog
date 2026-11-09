# Google Analytics 4

Rapporten uit Google Analytics 4 via de Data API (v1beta): bezoekers, sessies, bronnen, pagina's, key events en omzet over elke periode, realtime bezoekers, draaitabellen, meerdere rapporten in één aanroep, en zoeken in alle dimensies en metrics van de property. Alles alleen lezen: Tailr Core wijzigt niets in Google Analytics.

Gebaseerd op de openbare Data API van Google; beschrijvingen zijn eigen tekst.

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

Alle functies zijn `read`.

## Code-functies

| Functie | Wat |
| --- | --- |
| `run_report_flat` | Roept `run_report` aan (`uses`) en zet het antwoord om naar rijen als objecten met de dimensie- en metricnaam als sleutel en metrics als getal, met `rowCount`, `nextOffset` bij bladeren, totalen als die gevraagd zijn, en de quotastand als `returnPropertyQuota` aanstaat. Via `uses` in plaats van een eigen `POST` blijft de functie op niveau `read`, en gelden de cache en limieten van `run_report`. |
| `find_dimensions_metrics` | Haalt de metadata van de property op (`GET /properties/*/metadata`) en geeft hoogstens 50 treffers op een zoekwoord, met `apiName`, `uiName`, categorie, een korte beschrijving en `customDefinition`. |

De code ziet de sleutel van het serviceaccount niet: Tailr Core voegt de login toe.

## Persoonsgegevens

GA-rapporten bevatten tellingen over groepen bezoekers, geen gegevens van individuele personen. Google laat bovendien kleine aantallen weg (*thresholding*). Een eigen dimensie kan wel iets persoonlijks bevatten, zoals een klant-id; `context.md` vraagt de AI zulke waarden niet per persoon op te vragen. Doelgroep-exports met gebruikers-id's (`audienceExports`) zitten bewust niet in deze connector.

## Quota

Een standaard property heeft 200.000 tokens per dag en 40.000 per uur, en hoogstens 10 gelijktijdige verzoeken. Een gewoon rapport kost 1 tot 10 tokens. Realtime heeft een eigen potje. Tailr Core bewaart rapporten 5 minuten in de cache, `check_compatibility` een uur en `get_metadata` een dag; realtime nooit.

## Een functie toevoegen

1. Neem alleen feiten over uit het discovery-document van Google (`https://analyticsdata.googleapis.com/$discovery/rest?version=v1beta`): pad, methode, parameternamen, typen en toegestane waarden. Schrijf de teksten zelf.
2. Geef `title` en `summary` in het Nederlands en Engels, en een `description` in het Nederlands voor de AI.
3. Verhoog `version` in `connector.json` en in `connectors/index.json`.
4. Maak de variant opnieuw: `node scripts/make-variants.mjs google-analytics` (zie `CONTRIBUTING.md`).
5. Draai `tailr check connectors/google-analytics` en `tailr check connectors/google-analytics-signin`: zonder waarschuwingen.
