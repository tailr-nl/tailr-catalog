# Exact Online

Facturen, relaties, artikelen en boekingsregels uit Exact Online. Daarnaast code-functies voor het boekhoudwerk: grootboekkaart, boekingen, afletterstatus, bankregels per periode, bewijs bij bankuitgaven en documenten zoeken. **Alleen lezen.**

De code-functies zijn gebaseerd op `exact-mcp` (Joep Herrmann, 2026) en draaien in de zandbak van Tailr Core.

## Instellen

1. Registreer een app in het [Exact App Center](https://apps.exactonline.com). Terugkeeradres: `<PUBLIC_URL>/api/oauth/callback`. Exact accepteert daar meestal alleen https: gebruik een publiek adres of een tunnel.
2. Voeg in Tailr Core de koppeling **Exact Online** toe met client-id en clientgeheim. Kijk bij het toevoegen wat de connector mag en bevestig dat.
3. Open de koppeling en kies **Verbinden met Exact Online**. Log in bij Exact en geef toestemming.
4. Test de functie *Wie ben ik* (`me`) en vul `CurrentDivision` in bij *Administratie (division)*.
5. Geef een rol leesrecht op de koppeling.

## Functies

| Functie | Wat |
| --- | --- |
| `get_general_ledger_card` (code) | Grootboekkaart tussen twee datums binnen één boekjaar: beginsaldo (saldibalans plus regels uit de startperiode), regels, eindsaldo, controle met de saldibalans. |
| `get_financial_entry` (code) | Eén boeking met al haar regels, debet- en credittotaal en of ze in balans is. |
| `get_matching_details` (code) | Afletterstatus van facturen, met openstaand bedrag en tegenboekingen, en een controle of factuur plus tegenregels gelijk is aan het openstaande bedrag. Met `entry_number` ook de openstaande post van de boeking zelf (`entry_outstanding_items`). |
| `list_payables` (code) | Openstaande leveranciersposten zoals het scherm *Openstaande posten \| Te betalen*: inkoopfacturen en losse betalingen, met totalen per valuta en subtotalen per leverancier. |
| `list_bank_lines_by_period` (code) | Bankregels in 1–31 dagen, optioneel per grootboekrekening. |
| `review_receipt_evidence` (code) | Bij uitgaande bankregels: is er een document met bijlage, aan de bankregel zelf of aan de inkoopfactuur die ermee is betaald? Met het soort beweging per regel. Zie [Bonnetjescontrole](#bonnetjescontrole). |
| `list_documents` (code) | Documenten in 1–31 dagen, op documentdatum of aanmaakdatum, optioneel per soort, relatie of onderwerp. Per document de bijlagen (bestandsnaam, grootte) en of het aan een boeking hangt, plus een link (`exact_url`) om het document in Exact te openen. Geen inhoud, geen downloads. |
| `check_uploads` (code) | Zijn ingestuurde bonnen in 1–31 dagen aangekomen en door Exact herkend? Per upload: herkend (open of verwerkt), niet herkend, dubbel of onduidelijk. Optioneel een lijst met wat je hebt ingestuurd, om te zien wat niet is aangekomen. |
| `add_document_note` (code, schrijven) | Zet een opmerking van jou bij een document (tekstveld), achter wat er al staat, met datum en "Tailr" ervoor. Je bevestigt elke aanroep in Tailr. |
| `list_mailboxes` (code) | De Exact-mailboxen van de administratie, om de scanmailbox te vinden. |
| `upload_receipt` (code, schrijven, alleen API) | Stuurt een bon (pdf, jpg, png, hoogstens ~1,4 MB) naar Exact vanuit een dashboard of app: via de scanmailbox (herkenning door Exact) of als document met bijlage. Niet beschikbaar in de chat. |
| `me`, `list_sales_invoices`, `list_accounts`, `list_items`, `list_transaction_lines`, `list_receivables` | Losse lijsten met OData-filters. |

## Wat de code mag (manifest)

- **Host:** alleen het Exact-domein uit de instellingen (standaard `start.exactonline.nl`).
- **Verzoeken:** alleen `GET` op vaste resources: TransactionLines, BankEntryLines, ReportingBalance, FinancialPeriods, GLAccounts, Journals, Receivables, Payments, PayablesList, Documents, DocumentAttachments, PurchaseEntries en Divisions.
- Bladeren alleen met de `$skiptoken` uit `__next`; de volgende URL zelf wordt nooit opgevraagd.
- De code ziet het OAuth-token niet. Tailr Core voegt het toe en vernieuwt het.

## Uploads controleren (`check_uploads`)

Een bon die je mailt of uploadt, wordt in Exact eerst een ruwe scan (soort 202, zonder relatie of bedrag). Herkent Exact hem, dan komt er een tweede document bij: een inkoopfactuur (soort 20) met relatie en bedrag, met hetzelfde bestand erin. `check_uploads` koppelt die twee alleen op een identiek bestand (naam en grootte) en geeft per upload een status:

- `recognized_open` / `recognized_processed`: herkend, nog te verwerken of al verwerkt;
- `scan_only_not_recognized`: aangekomen maar niet herkend, dus zelf nakijken;
- `duplicate_of_earlier_upload`: hetzelfde bestand was al eerder ingestuurd en herkend;
- `ambiguous_multiple_recognized_documents`: meer dan één inkoopfactuur met dit bestand.

Een mail die Exact nooit heeft bereikt, laat geen spoor na. Geef daarom met `expected` op wat je hebt ingestuurd: per stuk een tekst uit het onderwerp of de bestandsnaam, een bedrag, of beide (`{"text": "Hornbach", "amount": 61.55}`). Het bedrag wordt gezocht in wat Exact van de factuur heeft gelezen; `match_basis` zegt waarop een stuk is gevonden en bij meer treffers is het `ambiguous`. Of zoek betalingen zonder bon met `review_receipt_evidence`.

## Bon aanleveren via de API (`upload_receipt`)

Foto's en pdf's gaan nooit via de chat. `upload_receipt` heeft `audience: "api"`: de functie staat niet in de lijst voor de AI en een AI krijgt `api_only`. Een dashboard of app met een eigen sleutel roept hem aan:

```
POST /api/v1/tools/exact-online__upload_receipt
{ "file_name": "bon-hornbach.jpg", "file_base64": "<base64>", "note": "gereedschap project X" }
```

- **`route: "scan"`** (standaard) stuurt de bon als bericht naar de scanmailbox van de administratie (`mailbox/MailMessagesSent` met Operation 1, inkoopfactuur), zodat Exact hem uitleest zoals een gemailde bon. Is er meer dan één mailbox, geef dan `recipient_mailbox_id` mee (zie `list_mailboxes`). Controleer daarna met `check_uploads` of hij herkend is. Of Exact een via de API gestuurd bericht net zo verwerkt, is niet gedocumenteerd.
- **`route: "document"`** maakt een document met bijlage, zonder herkenning; de boekhouder verwerkt het met de hand.
- Hoogstens ongeveer 1,4 MB: een verzoek uit de zandbak mag hoogstens 2 MB zijn en base64 is een derde groter. Verklein een foto eerst (jpg, ongeveer 1600 px).
- Een dashboard binnen Tailr (plugin) kan dit nog niet: dat geeft hoogstens 64 kB aan argumenten mee en roept standaard alleen leesfuncties aan.

## Opmerking bij een document (`add_document_note`)

Een van de twee functies van deze koppeling die iets in Exact veranderen (de andere is `upload_receipt`). Hij zet een opmerking die jij geeft in het tekstveld van één document, bijvoorbeeld "privé" of "hoort bij project X" voor je boekhouder. Bestaande tekst blijft staan; de opmerking komt erachter als `[datum Tailr] tekst`. Daarna leest de functie het document terug (`verified`). Bij een upload hoort de opmerking bij de herkende inkoopfactuur (soort 20), want die verwerkt de boekhouder. Teruglezen kan met `list_documents` en `include_body: true`.

Een opmerking in de mail waarmee je een bon instuurt, komt niet in Exact terecht: het tekstveld van gemailde uploads is leeg.

## Documenten zoeken (`list_documents`)

- **Filters.** Exact filtert op datum (`date_field`: `document_date` of `created`), soort (`type`) en relatie (`account`). Onderwerp (`subject_contains`), `only_unbooked` en `has_attachments` filtert de code zelf na het ophalen; die waarden gaan nooit in een OData-filter.
- **Geboekt.** `booked` is waar als het document een `FinancialTransactionEntryID` heeft; dat id staat in `financial_entry_id` (te gebruiken met `get_financial_entry`). Bij een document van de soort verkoopfactuur zet Exact daar het id van de verkoopfactuur neer, niet van een boeking. `booked: false` bewijst niet dat er niets geboekt is. `proposed_entry_status` is de status van het boekingsvoorstel bij het document (0 = vervallen, 5 = afgewezen, 20 = open, 50 = verwerkt).
- **Bijlagen.** Alleen bestandsnaam en grootte, per tien documenten tegelijk opgehaald. Lukt dat niet, dan staat er `attachments_known: false`; dat is iets anders dan "geen bijlage".
- **Grenzen per aanroep.** De functie bekijkt hooguit 900 documenten in de periode en haalt van hooguit 200 documenten de bijlagen op. Daarboven is `complete` onwaar en `truncated` of `scan.complete` zegt waarom. Kies dan een kortere periode of een extra filter. Ergste geval: 56 aanroepen (15 pagina's documenten, 20 groepen bijlagen van elk hooguit 2 pagina's, 1 voor de administratie).
- **Nog niet verwerkte uploads.** Gebruik `only_open_proposals: true` (boekingsvoorstel open, `proposed_entry_status` 20) met `date_field: "created"`. Exact bewaart een upload als twee documenten: de ruwe scan (soort *Scanned purchase document*) en de herkende inkoopfactuur (soort *Purchase invoice*, met relatie, bedrag en het open voorstel). `only_unbooked` geeft alles zonder boeking, dus ook bankimports en ruwe scans. In een echte administratie gecontroleerd (november 2026).
- **Filters bij Exact.** Filteren op `DocumentDate`, `Created`, `Type` en `Account` werkt (in een echte administratie gecontroleerd, november 2026).
- **Soortnummers** staan in Exact onder de documentsoorten; de functie geeft per document `type` en `type_description` terug.

## Persoonsgegevens

`list_documents` volgt het patroon "een lijst zonder persoonsgegevens": de naam van de relatie, de contactpersoon en de maker van het document worden niet bij Exact opgevraagd. De relatie komt terug als id en relatiecode. De inhoud van bijlagen wordt niet gelezen. Het tekstveld van een document (bij een gemailde bon mogelijk de mailtekst, of een opmerking) komt alleen mee met `include_body: true`, als platte tekst van hoogstens 1000 tekens; daar kunnen namen en e-mailadressen in staan. `exact_url` (ook bij `purchase_invoice` in `review_receipt_evidence`) opent het document in Exact; dat werkt alleen in een browser waarin je bij Exact bent ingelogd. De AI kan de link niet openen. Onderwerp en bestandsnaam zijn vrije tekst en komen wel mee, omdat een document anders niet te herkennen is; daar kan een naam in staan als iemand die er zelf in heeft gezet of als Exact het onderwerp zo heeft opgebouwd. Wil je dat niet, geef een rol dan geen recht op deze functie.

## Openstaande leveranciersposten (`list_payables`)

Bron: `read/financial/PayablesList`, de tegenhanger van `ReceivablesList` achter `list_receivables`. Volgens de documentatie van Exact ontstaat daar een regel bij een inkoopfactuur én wanneer er geld aan een leverancier is betaald, en de velden zijn de kolommen van het scherm. `cashflow/Payments` is niet gekozen: die bron bevat ook afgeletterde posten, heeft een omgekeerd teken en geen dagboektype.

- **Soort per regel** (`kind`), uit het type van het dagboek (`financial/Journals`) en het factuurnummer, nooit uit het teken of de omschrijving: `open_invoice` (inkoopdagboek), `unmatched_payment` (kas, bank of betaaldienst, zonder factuurnummer), `payment_with_invoice_number` (kas, bank of betaaldienst, met factuurnummer) en `other` (memoriaal of onbekend type; zie `kind_basis`).
- **Bedrag** zoals Exact het in deze lijst geeft, als exacte decimaal met twee cijfers; er wordt niets omgedraaid. Totalen staan per valuta, met subtotalen per leverancier. Ze tellen alle opgehaalde regels, ook als `items` is ingekort (`max_items`, `items_truncated`).
- **Filters:** `account_id` of `account_code` (één leverancier) en `only_overdue` (vervaldatum vóór vandaag). Ouderdom (`age_days`) is het aantal dagen sinds de datum van de post.
- **Geen peildatum:** de lijst is de stand van nu. **Geen afletterstatus:** gebruik daarvoor `get_matching_details`.
- **Volledigheid:** hoogstens 3.000 regels of 50 pagina's; daarboven `complete: false`. In het ergste geval 56 aanroepen (50 pagina's, 5 voor dagboeken, 1 voor de administratie).
- De naam van de leverancier staat in de uitvoer (`account_name`), net als bij `list_accounts`.

**Tegen een echte administratie gecontroleerd (november 2026):** aantal, bedragen en teken komen overeen met het scherm in Exact; niet-afgeletterde betalingen staan in de lijst met een leeg factuurnummer en het bankdagboek (`unmatched_payment`). Niet gecontroleerd: of `Amount` bij een deels betaalde factuur het restant is, het bedrag bij een post in vreemde valuta, en bladeren over meer dan één pagina.

`get_matching_details` met `entry_number` zoekt de openstaande post van de boeking eerst in `cashflow/Payments` en `cashflow/Receivables`. Een bankboeking die nog niet is verwerkt staat daar niet in; dan komt de post uit `read/financial/PayablesList` of `ReceivablesList` (wat daar staat, staat open; het bedrag heeft het teken van die lijst, `open_amount_as_listed`). Zo krijgt een losse betaling aan een leverancier `open_not_linked_to_invoice`.

## Limieten

Exact staat 60 aanroepen per minuut en 5.000 per dag per administratie toe. Een grootboekkaart over een heel jaar kan tientallen aanroepen kosten. Boven 60 per minuut wacht Tailr Core, hooguit 60 seconden per aanroep (`maxWaitSeconds`); daarna volgt `rate_limited`. Vraag dan een kortere periode.

## Bonnetjescontrole

`review_receipt_evidence` bekijkt de uitgaande bankregels van 1–31 dagen (hoogstens 100) en zegt per regel of er een document met bijlage aan hangt. De functie stelt nooit vast dat een bon ontbreekt en kijkt niet in de bijlage zelf.

**Twee paden, allebei expliciet** (`evidence_path` per regel):

1. `bank_line_document`: het document van de bankregel zelf. Is dat de bankimport of het afschrift, dan telt het niet als bon.
2. `purchase_invoice_document`, alleen als pad 1 geen bijlage opleverde: de regels van de bankboeking (TransactionLines op `EntryID`) → de tegenregel met hetzelfde `LineNumber` op de tegenrekening van de bankregel → het `InvoiceNumber` daarop → de inkoopboeking met dat nummer als `EntryNumber` (TransactionLines met Type 30 of 31) → het `Document` van die boeking, met bijlagen. De inkoopboeking komt uit TransactionLines en niet uit PurchaseEntries: dat pad is in een echte administratie nagelopen en het type sluit een boeking met hetzelfde nummer in een ander soort dagboek uit.

Er wordt nooit gekoppeld op bedrag, datum, omschrijving of OffsetID. Geen factuurnummer op de tegenregel, of niet precies één inkoopboeking met één document: de regel houdt haar categorie en krijgt een reden (bijv. `no_invoice_number_on_bank_entry_counter_line`, `multiple_purchase_entries_for_invoice_number`). Het pad laat zien tegen welke factuur de betaling is geboekt. Bedragen, deelbetalingen en afletterstatus worden niet gecontroleerd (`purchase_payment_linkage_verified` blijft `false`); gebruik daarvoor `get_matching_details`.

**Betaald aan een leverancier, geen factuur gekoppeld.** Staat de betaling op de crediteurenrekening zonder factuurnummer, dan krijgt de regel ook de reden `supplier_payment_not_linked_to_invoice` (geteld in `supplier_payments_not_linked_to_invoice`). Dat zijn dezelfde posten als `unmatched_payment` in `list_payables`. De factuur moet mogelijk nog geboekt of afgeletterd worden; het is geen bewijs dat een bon ontbreekt.

**Soort beweging** (`movement_kind`, met tellingen per soort in `movement_kinds`): `expense`, `transfer`, `private`, `payment_difference`, `clearing`, `bank_fee_or_interest`, `tax`, `payables_settlement` of `unknown`. Het komt van de tegenrekening van de bankregel: eerst het type grootboekrekening uit Exact (bijv. 22 crediteuren, 24 btw, 12 bank, 121 kosten), anders woorden in de naam (privé, betalingsverschil, kruispost en bankkosten hebben in Exact geen eigen type). `movement_kind_source` zegt welke van de twee het was. Het is een etiket om na te kijken, geen oordeel: kruisposten en overboekingen doorlopen dezelfde controle als elke andere regel.

**Aanroepen.** Documenten, bijlagen, boekingsregels en grootboekrekeningen gaan per tien in één verzoek. Een gewone maand kost enkele tientallen aanroepen; het ergste geval (100 bankregels, alles verschillend, elk verzoek tot de laatste pagina) is 155. Is een verzoek afgekapt of mislukt, dan geldt dat voor alle tien. Na een limietfout stopt de functie met opvragen: die regels krijgen de reden `rate_limited_evidence_not_checked` en de samenvatting telt ze in `query_failures.rate_limited_rows`. Dat zegt niets over ontbrekend bewijs; draai de controle later opnieuw of over een kortere periode.

## Bekende grenzen

- Afletteren op een grootboekkaart (bijv. kruisposten) zit niet in de REST API van Exact. Die regels krijgen `matching_status: unknown` en worden nooit geraden.
- Getallen komen als JSON-getallen van Exact. Bedragen met meer dan 15 cijfers kunnen niet exact worden doorgegeven; voor gewone boekhoudbedragen is dat geen probleem.
- De voorstel-functie voor facturen uit exact-mcp (lokaal, zonder iets in Exact te maken) zit hier nog niet in.
