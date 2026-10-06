# CRM-tellingen in het accountmanagerdashboard

De tags in de contactdetails bepalen de kolom. **Afspraken (CRM)** telt contacten met `ledoux` en `afspraak`. **Leads (CRM)** telt contacten met `ledoux` en `brochure` of `contact`. Afspraak heeft voorrang wanneer beide combinaties aanwezig zijn. De pipeline bepaalt het project; de pipelinefase bepaalt de telling niet.

Het periodefilter gebruikt de aanmaakdatum van het contact (`dateAdded`), met inclusieve kalenderdagen in Europe/Brussels. Elk contact telt binnen een project eenmaal mee, ook in meerdere gekoppelde pipelines. Verschillende CRM-subaccounts houden hun eigen contacten.

Project-CVR en de CVR bij een accountmanagerfilter gebruiken `(leads + afspraken) / websitebezoekers × 100`. Ontbrekende contactgegevens of relevante datums geven een onbeschikbare telling; CVR blijft onbeschikbaar zolang een van de twee tellingen ontbreekt.

CRM-aanvragen worden per subaccount gedoseerd en binnen een dashboardlading gedeeld. Een tijdelijke HTTP 429 leidt tot maximaal twee herpogingen na de vereiste wachttijd. Een resterende tijdelijke aanvraaglimiet in de dashboardcache mag na één minuut opnieuw laden. Een uitgeputte daglimiet wordt afzonderlijk gemeld en niet automatisch opnieuw geprobeerd binnen dezelfde aanvraag.

Verificatie: `npm test` controleert tags, overlap, ontdubbeling, periodegrenzen, ontbrekende gegevens, projectaggregatie, aanvraaglimieten, herpogingen en snapshotherstel.
