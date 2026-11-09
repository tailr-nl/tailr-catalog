# Google Search Console (sign in)

Variant van [Google Search Console](../google-search-console/README.md) waarbij je inlogt met je eigen Google-account in plaats van een serviceaccount. Dezelfde functies, dezelfde uitleg voor de AI (`context.md`) en dezelfde code-functie `search_analytics_all`; alleen de login en het stappenplan verschillen. **Alleen lezen**: scope `webmasters.readonly`.

## Instellen

1. Schakel in Google Cloud Console de **Search Console API** in.
2. Stel het **toestemmingsscherm** in (doelgroep Extern, publicatiestatus In productie; op Testen verloopt de login na 7 dagen).
3. Maak een **OAuth-client** van het type Webapplicatie met het terugkeeradres van je Tailr Core als geautoriseerde omleidings-URI.
4. Voeg in Tailr Core de koppeling toe met de Client-id en het clientgeheim, log in bij Google en kies de website uit de lijst (*Websites*).

Het stappenplan in Tailr Core loopt deze stappen met je door, met de juiste links. Google toont bij een eigen app mogelijk "Google heeft deze app niet geverifieerd": kies Geavanceerd en ga door.

## Functies, limieten en code

Zie de [README van de hoofdconnector](../google-search-console/README.md). De variant wordt nog met de hand gelijk gehouden met de hoofdconnector; de `tools/`, `context.md` en de functieteksten horen bij elke wijziging opnieuw overgenomen te worden (met "het gekoppelde account" in plaats van "het serviceaccount").
