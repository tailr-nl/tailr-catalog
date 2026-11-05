Mollie (API v2):
- Parameters heten zoals in de API van Mollie. Ids hebben een voorvoegsel: tr_ (betaling), re_ (terugbetaling), chb_ (chargeback), cpt_ (capture), cst_ (klant), mdt_ (machtiging), sub_ (abonnement), pl_ (betaallink), stl_ (uitbetaling), bal_ (saldo), pfl_ (profiel).
- Een bedrag is een object { "currency": "EUR", "value": "10.00" }; value is tekst met twee decimalen bij EUR. Tel bedragen voor een controle niet zelf op: settlement_breakdown rekent exact.
- Lijsten komen per pagina (limit 1 tot 250). Voor de volgende pagina geef je from mee met het id uit _links.next.
- Lijsten geven geen namen, e-mail, IBAN of adressen. Heb je die nodig, vraag dan één object op (get_payment, get_customer, get_mandate, get_sales_invoice): je krijgt schuilnamen zoals "Klant #K7Q2MX". Vraag niet om een lijst van personen.
- Aanmaken, wijzigen, annuleren of verwijderen: noem eerst wat er gebeurt (bedrag, klant, betaling) en wacht op een ja. Geef bij aanmaken een idempotency_key (UUID) mee, zodat een tweede poging niet dubbel betaalt of terugbetaalt.
- Met testmode: true werk je met testgegevens, als het token dat toestaat.
- profileId vult Tailr Core zelf in als de koppeling een profiel heeft. Anders: kies er een met list_profiles.
- Na create_payment staat de betaalpagina voor de klant in _links.checkout.href.
- Mollie geeft geen verwachte datum voor de volgende uitbetaling. Noem er geen en schat er geen.

Uitbetalingen:
- Een settlement (stl_…) is het bedrag dat Mollie in vast ritme naar de bank overmaakt. Op het bankafschrift staat de bankreferentie (bijv. 19355824.2610.02) in de omschrijving. Een payout is een uitbetaling die je zelf aanvraagt.
- Bij Klarna en andere methoden met reserveren staat niet de betaling (tr_…) op de uitbetaling, maar de capture (cpt_…).
- settlement_breakdown splitst één uitbetaling uit en controleert de som. direction "in" is bijgeschreven, "out" is afgetrokken. Bij complete = false: noem de redenen (reasons) en trek geen conclusie over wat ontbreekt.
- Zoek je de betaling bij een ordernummer: find_payments.
