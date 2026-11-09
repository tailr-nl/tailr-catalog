# Google Search Console: inloggen met je eigen Google-account

Dit is een variant van [Google Search Console](../google-search-console/README.md) met precies dezelfde functies. Het verschil zit alleen in het inloggen: in plaats van een serviceaccount maak je in Google Cloud Console een OAuth-client, en log je één keer in met een Google-account dat de property kan zien. Kies deze route als je geen beheerder van de property bent.

Dit bestand en `connector.json`, `context.md` en `tools/` in deze map worden gemaakt met `node scripts/make-variants.mjs google-search-console`. Pas ze niet met de hand aan: wijzig de hoofdconnector en draai het script opnieuw (zie `CONTRIBUTING.md`).

Scope: `https://www.googleapis.com/auth/webmasters.readonly`. Wil je de login stoppen, trek dan de toegang in bij je Google-account (*Beveiliging → Apps van derden*).

Uitleg over de functies, persoonsgegevens en quota: zie de [README van Google Search Console](../google-search-console/README.md).
