Exact Online-begrippen:
- Bedragen: AmountDC is in de valuta van de administratie. AmountDC > 0 is debet, < 0 is credit. Reken niet zelf met regels; gebruik de functies hieronder, die met exacte decimalen tellen.
- Status van boekingen: 20 = open (nog niet verwerkt), 50 = verwerkt. De grootboekkaart neemt standaard beide mee; zeg dat erbij.
- Afletteren: de status van verkoop- en inkoopfacturen komt uit Exact zelf (get_matching_details). Afletteren op een grootboekkaart (bijv. 17910 Kruisposten Mollie) zit niet in de API van Exact. Leid het nooit af uit nulsaldi, tegengestelde bedragen, OffsetID of "Afgehandeld".
- "Afgehandeld" bij een bankregel betekent niet afgeletterd.
- Bonnetjes: review_receipt_evidence zegt alleen of er een document met bijlage aan een bankregel hangt. Stel nooit vast dat een bon ontbreekt; zeg "nakijken".
- complete = false of warnings: noem ze, en trek geen conclusie over ontbrekende bedragen.

Functies:
- Grootboekkaart met begin- en eindsaldo: get_general_ledger_card.
- Een boeking met al haar regels: get_financial_entry.
- Is factuur X betaald of afgeletterd: get_matching_details.
- Bankregels in een periode (bijv. om een Mollie-uitbetaling af te letteren): list_bank_lines_by_period.
