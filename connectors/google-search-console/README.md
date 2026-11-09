# Google Search Console

Zoekprestaties, sitemaps en URL-inspectie uit Google Search Console. **Alleen lezen**: de connector vraagt alleen de scope `webmasters.readonly` en wijzigt niets in Search Console.

Gebaseerd op de openbare Search Console API van Google (v3 voor sites, sitemaps en zoekprestaties; v1 voor URL-inspectie); alle beschrijvingen zijn eigen tekst.

Er is een variant [Google Search Console (sign in)](../google-search-console-signin/README.md) met dezelfde functies, waarbij je inlogt met je eigen Google-account in plaats van een serviceaccount. Die map wordt gegenereerd met `node scripts/make-variants.mjs google-search-console`; wijzig alleen deze hoofdconnector.

## Instellen

1. Schakel in Google Cloud Console de **Search Console API** in (een nieuw project mag; een project dat je al voor Google Analytics gebruikt ook).
2. Maak in hetzelfde project een **serviceaccount** en download een **JSON-sleutel**. Rollen in het project zijn niet nodig.
3. Geef het serviceaccount in Search Console toegang tot de property: *Instellingen → Gebruikers en rechten → Gebruiker toevoegen*, met het e-mailadres uit het sleutelbestand (`client_email`) en rechten **Beperkt**. Lezen is genoeg.
4. Voeg in Tailr Core de koppeling **Google Search Console** toe, plak het sleutelbestand op de invulpagina en kies de website uit de lijst (*Websites*). De website is de standaard voor alle functies; per aanroep kan de AI een andere property kiezen.
5. Tailr Core test de verbinding met *Websites* (`list_sites`).

Het stappenplan in Tailr Core loopt deze stappen met je door, met de juiste links.

## Functies

Alle functies hebben niveau `read`.

| Functie | Wat |
| --- | --- |
| `list_sites` | Alle properties waar het serviceaccount bij kan, met rechtenniveau. |
| `get_site` | Eén property met het rechtenniveau; controleert of een property bestaat en bereikbaar is. |
| `search_analytics` | Klikken, vertoningen, CTR en positie per zoekterm, pagina, land, apparaat, dag of weergave. Ook voor Discover en Google Nieuws (`type`), met verse dagen (`dataState: all`), telling per pagina of per property (`aggregationType`) en bladeren (`startRow`). Hoogstens 25.000 rijen per aanroep. |
| `search_analytics_all` (code) | Zelfde invoer als `search_analytics`, maar bladert zelf door alle pagina's tot `maxRows` (standaard 100.000) en geeft `complete: true/false`. |
| `list_sitemaps` | Ingediende sitemaps met type, laatste download, fouten, waarschuwingen en aantal URL's; optioneel alleen de sitemaps uit één sitemapindex. |
| `get_sitemap` | Eén sitemap met dezelfde velden. `feedpath` is de volledige URL van de sitemap; Tailr Core codeert hem voor het adres. |
| `inspect_url` | Is een pagina geïndexeerd, en zo niet waarom niet: dekking, canonical van Google versus die van de site, laatste crawl, robots.txt, mobiel, rich results, AMP. |

## Limieten

- Zoekprestaties: Google noemt 1.200 verzoeken per minuut per site en per gebruiker (en 40.000 per minuut per Google Cloud-project); de connector houdt 600 per minuut aan en bewaart antwoorden 10 minuten (sites en sitemaps een uur).
- Google laat lege lijsten weg: `list_sites` en `list_sitemaps` geven dan een leeg object `{}` terug. De `description` en `context.md` zeggen dat dat "er zijn er geen" betekent.
- **URL-inspectie heeft een eigen quotum: 2.000 inspecties per dag en 600 per minuut per property.** Tailr Core bewaart een inspectie een uur, maar elke nieuwe URL telt. De uitleg voor de AI (`context.md`) zegt daarom: inspecteer alleen wat de gebruiker noemt, nooit een hele sitemap. Een losse limiet per functie kent het connectorformaat niet; wil je het harder begrenzen, zet de functie dan voor rollen die het niet nodig hebben uit.
- Zoekprestaties lopen 2 tot 3 dagen achter. Met `dataState: all` komen de verse dagen mee, die nog kunnen veranderen.

## Wat de code mag (manifest)

- **Hosts:** `www.googleapis.com` (sites, sitemaps, zoekprestaties), `searchconsole.googleapis.com` (URL-inspectie) en `oauth2.googleapis.com` (token).
- **Code-functie `search_analytics_all`:** geen eigen verzoeken naar Google; hij roept alleen de functie `search_analytics` aan (`uses`), zodat hij een leesfunctie blijft en de cache en limieten van `search_analytics` gelden. Hoogstens 12 aanroepen per run (10 pagina's van 25.000 rijen is het harde plafond van 250.000), 120 seconden. De code ziet de sleutel niet: Tailr Core voegt de login toe.

## Persoonsgegevens

Search Console bevat geen persoonsgegevens: zoektermen, pagina's, landen en apparaten zijn geaggregeerd. `inspect_url` toont alleen gegevens over je eigen pagina's. De connector heeft daarom geen `privacy`-markeringen.

## Een functie toevoegen

De Search Console API staat beschreven in Googles discovery-document (`https://searchconsole.googleapis.com/$discovery/rest?version=v1`). Neem daaruit alleen de feiten over (pad, methode, parameters, veldnamen, toegestane waarden) en schrijf `title`, `summary` en `description` zelf, zoals de andere functies. Schrijffuncties (sitemap indienen of verwijderen) vragen de ruimere scope `webmasters` en een hogere rol voor het serviceaccount; die horen in een aparte stap, niet tussen de leesfuncties. Verhoog `version` in `connector.json` en `connectors/index.json`, maak de variant opnieuw met `node scripts/make-variants.mjs google-search-console` (zie `CONTRIBUTING.md`) en draai `tailr check` op beide: zonder waarschuwingen.
