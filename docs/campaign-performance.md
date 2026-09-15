# Campagneperformance

Open `/dashboard?tab=campaigns`. De tab deelt de periodefilters (7, 14, 30 en 90 dagen) en sitefilters met Websiteprestaties. Alleen deze tab vraagt advertentiedata op. Alle requests gebeuren op de server; de browser ontvangt geen API-tokens.

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
    }
  }
]
```

`google` en `facebook` zijn afzonderlijk optioneel. Zonder een koppeling verschijnt “Niet gekoppeld”. Laat `campaignIds` weg om alle campagnes van het account te gebruiken. Een lege lijst wordt afgewezen om onbedoeld het hele account in te laden te voorkomen. Gebruik specifieke campagne-ID’s als meerdere websites één advertentieaccount delen. `loginCustomerId` is optioneel en kan ook globaal via `GOOGLE_ADS_LOGIN_CUSTOMER_ID` worden gezet. Google-ID’s mogen streepjes bevatten; Facebook-account-ID’s mogen met `act_` beginnen.

### Google Ads

Zet `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` en `GOOGLE_ADS_REFRESH_TOKEN` in de serveromgeving. De refresh token moet bij dit OAuth-clientpaar horen, met de scope `https://www.googleapis.com/auth/adwords`, en toegang geven tot de gekoppelde klantaccounts. De server wisselt de refresh token in voor een access token. Gebruik een refresh token uit de normale OAuth-toestemmingsflow van het Google Cloud-project. Een apart ingestelde Google Ads MCP-koppeling maakt deze servervariabelen niet automatisch beschikbaar aan de dashboardapp.

`GOOGLE_ADS_API_VERSION` is standaard `v25`. `GOOGLE_ADS_DEVELOPER_TOKEN` wordt alleen meegestuurd wanneer ingesteld. Sinds 9 september 2026 bepaalt Google Ads de toegang via het Google Cloud-project van de OAuth-client; controleer de toegang van dat project. Zie [Google Ads-toegang](https://developers.google.com/google-ads/api/docs/api-policy/developer-token) en [REST-rapportage](https://developers.google.com/google-ads/api/rest/common/search).

### Facebook / Meta Ads

Zet `META_ADS_ACCESS_TOKEN` op een token met `ads_read` en toegang tot de ingestelde advertentieaccounts, bijvoorbeeld een system user-token uit Meta Business. `META_ADS_API_VERSION` is standaard `v26.0`. De integratie leest accountvaluta, campagnestatussen en campagne-insights via de Marketing API. Tokens staan in de Authorization-header. Paginering gebruikt cursors op de vaste Graph API-host.

Referenties: [Meta’s campagnevelden](https://www.postman.com/meta/facebook-marketing-api/request/45f5yj7/getcampaignsdetails), [Meta’s insightvelden](https://www.postman.com/meta/facebook-marketing-api/request/7mjf11e/getinsightforadsgroup), [officiële SDK-versie](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js).

### Leads en afspraken uit Websiteprestaties

Campagneperformance hergebruikt de kolommen **Brochure** en **Afspraak** uit Websiteprestaties. Beide tabs gebruiken dezelfde gedeelde berekening van de gekoppelde project- en bedankpagina’s. Er is geen CRM-koppeling nodig. Een bestaande `ghl`-configuratie blijft toegestaan, maar wordt voor deze dashboardcijfers niet meer gebruikt; het dashboard vraagt geen contacten, kalenders of CRM-tokens meer op.

De geselecteerde website en periode worden op de WordPress-metingen toegepast voordat de conversies worden opgeteld. Een site zonder paginakoppelingen toont “Niet gekoppeld”. Bij bestaande koppelingen zonder conversies wordt nul getoond, net als in de andere view. De totaalkaarten tellen de zichtbare websites op.

## Betekenis van de cijfers

- **Google live:** minimaal één ingeschakelde campagne met primary status `ELIGIBLE`, `LIMITED` of `LEARNING`. Dit is de huidige geschiktheid voor weergave, geen garantie op vertoningen op dit moment. Onbekende statussen blijven onbekend.
- **Facebook live:** een actief advertentieaccount met minimaal één campagne met `effective_status=ACTIVE` waarvan de starttijd is verstreken en de stoptijd nog niet. Dit is de status op campagneniveau.
- **Leads:** de som van de kolom Brochure uit Websiteprestaties: bezoekers van gekoppelde bedankpagina’s met “brochure” in het pad of de titel.
- **Afspraken:** de som van de kolom Afspraak uit Websiteprestaties. Zoals in die view worden de overige gekoppelde bedankpagina’s in deze kolom ingedeeld. Dit meet websiteconversies, niet de status of datum van een afspraak in een agenda.
- **Google CTR:** totale klikken gedeeld door totale vertoningen × 100; percentages worden niet gemiddeld. Zonder vertoningen is CTR niet beschikbaar.
- **Facebook unieke link-CTR:** Meta's `unique_link_clicks_ctr`, gebaseerd op unieke linkklikkers gedeeld door uniek bereik × 100. Alleen de momenteel lopende campagnes binnen de websitekoppeling tellen mee: actief advertentieaccount, `effective_status=ACTIVE`, starttijd verstreken en stoptijd niet verstreken. We vragen `unique_link_clicks_ctr` en `reach` op accountniveau op, met uitsluitend deze campagne-ID's en `time_increment=all_days` voor de gekozen periode. Ook een koppeling voor een volledig account krijgt deze filter. Zonder lopende campagnes verschijnt “Geen lopende campagne” met een streepje en wordt geen unieke-link-CTR-request gedaan. Als de lopende campagnes niet betrouwbaar kunnen worden bepaald, verschijnt “Niet beschikbaar”; de selectie valt nooit terug op het volledige account. Unieke cijfers per dag of campagne worden niet opgeteld. Alle Meta-plaatsingen, inclusief Instagram, tellen mee. Zonder bereik verschijnt geen percentage; ontbrekende unieke velden of API-fouten vallen niet terug op gewone CTR of unieke CTR voor alle klikken.
- **Gewogen Facebook unieke link-CTR:** voor het totaal worden uitsluitend de lopende campagnes van zichtbare websites binnen hetzelfde account samengevoegd en nogmaals door Meta ontdubbeld. Het totaal over verschillende accounts is het gewogen gemiddelde van de door Meta gerapporteerde unieke link-CTR per account, met bereik als gewicht. Het dashboard benoemt dit als gewogen: personen worden niet tussen advertentieaccounts ontdubbeld. We gebruiken de link-CTR zelf voor de weging, zodat andere klikdefinities niet in dit cijfer terechtkomen. Als een benodigde accountmeting ontbreekt, is dit totaal niet beschikbaar. De unieke link-CTR kan afzonderlijk uitvallen terwijl spend en campagnestatus wel beschikbaar blijven.
- **Spend:** uitgaven in de accountvaluta. Google `cost_micros` wordt gedeeld door 1.000.000. Historische kosten van gestopte/verwijderde campagnes blijven meetellen. Bedragen in verschillende valuta worden afzonderlijk getoond.
- **Website CVR:** bestaande WordPress-CVR: unieke bezoekers aan gekoppelde bedankingspagina’s gedeeld door unieke bezoekers aan gekoppelde bronpagina’s. Per site worden bezoekers ontdubbeld. Een site zonder koppelingen of bronbezoekers krijgt “Geen metingen”.

Websitecijfers gebruiken de gekozen kalenderdagen in `Europe/Brussels`. Google en Meta rapporteren dezelfde kalenderdatums in hun eigen accounttijdzone. Campagnestatussen staan los van het historische datumbereik. De timestamp bovenaan de pagina hoort bij de WordPress-metingen.

Advertentietotalen ontdubbelen campagnes op account + campagne-ID. Lead- en afspraaktotalen tellen de kolommen van alle zichtbare projectpagina’s op, exact zoals in Websiteprestaties; bezoekers kunnen over meerdere conversiepagina’s meetellen. Deze aantallen zijn niet uitsluitend aan advertenties toegeschreven. Als een bron ontbreekt, toont het subtotaal alleen gekoppelde sites en vermeldt het de dekking. API-fouten leveren “Niet beschikbaar” op, nooit een gefingeerde nul of “Niet live”. Elke advertentieprovider faalt afzonderlijk en beïnvloedt de websitetelling niet. Onvolledige paginering geeft een fout in plaats van een te laag totaal; maximaal 100 pagina’s per lijst, 12 seconden per request en 45 seconden voor de advertentierequests van een dashboardweergave.

## Verificatie

`npm test` controleert onder meer gewogen CTR, unieke link-CTR over de volledige selectie, samengevoegde campagnefilters binnen een account, micro-euroconversie, huidige versus historische status, paginering en foutisolatie met gesimuleerde API-responses. Conversietests vergelijken Brochure en Afspraak met de campagnetotalen over meerdere projecten, sites en periodes, inclusief nul en ontbrekende koppelingen. Een integratietest controleert de telling vanaf geregistreerde WordPress-bezoeken. Live verificatie vereist de echte account-ID’s, tokens en een gekoppelde WordPress-site. Vergelijk dezelfde site en periode in Websiteprestaties en Campagneperformance, en de advertentiecijfers met Google Ads en Meta Ads Manager.
