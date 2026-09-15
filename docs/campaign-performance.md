# Campagneperformance

Open `/dashboard?tab=campaigns`. De tab deelt de periodefilters (7, 14, 30 en 90 dagen, of een eigen begin- en einddatum) en sitefilters met Websiteprestaties. De hoofdtafel toont één rij per projectpagina, met de bijbehorende Facebook-campagnes, bezoekers, Brochure, Afspraak en project-CVR. De account- en websitetotalen staan in een uitklapbaar overzicht. Alleen deze tab vraagt advertentiedata op. Alle requests gebeuren op de server; de browser ontvangt geen API-tokens.

## Een periode kiezen

Gebruik **Van**, **Tot en met** en **Toepassen** om dezelfde kalenderdatums als in Ads Manager te kiezen. Beide dagen tellen mee; een eigen periode mag maximaal 90 dagen omvatten en kan in het verleden liggen. De URL bewaart dit als `start=YYYY-MM-DD&end=YYYY-MM-DD`. De periode blijft behouden bij wisselen van website, tab of conversiekoppeling. Een preset (7d, 14d, 30d, 90d) verwijdert de eigen datums en eindigt vandaag in Brussel.

Websitebezoekers, Brochure, Afspraak, CVR, Google- en Meta-insights gebruiken exact deze periode. Huidige campagnestatussen blijven los van het datumbereik staan. Onvolledige, omgekeerde, ongeldige, toekomstige of te lange perioden tonen een melding; het dashboard vermeldt dan expliciet welke standaardperiode wordt gebruikt. De server valideert datums voordat er API- of opslagrequests plaatsvinden.

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

`google` en `facebook` zijn afzonderlijk optioneel. Zonder een koppeling verschijnt “Niet gekoppeld”. Laat `campaignIds` weg om het volledige account als basis te gebruiken. Voor Facebook tellen altijd alleen campagnes met “Ledoux” in hun naam mee, ongeacht hoofdletters; de naamfilter wordt ook toegepast op expliciete campagne-ID’s. Een lege lijst wordt afgewezen om onbedoeld het hele account in te laden te voorkomen. Gebruik specifieke campagne-ID’s als meerdere websites één advertentieaccount delen. `loginCustomerId` is optioneel en kan ook globaal via `GOOGLE_ADS_LOGIN_CUSTOMER_ID` worden gezet. Google-ID’s mogen streepjes bevatten; Facebook-account-ID’s mogen met `act_` beginnen.

### Google Ads

Zet `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` en `GOOGLE_ADS_REFRESH_TOKEN` in de serveromgeving. De refresh token moet bij dit OAuth-clientpaar horen, met de scope `https://www.googleapis.com/auth/adwords`, en toegang geven tot de gekoppelde klantaccounts. De server wisselt de refresh token in voor een access token. Gebruik een refresh token uit de normale OAuth-toestemmingsflow van het Google Cloud-project. Een apart ingestelde Google Ads MCP-koppeling maakt deze servervariabelen niet automatisch beschikbaar aan de dashboardapp.

`GOOGLE_ADS_API_VERSION` is standaard `v25`. `GOOGLE_ADS_DEVELOPER_TOKEN` wordt alleen meegestuurd wanneer ingesteld. Sinds 9 september 2026 bepaalt Google Ads de toegang via het Google Cloud-project van de OAuth-client; controleer de toegang van dat project. Zie [Google Ads-toegang](https://developers.google.com/google-ads/api/docs/api-policy/developer-token) en [REST-rapportage](https://developers.google.com/google-ads/api/rest/common/search).

### Facebook / Meta Ads

Zet `META_ADS_ACCESS_TOKEN` op een token met `ads_read` en toegang tot de ingestelde advertentieaccounts, bijvoorbeeld een system user-token uit Meta Business. `META_ADS_API_VERSION` is standaard `v26.0`. De integratie leest accountvaluta, campagnenamen, campagnestatussen, campagne-insights en de bestemmingslinks van advertenties via de Marketing API. Tokens staan in de Authorization-header. Paginering gebruikt cursors op de vaste Graph API-host.

Referenties: [Meta’s campagnevelden](https://www.postman.com/meta/facebook-marketing-api/request/45f5yj7/getcampaignsdetails), [Meta’s insightvelden](https://www.postman.com/meta/facebook-marketing-api/request/7mjf11e/getinsightforadsgroup), [officiële SDK-versie](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js), [officiële CTR-velden](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ads-insights.js).

### Vastgelegde campagne/projectmatches

Gecontroleerde matches worden opgeslagen in de bestaande dashboardopslag onder `campaign-project-matches:v1`, als een JSON-array:

```json
[
  { "siteId": "client-site", "accountId": "123456789012345", "campaignId": "222222222", "sourcePaths": ["/home"] }
]
```

Een match geldt uitsluitend voor deze website, dit advertentieaccount en deze campagne-ID. Een campagne kan meerdere projectpaden hebben; paden worden zonder trailing slash vergeleken en `p_slug` blijft behouden. Een expliciete match kan geverifieerde varianten zoals de advertentiebestemming `/` en de gemeten projectpagina `/home` verbinden. Er worden geen nieuwe bedankpagina's of conversies aangemaakt. De huidige Ledoux-naamfilter, website/accountselectie en live-status blijven van toepassing. Volledig gematchte campagnes vereisen geen nieuwe aanvraag voor advertentielinks. Nieuwe campagnes zonder vaste match gebruiken de bestaande bestemmingslinkcontrole; onbekende koppelingen verschijnen bij **Nog aan een projectpagina te koppelen**.

### Leads en afspraken uit Websiteprestaties

Campagneperformance hergebruikt de kolommen **Brochure** en **Afspraak** uit Websiteprestaties. Beide tabs gebruiken dezelfde gedeelde berekening van de gekoppelde project- en bedankpagina’s. Er is geen CRM-koppeling nodig. Een bestaande `ghl`-configuratie blijft toegestaan, maar wordt voor deze dashboardcijfers niet meer gebruikt; het dashboard vraagt geen contacten, kalenders of CRM-tokens meer op.

De geselecteerde website en periode worden op de WordPress-metingen toegepast voordat de conversies worden opgeteld. Een site zonder paginakoppelingen toont “Niet gekoppeld”. Bij bestaande koppelingen zonder conversies wordt nul getoond, net als in de andere view. De totaalkaarten tellen de zichtbare websites op.

## Betekenis van de cijfers

- **Google live:** minimaal één ingeschakelde campagne met primary status `ELIGIBLE`, `LIMITED` of `LEARNING`. Dit is de huidige geschiktheid voor weergave, geen garantie op vertoningen op dit moment. Onbekende statussen blijven onbekend.
- **Facebook live:** een actief advertentieaccount met minimaal één campagne met `effective_status=ACTIVE` waarvan de starttijd is verstreken en de stoptijd nog niet. Dit is de status op campagneniveau, uitsluitend voor campagnes met “Ledoux” in hun naam.
- **Leads:** de som van de kolom Brochure uit Websiteprestaties: bezoekers van gekoppelde bedankpagina’s met “brochure” in het pad of de titel.
- **Afspraken:** de som van de kolom Afspraak uit Websiteprestaties. Zoals in die view worden de overige gekoppelde bedankpagina’s in deze kolom ingedeeld. Dit meet websiteconversies, niet de status of datum van een afspraak in een agenda.
- **Google CTR:** totale klikken gedeeld door totale vertoningen × 100; percentages worden niet gemiddeld. Zonder vertoningen is CTR niet beschikbaar.
- **Facebook link-CTR per campagne:** Meta's `inline_link_click_ctr`: de kolom **CTR (taux de clics sur le lien)** / **CTR (link click-through rate)** in Ads Manager, gebaseerd op linkklikken gedeeld door vertoningen × 100. Dit verschilt van de eerder getoonde unieke link-CTR. Alleen momenteel lopende campagnes met “Ledoux” in de naam binnen de websitekoppeling tellen mee: actief advertentieaccount, `effective_status=ACTIVE`, starttijd verstreken en stoptijd niet verstreken. We vragen `campaign_id,campaign_name,inline_link_click_ctr,impressions` met `level=campaign`, uitsluitend de geselecteerde campagne-ID's en `time_increment=all_days` voor de gekozen periode. De tabel toont de exacte CTR en actuele naam per campagne. Insights worden op campagne-ID gekoppeld, onafhankelijk van naam of antwoordvolgorde. Zonder lopende campagnes verschijnt “Geen lopende Ledoux-campagne”. Ontbrekende insights zijn alleen toegestaan als die campagne ook geen vertoningen heeft; dan verschijnt geen percentage. Ontbrekende linkklikvelden, onverwachte/dubbele campagne-ID's, onvolledige paginering of API-fouten leveren “Niet beschikbaar” op. Er is geen terugval op account-CTR, CTR voor alle klikken of unieke link-CTR. Alle Meta-plaatsingen, inclusief Instagram, tellen mee.
- **Campagnes aan projectpagina's koppelen:** een vastgelegde match heeft voorrang. Voor overige campagnes leest de server de bestemmingslinks uit actieve link-, video-, carrousel- en dynamische advertenties van de lopende campagne. Oude of gepauzeerde advertenties bepalen de huidige paginakoppeling niet. Gecontroleerde bestemmingslinks worden 15 minuten bewaard per account en exacte campagneset; status en CTR worden altijd opnieuw opgevraagd. Bij een tijdelijke Meta-fout kunnen links uit de laatste 24 uur worden gebruikt, met een zichtbare melding. Nieuwe of gestopte campagnes veranderen de cachesleutel. Elke campagne toont alleen links op het domein en binnen het pad van de gekoppelde website; campagnes met uitsluitend bestemmingen buiten die website tellen niet mee in haar CTR; `www` wordt gelijkgesteld. De pagina wordt op exact pad gekoppeld aan de projectpagina in Websiteprestaties, ongeacht trailing slash. Trackingparameters en fragments worden verwijderd; `p_slug` blijft behouden zodat verschillende projecten op hetzelfde pad apart blijven. Advertentietekst, afbeeldingslinks en gelijkende campagnenamen worden niet gebruikt om een match te gokken. Een bestemmingspagina zonder conversiekoppeling blijft zichtbaar als link, zonder te claimen dat er CVR-metingen zijn. Bij meerdere projectpagina's staat dezelfde campagne-CTR bij elk betrokken project met een melding dat dit cijfer voor die pagina's samen geldt; de API geeft geen afzonderlijke campagne-link-CTR per bestemmingspagina. Overzichtstotalen tellen dezelfde campagne maar eenmaal mee. Niet gevonden of niet controleerbare pagina's worden benoemd; fouten in het lezen van advertentielinks blokkeren de CTR niet.
- **Gewogen Facebook link-CTR:** alleen de overzichtskaart toont een gemiddelde, gewogen met de vertoningen van elke campagne. Campagnes worden op account + campagne-ID ontdubbeld over overlappende websitekoppelingen. Dit komt overeen met linkklikken ÷ vertoningen over deze campagnes, afgezien van de afronding van Meta’s campagnepercentages. De tabel behoudt elk afzonderlijk campagnepercentage. Als een benodigde campagnemeting ontbreekt, is het totaal niet beschikbaar. Er wordt geen aanvullend accountniveau-request voor CTR uitgevoerd.
- **Spend:** uitgaven in de accountvaluta. Google `cost_micros` wordt gedeeld door 1.000.000. Historische kosten van gestopte/verwijderde campagnes blijven meetellen binnen de gekozen periode. Voor Facebook geldt ook hier de Ledoux-naamfilter: de actuele campagnenaam is leidend; voor campagnes die alleen nog in historische insights voorkomen, gebruiken we `campaign_name`. Campagnes zonder “Ledoux” worden ook uit de uitgaven en campagnetotalen verwijderd. Een geldige maar volledig uitgefilterde accountkoppeling blijft verbonden en toont nul uitgaven; ontbrekende namen of onbekende ingestelde campagne-ID’s geven “Niet beschikbaar”. Bedragen in verschillende valuta worden afzonderlijk getoond.
- **Projectcijfers:** Brochure en Afspraak komen uit exact dezelfde projectrij als in Websiteprestaties. Project-CVR = (Brochure + Afspraak) ÷ bronbezoekers × 100; zoals in die view is de uitkomst nul bij nul bronbezoekers. Meerdere campagnes op één project dupliceren zijn cijfers niet. Een advertentiepagina zonder bedankpaginakoppeling krijgt geen verzonnen conversies of CVR.
- **Website CVR:** bestaande WordPress-CVR: unieke bezoekers aan gekoppelde bedankingspagina’s gedeeld door unieke bezoekers aan gekoppelde bronpagina’s. Per site worden bezoekers ontdubbeld. Een site zonder koppelingen of bronbezoekers krijgt “Geen metingen”.

Websitecijfers gebruiken de gekozen kalenderdagen in `Europe/Brussels`. Google en Meta rapporteren dezelfde kalenderdatums in hun eigen accounttijdzone. Campagnestatussen staan los van het historische datumbereik. De timestamp bovenaan de pagina hoort bij de WordPress-metingen.

Advertentietotalen ontdubbelen campagnes op account + campagne-ID. Lead- en afspraaktotalen tellen de kolommen van alle zichtbare projectpagina’s op, exact zoals in Websiteprestaties; bezoekers kunnen over meerdere conversiepagina’s meetellen. Deze aantallen zijn niet uitsluitend aan advertenties toegeschreven. Als een bron ontbreekt, toont het subtotaal alleen gekoppelde sites en vermeldt het de dekking. API-fouten leveren “Niet beschikbaar” op, nooit een gefingeerde nul of “Niet live”. Elke advertentieprovider faalt afzonderlijk en beïnvloedt de websitetelling niet. Onvolledige paginering geeft een fout in plaats van een te laag totaal; maximaal 100 pagina’s per lijst, 12 seconden per request en 45 seconden voor de advertentierequests van een dashboardweergave.

## Verificatie

`npm test` controleert onder meer gewogen CTR, exacte Ads Manager-link-CTR per campagne, ontdubbelde campagneweging over overlappende websites, vastgelegde projectmatches en matches via advertentiebestemmingen, homepagevarianten, meerdere campagnes per project zonder dubbele conversies, micro-euroconversie, huidige versus historische status, de Ledoux-naamfilter (hoofdletters, historische uitgaven, expliciete ID’s en lege selecties), paginering en foutisolatie met gesimuleerde API-responses. Conversietests vergelijken Brochure en Afspraak met de campagnetotalen over meerdere projecten, sites en periodes, inclusief nul en ontbrekende koppelingen. Datumtests controleren inclusieve daggrenzen, schrikkeldagen, zomer-/wintertijd, foutmeldingen en het bewaren/wissen van datums in filters. Een integratietest controleert de telling vanaf geregistreerde WordPress-bezoeken voor gekozen historische en actuele perioden; providerregressies controleren dezelfde datums in Google- en Meta-requests en het verschil tussen link-CTR en unieke link-CTR. Live verificatie vereist de echte account-ID’s, tokens en een gekoppelde WordPress-site. Vergelijk dezelfde site en periode in Websiteprestaties en Campagneperformance, en de advertentiecijfers met Google Ads en Meta Ads Manager.
