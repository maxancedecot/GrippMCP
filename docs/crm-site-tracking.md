# CRM-websites via de header meten

Plak op iedere gepubliceerde CRM-website in **Head tracking code**:

```html
<script defer src="https://dashboard.ledouxmedia.be/site-analytics.js" data-project="ledoux"></script>
```

Gebruik dezelfde code op alle pagina’s, ook de bedankpagina’s voor Brochure en Afspraak. Publiceer de website en bezoek een pagina. Na de eerste ontvangen meting verschijnt het domein automatisch in de websitelijst. `www` en het hoofddomein gebruiken dezelfde registratie. Een reeds geregistreerde website behoudt haar ID en paginakoppelingen.

In **Websiteprestaties → CVR-koppelingen** koppel je de projectpagina aan de bijbehorende bedankpagina’s. Dezelfde metingen voeden CVR, Brochure/Leads en Afspraak/Afspraken in beide dashboardtabs. Zonder paginakoppelingen wordt geen CVR verzonnen. De tracker herkent niet zelfstandig welke bronpagina bij welke brochure of afspraak hoort.

Gebruik voor een succesvolle aanvraag of boeking een bedankpagina met `bedankt`, `thankyou` of `thank-you` in het pad. Een klik op de verzendknop of het openen van een agenda telt niet als conversie. Formulieren die alleen een bevestiging in een iframe tonen, vereisen een redirect naar een getrackte bedankpagina. Metingen beginnen bij de installatie; eerder verkeer wordt niet teruggehaald.

De tracker wacht op de pagina, voorkomt een dubbele installatie en slaat iframes, de gebruikelijke HighLevel-previewroute en WordPress-beheer over. Op sites met de WordPress-plugin blijft die plugin leidend. Paginaovergangen via de History API worden bijgehouden. Het script verzamelt pageviews, unieke bezoekers/sessies, actieve tijd en scrolldiepte. Het leest geen formuliervelden; URL-fragmenten en queryparameters worden verwijderd, behalve `p_slug` voor bestaande projectkoppelingen. UTM-bron en medium worden apart bewaard.

## Techniek

`POST /api/site-analytics/browser` is een publiek endpoint uitsluitend voor metingen. `data-project="ledoux"` is een publieke projectaanduiding, geen geheim. Een geldige HTTPS-Origin moet exact overeenkomen met de meegestuurde pagina-URL; het endpoint kiest zelf de site en accepteert geen site-ID, registratietoken of beheertoken uit de browser. Het registreert een onbekend domein bij de eerste geldige pageview, zonder de bestaande registratie- of verwijdersleutels terug te sturen. Bestaande serverkoppelingen via `/collect` en `/register` behouden hun eigen tokens.

Zoals bij andere publieke browsertrackers zijn metingen niet cryptografisch bewijsbaar: een HTTP-client kan Origin en publieke gegevens namaken. Het endpoint is geen beheertoegang. De invoer is begrensd tot 8 KiB en gevalideerde gebeurtenisvelden. Het haalt zelf geen externe website-URL’s op. De metingen gebruiken de bestaande analytics-opslag en ontdubbeling van bezoekers. Plaats het script via de bestaande toestemmingsinstellingen van de website als die analytics pas na toestemming laden.

## Verificatie

`npm test` controleert de browserroute, hergebruik van bestaande sites, domeinscheiding, CORS, ongeldige invoer, de volledige conversietelling, en het script bij laden in de header, dubbele plaatsing, geblokkeerde opslag en paginaovergangen. `npm run build:vercel` controleert de routes en dashboardweergave.
