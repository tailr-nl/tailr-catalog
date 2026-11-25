# Exact Online

Facturen, relaties, artikelen en boekingsregels uit Exact Online. Daarnaast code-functies voor het boekhoudwerk: grootboekkaart, boekingen, afletterstatus, bankregels per periode en bewijs bij bankuitgaven. **Alleen lezen.**

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
| `get_matching_details` (code) | Afletterstatus van facturen, met openstaand bedrag en tegenboekingen, en een controle of factuur plus tegenregels gelijk is aan het openstaande bedrag. |
| `list_bank_lines_by_period` (code) | Bankregels in 1–31 dagen, optioneel per grootboekrekening. |
| `review_receipt_evidence` (code) | Bij uitgaande bankregels: is er een document met bijlage, aan de bankregel zelf of aan de inkoopfactuur die ermee is betaald? Met het soort beweging per regel. Zie [Bonnetjescontrole](#bonnetjescontrole). |
| `me`, `list_sales_invoices`, `list_accounts`, `list_items`, `list_transaction_lines`, `list_receivables` | Losse lijsten met OData-filters. |

## Wat de code mag (manifest)

- **Host:** alleen het Exact-domein uit de instellingen (standaard `start.exactonline.nl`).
- **Verzoeken:** alleen `GET` op vaste resources: TransactionLines, BankEntryLines, ReportingBalance, FinancialPeriods, GLAccounts, Receivables, Payments, Documents, DocumentAttachments, PurchaseEntries en Divisions.
- Bladeren alleen met de `$skiptoken` uit `__next`; de volgende URL zelf wordt nooit opgevraagd.
- De code ziet het OAuth-token niet. Tailr Core voegt het toe en vernieuwt het.

## Limieten

Exact staat 60 aanroepen per minuut en 5.000 per dag per administratie toe. Een grootboekkaart over een heel jaar kan tientallen aanroepen kosten. Boven 60 per minuut wacht Tailr Core, hooguit 60 seconden per aanroep (`maxWaitSeconds`); daarna volgt `rate_limited`. Vraag dan een kortere periode.

## Bonnetjescontrole

`review_receipt_evidence` bekijkt de uitgaande bankregels van 1–31 dagen (hoogstens 100) en zegt per regel of er een document met bijlage aan hangt. De functie stelt nooit vast dat een bon ontbreekt en kijkt niet in de bijlage zelf.

**Twee paden, allebei expliciet** (`evidence_path` per regel):

1. `bank_line_document`: het document van de bankregel zelf. Is dat de bankimport of het afschrift, dan telt het niet als bon.
2. `purchase_invoice_document`, alleen als pad 1 geen bijlage opleverde: de regels van de bankboeking (TransactionLines op `EntryID`) → de tegenregel met hetzelfde `LineNumber` op de tegenrekening van de bankregel → het `InvoiceNumber` daarop → de inkoopboeking met dat nummer als `EntryNumber` (TransactionLines met Type 30 of 31) → het `Document` van die boeking, met bijlagen. De inkoopboeking komt uit TransactionLines en niet uit PurchaseEntries: dat pad is in een echte administratie nagelopen en het type sluit een boeking met hetzelfde nummer in een ander soort dagboek uit.

Er wordt nooit gekoppeld op bedrag, datum, omschrijving of OffsetID. Geen factuurnummer op de tegenregel, of niet precies één inkoopboeking met één document: de regel houdt haar categorie en krijgt een reden (bijv. `no_invoice_number_on_bank_entry_counter_line`, `multiple_purchase_entries_for_invoice_number`). Het pad laat zien tegen welke factuur de betaling is geboekt. Bedragen, deelbetalingen en afletterstatus worden niet gecontroleerd (`purchase_payment_linkage_verified` blijft `false`); gebruik daarvoor `get_matching_details`.

**Soort beweging** (`movement_kind`, met tellingen per soort in `movement_kinds`): `expense`, `transfer`, `private`, `payment_difference`, `clearing`, `bank_fee_or_interest`, `tax`, `payables_settlement` of `unknown`. Het komt van de tegenrekening van de bankregel: eerst het type grootboekrekening uit Exact (bijv. 22 crediteuren, 24 btw, 12 bank, 121 kosten), anders woorden in de naam (privé, betalingsverschil, kruispost en bankkosten hebben in Exact geen eigen type). `movement_kind_source` zegt welke van de twee het was. Het is een etiket om na te kijken, geen oordeel: kruisposten en overboekingen doorlopen dezelfde controle als elke andere regel.

**Aanroepen.** Documenten, bijlagen, boekingsregels en grootboekrekeningen gaan per tien in één verzoek. Een gewone maand kost enkele tientallen aanroepen; het ergste geval (100 bankregels, alles verschillend, elk verzoek tot de laatste pagina) is 155. Is een verzoek afgekapt of mislukt, dan geldt dat voor alle tien. Na een limietfout stopt de functie met opvragen: die regels krijgen de reden `rate_limited_evidence_not_checked` en de samenvatting telt ze in `query_failures.rate_limited_rows`. Dat zegt niets over ontbrekend bewijs; draai de controle later opnieuw of over een kortere periode.

## Bekende grenzen

- Afletteren op een grootboekkaart (bijv. kruisposten) zit niet in de REST API van Exact. Die regels krijgen `matching_status: unknown` en worden nooit geraden.
- Getallen komen als JSON-getallen van Exact. Bedragen met meer dan 15 cijfers kunnen niet exact worden doorgegeven; voor gewone boekhoudbedragen is dat geen probleem.
- De voorstel-functie voor facturen uit exact-mcp (lokaal, zonder iets in Exact te maken) zit hier nog niet in.
