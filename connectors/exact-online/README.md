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
| `review_receipt_evidence` (code) | Bij uitgaande bankregels: is er een document met bijlage? |
| `me`, `list_sales_invoices`, `list_accounts`, `list_items`, `list_transaction_lines`, `list_receivables` | Losse lijsten met OData-filters. |

## Wat de code mag (manifest)

- **Host:** alleen het Exact-domein uit de instellingen (standaard `start.exactonline.nl`).
- **Verzoeken:** alleen `GET` op vaste resources: TransactionLines, BankEntryLines, ReportingBalance, FinancialPeriods, GLAccounts, Receivables, Payments, Documents, DocumentAttachments, PurchaseEntries en Divisions.
- Bladeren alleen met de `$skiptoken` uit `__next`; de volgende URL zelf wordt nooit opgevraagd.
- De code ziet het OAuth-token niet. Tailr Core voegt het toe en vernieuwt het.

## Limieten

Exact staat 60 aanroepen per minuut en 5.000 per dag per administratie toe. Een grootboekkaart over een heel jaar kan tientallen aanroepen kosten. Boven 60 per minuut wacht Tailr Core, en na de maximale wachttijd volgt `rate_limited`. Vraag dan een kortere periode.

## Bekende grenzen

- Afletteren op een grootboekkaart (bijv. kruisposten) zit niet in de REST API van Exact. Die regels krijgen `matching_status: unknown` en worden nooit geraden.
- Getallen komen als JSON-getallen van Exact. Bedragen met meer dan 15 cijfers kunnen niet exact worden doorgegeven; voor gewone boekhoudbedragen is dat geen probleem.
- De voorstel-functie voor facturen uit exact-mcp (lokaal, zonder iets in Exact te maken) zit hier nog niet in.
