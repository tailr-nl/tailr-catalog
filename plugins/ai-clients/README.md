# AI-tools en apps toestaan

Bepaal per OAuth-client (Claude, ChatGPT, Claude Code, een eigen app) of hij met Tailr Core mag verbinden. Sessies in de browser en API-sleutels gaan er niet langs.

- **Standaard voor nieuwe AI-tools:**
  - toestaan;
  - blokkeren;
  - **goedkeuring nodig:** een nieuwe client wordt geweigerd tot je hem toestaat. Hij staat dan in **Te bevestigen** van Tailr Core (beheerders krijgen een mail): *Bevestigen* staat hem toe, *Afwijzen* blokkeert hem. Je kunt ook op het tabblad *AI-tools toestaan* van de pluginpagina kiezen; dan wordt het item ingetrokken.
  - De medewerker ziet het al op het **toestemmingsscherm** ("Deze AI-tool wacht op goedkeuring van je beheerder"), nog vóór hij op *Toestaan* klikt (guard `oauth.consent`).
- **Eigen apps** (onder *Toegang → Apprechten*) mogen altijd, tenzij je ze blokkeert.
- **Rollen waarvoor de controle niet geldt:** bijvoorbeeld ontwikkelaars; zij mogen elke AI-tool verbinden. Hun rechten in de rechtenmatrix (*Toegang → Rechten*) blijven gewoon gelden.
- **Overzicht:** wie welke client gebruikt, met het aantal geweigerde pogingen. Wachtende clients staan bovenaan.

**Waar:** de standaard voor nieuwe AI-tools en de rollen waarvoor de controle niet geldt, staan op de pluginpagina, tabblad *Instellingen* (`/plugins/ai-clients`, via *Plugins → Geïnstalleerd* → *Beheren*). De kern controleert de waarden, vraagt de sudo-bevestiging en zet elke wijziging in het auditlog (sinds 1.5.0, `api.settings.define`, plugin-API 1.8). De keuze per client (*Standaard*, *Toestaan*, *Blokkeren*) maak je op het tabblad *AI-tools toestaan* van dezelfde pagina; die geldt meteen. Bij het bijwerken van 1.4.x gaan de oude instellingen eenmalig mee.

**Alleen het zakelijke account** (geen gratis ChatGPT die op je data traint):
1. Voeg de connector toe in je Claude- of ChatGPT-organisatie, verbind één keer met je werkaccount, en zet die client op *Toestaan*.
2. Zet de standaard op *goedkeuring nodig* (of *blokkeren*).
3. Verbindt iemand met een privé-account, dan ziet hij op het toestemmingsscherm dat het op goedkeuring wacht, en staat de client in *Te bevestigen*.

Tailr Core ziet de client en de gebruiker, niet het account aan de kant van de AI-tool.

**Samen met *Verbonden tools*:** deze plugin beslist of een OAuth-client voor de organisatie mag verbinden. Een toegestane client volgt daarna de actuele rollen en uitzonderingen van de medewerker, zonder tweede rechtenmatrix op het toestemmingsscherm. Een medewerker verbindt en trekt in onder *Verbonden tools*, in het menu onder zijn naam. Identiteiten uit `api.identities` zijn geen OAuth-clients: de uitgevende plugin bepaalt hun plafond.

**Let op:** volgens de documentatie gebruiken Claude, ChatGPT en Claude Code met CIMD één client voor iedereen, privé én organisatie. Dat is nog niet met echte accounts getest . Stap 1 hierboven geeft dan geen aparte client. Dit werkt wel (nog te testen):

1. Maak onder *Toegang → Apprechten* een app (*Nieuwe app*), met op het tabblad *Sleutels en inloggen* *Inloggen met Tailr Core*:
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
