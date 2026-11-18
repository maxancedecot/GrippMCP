# Toestemming voor de browsertracker

`public/site-analytics.js` gebruikt `localStorage` alleen als de first-party cookie
`cc_toestemming` geldige URL-encoded JSON bevat met `keuzes.statistieken === true`.
De cookiebanner op de bezochte site moet deze cookie voor het script leesbaar maken.
De tekst `"true"`, ontbrekende toestemming en ongeldige cookies gelden niet als toestemming.

Zonder toestemming verwijdert de tracker bij het starten alleen
`gripp_site_analytics_visitor_id` en `gripp_site_analytics_session`, zonder hun waarden
uit te lezen. ID's blijven dan in het geheugen van het geladen document. Een nieuwe
pagina met een nieuw document krijgt nieuwe ID's; SPA-navigatie binnen hetzelfde
document behoudt de tijdelijke ID's. Paginaweergaven, bronnen, scroll en actieve tijd
worden nog steeds verzonden.

Bij accepteren bewaart de volgende meetevent dezelfde tijdelijke ID's. Een zichtbare
pagina verstuurt elke 15 seconden een engagement-event. Bij intrekken stopt de tracker
met het lezen en schrijven van ID's. De cookiebanner moet de pagina herladen om de
oude opgeslagen ID's te wissen en nieuwe tijdelijke ID's te gebruiken.

Het endpoint, de payload en de meetevents blijven gelijk. Het optionele veld `consent`
wordt niet verstuurd: de huidige backend accepteert dit veld niet. Unieke bezoekers,
sessies en daarvan afgeleide conversiepercentages blijven daardoor ook tijdelijke ID's
meetellen. Het correct scheiden van deze statistieken vereist een aparte wijziging aan
de backend en het dashboard.

Deze toestemming geldt ook voor de afzonderlijke WordPress-tracker vanaf pluginversie
`0.2.5`. Bestaande WordPress-installaties moeten de nieuwe plugin-ZIP installeren en
de sitecache legen. De cookiebanners worden hiermee niet aangepast. Sites zonder
`cc_toestemming` gebruiken voortaan ook tijdelijke ID's.

## Controle en uitrol

Automatische checks:

```sh
node --check public/site-analytics.js
node --check wordpress/gripp-site-analytics/assets/tracker.js
node --import tsx --test test/browserTracker.test.ts test/browserAnalytics.test.ts test/wordpressTracker.test.ts
npm test
```

Na deployment op dezelfde URL `/site-analytics.js`, controleer eventuele CDN-caches
en de geserveerde versie door naar `magOpslaan` te zoeken. Test op de echte site in
een schoon browserprofiel met DevTools open:

1. Zonder bannerkeuze: een page_view en na 15 seconden een engagement-event; geen
   van beide analytics-sleutels in Local Storage.
2. Open een tweede pagina: nieuwe tijdelijke bezoekers- en sessie-ID's.
3. Accepteer statistieken: na de volgende ping staan de ID's uit dat event in Local Storage.
4. Open een tweede pagina: dezelfde bezoekers- en sessie-ID's.
5. Weiger statistieken via de banner: de pagina herlaadt, beide sleutels verdwijnen
   en meetevents gebruiken nieuwe tijdelijke ID's.

Een lokale test bevestigt niet de werking van de live banner, deployment of caches.
Voor WordPress: upload `wordpress/gripp-site-analytics.zip`, vervang de bestaande
plugin en leeg de sitecache. Controleer versie `0.2.5` en voer dezelfde bannertests uit.
De download via `/api/site-analytics/plugin` bevat na deployment dezelfde tracker en
configureert automatisch de dashboard-URL. De lokale ZIP bevat geen vooraf ingevulde
dashboard-URL; bij een update blijven bestaande verbindingsinstellingen behouden.
