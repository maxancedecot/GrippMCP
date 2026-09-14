# Campagneperformance

Open `/dashboard?tab=campaigns`. De tab deelt de periodefilters (7, 14, 30 en 90 dagen) en sitefilters met Websiteprestaties. Alleen deze tab vraagt advertentie- en CRM-data op. Alle requests gebeuren op de server; de browser ontvangt geen API-tokens of contactgegevens.

## Accounts koppelen

Configureer `CAMPAIGN_PERFORMANCE_SITES` als JSON in de serveromgeving. `siteId` moet overeenkomen met een geregistreerde WordPress-site of een ID in `SITE_ANALYTICS_SITES`. Eén configuratie per site:

```json
[
  {
    "siteId": "client-site",
    "google": {
      "customerId": "1234567890",
      "loginCustomerId": "9876543210",
      "campaignIds": ["111111111"]
    },
    "facebook": {
      "adAccountId": "123456789012345",
      "campaignIds": ["222222222"]
    },
    "ghl": {
      "locationId": "location-id",
      "installId": "location-id",
      "calendarIds": ["calendar-id"]
    }
  }
]
```

`google`, `facebook` en `ghl` zijn afzonderlijk optioneel. Zonder een koppeling verschijnt “Niet gekoppeld”. Laat `campaignIds` weg om alle campagnes van het account te gebruiken. Een lege lijst wordt afgewezen om onbedoeld het hele account in te laden te voorkomen. Gebruik specifieke campagne-ID’s als meerdere websites één advertentieaccount delen. `loginCustomerId` is optioneel en kan ook globaal via `GOOGLE_ADS_LOGIN_CUSTOMER_ID` worden gezet. Google-ID’s mogen streepjes bevatten; Facebook-account-ID’s mogen met `act_` beginnen.

### Google Ads

Zet `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` en `GOOGLE_ADS_REFRESH_TOKEN` in de serveromgeving. De refresh token moet bij dit OAuth-clientpaar horen, met de scope `https://www.googleapis.com/auth/adwords`, en toegang geven tot de gekoppelde klantaccounts. De server wisselt de refresh token in voor een access token. Gebruik een refresh token uit de normale OAuth-toestemmingsflow van het Google Cloud-project. Een apart ingestelde Google Ads MCP-koppeling maakt deze servervariabelen niet automatisch beschikbaar aan de dashboardapp.

`GOOGLE_ADS_API_VERSION` is standaard `v25`. `GOOGLE_ADS_DEVELOPER_TOKEN` wordt alleen meegestuurd wanneer ingesteld. Sinds 9 september 2026 bepaalt Google Ads de toegang via het Google Cloud-project van de OAuth-client; controleer de toegang van dat project. Zie [Google Ads-toegang](https://developers.google.com/google-ads/api/docs/api-policy/developer-token) en [REST-rapportage](https://developers.google.com/google-ads/api/rest/common/search).

### Facebook / Meta Ads

Zet `META_ADS_ACCESS_TOKEN` op een token met `ads_read` en toegang tot de ingestelde advertentieaccounts, bijvoorbeeld een system user-token uit Meta Business. `META_ADS_API_VERSION` is standaard `v26.0`. De integratie leest accountvaluta, campagnestatussen en campagne-insights via de Marketing API. Tokens staan in de Authorization-header. Paginering gebruikt cursors op de vaste Graph API-host.

Referenties: [Meta’s campagnevelden](https://www.postman.com/meta/facebook-marketing-api/request/45f5yj7/getcampaignsdetails), [Meta’s insightvelden](https://www.postman.com/meta/facebook-marketing-api/request/7mjf11e/getinsightforadsgroup), [officiële SDK-versie](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js).

### GoHighLevel

De bestaande versleutelde OAuth-tokenopslag wordt hergebruikt. Verbind eerst de locatie via de bestaande HighLevel OAuth-flow (`/api/connect/start`, met de bestaande toegangscontrole). Bij een agency-installatie maak je eerst een Location-installatie via `ghl_connect_location`. `installId` is standaard gelijk aan `locationId`; een token voor een andere locatie wordt afgewezen. Het dashboard maakt zelf geen nieuwe agency- of locatie-installaties aan.

De installatie heeft leesrechten nodig voor contacten, kalenders en kalenderafspraken (`contacts.readonly`, `calendars.readonly`, `calendars/events.readonly`). Laat `calendarIds` weg voor alle kalenders van de locatie. `GHL_CAMPAIGN_API_VERSION` is standaard `2021-07-28`, in lijn met de bestaande OAuth-integratie; dit is apart instelbaar bij een API-migratie.

Referenties: [Contacten zoeken](https://marketplace.gohighlevel.com/docs/ghl/contacts/search-contacts-advanced/), [Kalenders](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-calendars/), [Kalenderafspraken](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-calendar-events/).

## Betekenis van de cijfers

- **Google live:** minimaal één ingeschakelde campagne met primary status `ELIGIBLE`, `LIMITED` of `LEARNING`. Dit is de huidige geschiktheid voor weergave, geen garantie op vertoningen op dit moment. Onbekende statussen blijven onbekend.
- **Facebook live:** een actief advertentieaccount met minimaal één campagne met `effective_status=ACTIVE` waarvan de starttijd is verstreken en de stoptijd nog niet. Dit is de status op campagneniveau.
- **Leads:** unieke nieuwe contacten op `dateAdded` in de gekoppelde GoHighLevel-locatie binnen de gekozen periode. Ook organische en geïmporteerde contacten kunnen meetellen; er wordt geen advertentieattributie verondersteld.
- **Afspraken:** unieke afspraken waarvan `startTime` in de periode ligt. Geannuleerde en ongeldige afspraken en geblokkeerde tijdsloten tellen niet mee. De selectie gebruikt de afspraakdatum, niet de boekingsdatum.
- **CTR:** totale klikken gedeeld door totale vertoningen × 100; percentages worden niet gemiddeld. Facebook gebruikt alle klikken en alle Meta-plaatsingen, inclusief Instagram. Zonder vertoningen is CTR niet beschikbaar.
- **Spend:** uitgaven in de accountvaluta. Google `cost_micros` wordt gedeeld door 1.000.000. Historische kosten van gestopte/verwijderde campagnes blijven meetellen. Bedragen in verschillende valuta worden afzonderlijk getoond.
- **Website CVR:** bestaande WordPress-CVR: unieke bezoekers aan gekoppelde bedankingspagina’s gedeeld door unieke bezoekers aan gekoppelde bronpagina’s. Per site worden bezoekers ontdubbeld. Een site zonder koppelingen of bronbezoekers krijgt “Geen metingen”.

CRM-datums gebruiken volledige kalenderdagen in `Europe/Brussels`, inclusief zomer-/wintertijd. Google en Meta rapporteren dezelfde kalenderdatums in hun eigen accounttijdzone. Campagnestatussen staan los van het historische datumbereik. De timestamp bovenaan de pagina hoort bij de WordPress-metingen.

Totalen ontdubbelen campagnes op account + campagne-ID en CRM-records op locatie + record-ID. Bij gedeelde accounts kunnen site-rijen daarom overlappen, terwijl de totaalkaarten ontdubbeld blijven. Als een bron ontbreekt, toont het subtotaal alleen gekoppelde sites en vermeldt het de dekking. API-fouten leveren “Niet beschikbaar” op, nooit een gefingeerde nul of “Niet live”. Elke provider faalt afzonderlijk. Onvolledige paginering geeft een fout in plaats van een te laag totaal; maximaal 100 pagina’s per lijst, 12 seconden per request en 45 seconden voor de advertentie-/CRM-requests van een dashboardweergave.

## Verificatie

`npm test` controleert onder meer gewogen CTR, micro-euroconversie, huidige versus historische status, paginering, campagnefilters, kalenderuitsluitingen, tijdzones, ontdubbeling en foutisolatie met gesimuleerde API-responses. Live verificatie vereist de echte account-ID’s, tokens en een gekoppelde WordPress-site. Vergelijk na configuratie één site en één periode met Google Ads, Meta Ads Manager en GoHighLevel.
