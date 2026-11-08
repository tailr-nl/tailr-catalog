# Mollie

Alles wat je bij Mollie doet, via de API v2: betalingen, terugbetalingen, captures, chargebacks, klanten, machtigingen, abonnementen, betaallinks, checkoutsessies, verkoopfacturen, uitbetalingen (settlements en payouts), saldi, profielen en betaalmethoden, webhooks, terminals, de zakelijke rekening en de functies voor partners en platforms (Connect). Elke operatie van de API is één functie: 126 stuks, plus een overzicht van klanten voor dashboards en twee code-functies.

Gebaseerd op de openbare API van Mollie; beschrijvingen zijn eigen tekst.

## Instellen

1. Maak in het Mollie-dashboard een **Advanced access token**: *Developers → API keys → Advanced access tokens*. Daarvoor heb je de rol Admin nodig.
   - Kies **live**, of **test** om eerst te proberen. Koppel het token zo mogelijk aan het profiel van de webshop.
   - Geef alleen de rechten die je gebruikt: `.read` om te lezen, `.write` om te wijzigen. Het stappenplan in Tailr Core heeft twee lijsten om te kopiëren.
2. Voeg in Tailr Core de koppeling **Mollie** toe en plak het token op de invulpagina. Een `live_`- of `test_`-sleutel wordt geweigerd: die hoort bij één profiel en mag onder meer uitbetalingen, saldi en facturen niet zien.
3. Hoort het token niet bij één profiel? Kies dan na het verbinden het profiel (de webshop) uit de lijst. Tailr Core geeft het daarna mee als `profileId`.
4. Tailr Core test de verbinding met *Saldo* (`get_balance`).
5. Geef elke rol het niveau dat past: lezen, schrijven of beheer.

## Niveaus

| Niveau | Wat |
| --- | --- |
| `read` (78) | Alles opvragen (`GET`). |
| `write` (24) | Aanmaken en wijzigen: betalingen, betaallinks, klanten, machtigingen, verkoopfacturen, captures, webhooks, profielen. |
| `admin` (25) | Verwijderen en annuleren (`DELETE`), en alles waarbij geld weggaat zonder dat de klant zelf betaalt: `create_refund`, `create_customer_payment`, `create_subscription`, `update_subscription`, `create_transfer`, `create_draft_transfer`, `create_payout`, `create_connect_balance_transfer`, `create_payment_route`, `return_unmatched_credit_transfer`, `release_authorization`. |

Let op: `create_payment` met `sequenceType: recurring` en een machtiging schrijft meteen af. Wil je dat niet op niveau `write`, zet de functie dan met een uitzondering op beheer, of uit.

## Persoonsgegevens

De connector markeert zelf waar gegevens van mensen staan. Dat is de ondergrens: de beheerder kan per installatie alleen strenger maken.

- **Lijsten geven geen persoonsgegevens.** In lijsten van betalingen, klanten, machtigingen, verkoopfacturen, betaallinks, niet-gekoppelde overboekingen, transacties en conceptoverboekingen zijn naam, e-mail, rekeningnummer (IBAN), kaarthouder en adressen weggelaten (`transform.exclude`). Dat geldt ook voor betalingen die met `embed=payment` meekomen bij captures, terugbetalingen en chargebacks, en voor het object bij een webhookgebeurtenis.
- **Opzoeken gaat één tegelijk**, met `privacy`: `get_payment`, `get_customer`, `get_mandate`, `get_sales_invoice`, `get_unmatched_credit_transfer`, `get_business_account_transaction`, `get_transfer` en `get_draft_transfer`. Alleen de velden in `sensitivity` gaan door; de AI krijgt schuilnamen, er is een plafond per dag en elke inzage staat in het inzagelog.
- **Een overzicht met namen** is er alleen voor *Apps (API)*, zoals dashboards en tools: `list_customers_with_names` (`audience: "api"`). De AI ziet die functie niet: in *AI-tools (MCP)* bestaat hij niet.
- **Schrijffuncties** houden hun eigen niveau (`write` of `admin`) en geen privacy-markering: wat ze terugsturen, heeft de aanroeper zelf meegegeven.
- `list_business_accounts` heeft de parameter `account` (in de API `iban`): dat is het IBAN van je eigen zakelijke rekening, geen persoonsgegeven.

## Functienamen

De namen volgen de operaties van Mollie, met een paar uitzonderingen zodat bestaande namen hun betekenis houden:

| Functie | Bij Mollie |
| --- | --- |
| `get_balance` | Het hoofdsaldo; op id is het `get_balance_by_id` |
| `list_refunds`, `list_chargebacks` | Alle terugbetalingen en chargebacks; per betaling `list_payment_refunds`, `list_payment_chargebacks` |
| `list_payment_captures`, `get_payment_refund`, `get_payment_chargeback` | Per betaling |
| `create_checkout_session`, `get_checkout_session` | De Checkout Sessions API |
| `list_terminal_pairing_codes` enz., `list_payment_routes` enz. | Zonder het voorvoegsel `terminals_` of `payment_` |

In lijsten laat Tailr Core per element de `_links` weg, zodat antwoorden klein blijven. De link naar de volgende pagina blijft staan.

## Code-functies

| Functie | Wat |
| --- | --- |
| `settlement_breakdown` | Splitst een uitbetaling uit in betalingen, Klarna-captures, terugbetalingen, chargebacks en kosten, en controleert of de som klopt. Rekent met exacte decimalen. |
| `find_payments` | Zoekt de betalingen bij een ordernummer in de omschrijving (in de 1000 nieuwste betalingen). Geeft geen gegevens van de betaler. |

De code ziet het token niet: Tailr Core voegt de login toe. De code mag alleen `GET` op `api.mollie.com`.

## Een functie toevoegen

Mollie publiceert de API als OpenAPI-specificatie ([github.com/mollie/openapi](https://github.com/mollie/openapi)), maar die heeft geen licentie. Neem daarom alleen de **interface** over en schrijf alle tekst zelf.

1. **Feiten overnemen mag:** het pad, de methode, de namen van parameters en velden, hun type, of ze verplicht zijn, en de toegestane waarden (`enum`). Haal die uit de specificatie of de API-referentie.
2. **Teksten niet:** geen `summary`, `description` of voorbeelden uit de specificatie of de documentatie van Mollie, ook niet vertaald of licht aangepast. Lees ze hooguit om te begrijpen wat de operatie doet, en schrijf daarna vanuit wat de functie voor een gebruiker doet.
3. Schrijf de teksten zoals de andere functies:
   - `title` en `summary` in het Nederlands en Engels, voor een medewerker zonder technische kennis;
   - `description` in het Nederlands, voor de AI: wat komt terug, wanneer gebruik je deze functie en niet een andere, en wat moet de AI eerst vragen;
   - per parameter een korte eigen `description`; bij geneste objecten (`schema`) alleen de velden die de AI nodig heeft.
4. Kies het **niveau**: `read` voor `GET`, `write` voor aanmaken en wijzigen, `admin` voor verwijderen en alles waarbij geld weggaat zonder dat de klant zelf betaalt.
5. **Persoonsgegevens:** geeft de functie namen, e-mail, IBAN of adressen? Laat ze in een lijst weg met `transform.exclude`, en markeer een functie die één object opvraagt met `privacy` (zie *Persoonsgegevens* hierboven).
6. Verhoog `version` in `connector.json` en in `connectors/index.json`, en draai `tailr check connectors/mollie`: zonder waarschuwingen.

## Gerichte gegevensverstrekking en bevestiging

Individuele detailfuncties markeren de naamvelden die met `privacy.chat.allowReal` expliciet voor *AI-tools (MCP)* aangevraagd mogen worden. Gewone opvragen blijven schuilnamen geven. In Tailr Core kiest de beheerder per functie **Altijd toestaan**, **Elke keer vragen** of **Blokkeren**, en kan de toegestane velden beperken. E-mailadressen, rekeningnummers, adressen en metadata vallen buiten deze uitzondering. Lijsten en functies die alleen voor *Apps (API)* zijn, blijven afgeschermd.

Alle functies op niveau `admin` stellen met `confirmationRequired: true` bevestiging van elke concrete aanroep verplicht. Uitvoerschema's bewaken de basisvorm van de individuele privacygevoelige detailantwoorden; een onjuist antwoord wordt niet verstrekt.
