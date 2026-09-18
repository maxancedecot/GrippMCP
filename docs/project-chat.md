# Claude-projectassistent

Op `/projectmanagement` staat een inklapbare chat voor vragen over Gripp. Claude
ontvangt de vraag en relevante gegevens via de bestaande Gripp-MCP. De chat gebruikt
uitsluitend Gripp; andere MCP-koppelingen zijn niet aangesloten.

## Activeren

Stel deze servervariabelen in (lokaal in `.env.local`, in productie in de
omgevingsvariabelen van het Vercel-project) en herstart of deploy opnieuw:

| Variabele | Betekenis |
| --- | --- |
| `ANTHROPIC_API_KEY` | API-sleutel van het Anthropic-account met API-tegoed. |
| `PROJECT_CHAT_ACCESS_KEY` | Apart, sterk chatwachtwoord dat bevoegde collega's invullen. Gebruik bijvoorbeeld de uitvoer van `openssl rand -hex 24`. |
| `GRIPP_DASHBOARD_API_TOKEN` | De Gripp-sleutel voor het dashboard. Als deze ontbreekt, gebruikt de chat `GRIPP_API_TOKEN`. |
| `ANTHROPIC_MODEL` | Optioneel model-ID; standaard `claude-sonnet-5`. |

Een Claude-webabonnement of MCP-koppeling in Claude.ai wordt niet automatisch
overgenomen door deze website. De website heeft haar eigen API-configuratie nodig.
De API-sleutels worden nooit naar de browser gestuurd. Het chatwachtwoord is een
aparte toegangscontrole voor deze chat en beschermt niet de overige dashboardroutes.
Iedereen met dit wachtwoord krijgt dezelfde leestoegang tot de geconfigureerde Gripp-account.

## Gebruik

Open de projectassistent, vul bij Chattoegang het chatwachtwoord in en stel een vraag,
bijvoorbeeld “Welke taken zijn te laat?” of “Welke projecten van klant X moeten
deze maand worden opgeleverd?”. Vervolgvragen kunnen verwijzen naar het gesprek.
De laatste tien vraag/antwoordparen gaan mee als context. Met Nieuw gesprek wis je
de lokale gesprekscontext; bij herladen verdwijnen gesprek en wachtwoord eveneens.
De chat schrijft geen gesprekken naar een database of browseropslag. De vraag,
meegestuurde gesprekscontext en opgevraagde Gripp-gegevens worden wel door Anthropic verwerkt.

Tijdens een vraag toont de chat de voortgang; onder het antwoord staan de
daadwerkelijke Gripp-opvragingen. Dit is een oproepenoverzicht, geen onafhankelijke
garantie dat elke uitspraak juist is. Stoppen breekt de lopende aanvraag af.
Gripp wordt live geraadpleegd; de chat gebruikt geen demogegevens of dashboardcache.

## Werking en grenzen

De backend verbindt een MCP-client via `InMemoryTransport` met de bestaande
Gripp-MCP-server in dezelfde Node.js-aanvraag. In de chatmodus registreert die
server alleen `gripp_list_entities`, `gripp_describe_entity`, `gripp_get` en
`gripp_getone`. Schrijftools en generieke calls/batches zijn afwezig; de dispatcher
controleert dezelfde lijst opnieuw. De bestaande externe MCP-endpoints behouden
hun mogelijkheden.

De Claude Messages API kiest tools; de backend voert die uit en stuurt de
resultaten terug totdat Claude antwoordt. De browser ontvangt voortgang en het
antwoord als NDJSON. Resultaten uit tools worden als onbetrouwbare gegevens
behandeld, niet als instructies. Fouten worden gemeld zonder ruwe upstreamdetails.

Een vraag heeft maximaal zes toolrondes, zestien Gripp-opvragingen en 105 seconden.
Per toolresultaat gaat maximaal 24.000 tekens mee, met een expliciete melding
wanneer de inhoud is afgekapt. Pagina's zijn maximaal 250 records. Grote vragen
kunnen daardoor een gedeeltelijk antwoord opleveren. Vraag dan gerichter per project
of periode. Een te lang Claude-antwoord levert een melding op in plaats van een
onopgemerkt afgebroken antwoord.

De route vereist het chatwachtwoord en dezelfde origin, valideert berichtrollen en
lengtes, begrenst de requestbody en heeft per serverinstantie maximaal drie lopende
vragen en twintig aanvragen per minuut. Dit is geen gedeelde limiet over alle
Vercel-instanties; gebruik bij bredere uitrol ook Vercel Firewall/rate limiting en
een Anthropic-budgetlimiet. Elke vraag kan meerdere betaalde Claude API-aanroepen doen.

## Verificatie

`npm test` controleert onder meer de echte MCP-transportverbinding met gesimuleerde
Gripp-responses, de Claude-toollus met gesimuleerde API-responses, de afwezigheid van
schrijftools, foutafhandeling en invoervalidatie. `npx tsc --noEmit` controleert ook
de Next.js-interface. Live verificatie vereist de bovenstaande sleutels.

API-referenties: [Messages API](https://platform.claude.com/docs/en/api/messages/create),
[tool calls afhandelen](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
en [model-ID's](https://platform.claude.com/docs/en/models/overview).
