# AI-tools en apps toestaan

Bepaal per OAuth-client (Claude, ChatGPT, Claude Code, een eigen app) of hij met Tailr Core mag verbinden. Sessies in de browser en API-sleutels gaan er niet langs.

- **Standaard voor nieuwe AI-tools:**
  - toestaan;
  - blokkeren;
  - **goedkeuring nodig:** een nieuwe client wordt geweigerd tot je hem toestaat. Hij staat dan in **Te bevestigen** van Tailr Core (beheerders krijgen een mail): *Bevestigen* staat hem toe, *Afwijzen* blokkeert hem. Je kunt ook op het scherm van de plugin kiezen; dan wordt het item ingetrokken.
  - De medewerker ziet het al op het **toestemmingsscherm** ("Deze AI-tool wacht op goedkeuring van je beheerder"), nog vóór hij op *Toestaan* klikt (guard `oauth.consent`).
- **Eigen apps** (onder Apps en dashboards) mogen altijd, tenzij je ze blokkeert.
- **Rollen die altijd mogen:** bijvoorbeeld voor ontwikkelaars.
- **Overzicht:** wie welke client gebruikt, met het aantal geweigerde pogingen. Wachtende clients staan bovenaan.

**Alleen het zakelijke account** (geen gratis ChatGPT die op je data traint):
1. Voeg de connector toe in je Claude- of ChatGPT-organisatie, verbind één keer met je werkaccount, en zet die client op *Toestaan*.
2. Zet de standaard op *goedkeuring nodig* (of *blokkeren*).
3. Verbindt iemand met een privé-account, dan ziet hij op het toestemmingsscherm dat het op goedkeuring wacht, en staat de client in *Te bevestigen*.

Tailr Core ziet de client en de gebruiker, niet het account aan de kant van de AI-tool.

**Samen met AI & tools:** deze plugin beslist of een OAuth-client voor de organisatie mag verbinden. Een toegestane client volgt daarna de actuele rollen en uitzonderingen van de medewerker, zonder tweede rechtenmatrix op het toestemmingsscherm. Verbinden en intrekken staan samen onder *AI & tools*. Identiteiten uit `api.identities` zijn geen OAuth-clients: de uitgevende plugin bepaalt hun plafond.

**Let op:** volgens de documentatie gebruiken Claude, ChatGPT en Claude Code met CIMD één client voor iedereen, privé én organisatie. Dat is nog niet met echte accounts getest . Stap 1 hierboven geeft dan geen aparte client. Dit werkt wel (nog te testen):

1. Maak onder *Apps en dashboards* een app met *Inloggen met Tailr Core*:
   - type server, dus met client-secret;
   - redirect `https://claude.ai/api/mcp/auth_callback` (ChatGPT: `https://chatgpt.com/connector_platform_oauth_redirect`).
2. Vul client-id en geheim in bij de connector van de organisatie (*Use your own OAuth client*).
3. Blokkeer hier de CIMD-client van de AI-tool (client-id `https://claude.ai/oauth/mcp-oauth-client-metadata`).

Zonder eigen client kan het alleen per gebruiker of rol. Zie het stappenplan in `docs/ai-clients-test.md` (Tailr Core).

**Overzicht per client** (vanaf 1.3.0):

- aanmelding (CIMD-URL, dynamisch via DCR of eigen app);
- publiek of met geheim;
- volledige redirect;
- software-id;
- aanmaakdatum;
- aantal gebruikers.
