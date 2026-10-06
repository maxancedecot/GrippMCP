# Google Ads-campagnes aan projecten koppelen

Open **Gegevensbeheer → Google Ads**. Selecteer het advertentieaccount op naam, klik op **Campagnes laden**, kies een projectpagina en selecteer de gewenste campagnes. Met **Accounts vernieuwen** wordt de accountlijst opnieuw opgehaald.

De lijst toont rechtstreeks toegankelijke advertentieaccounts en de advertentieaccounts onder toegankelijke manageraccounts. Als `GOOGLE_ADS_LOGIN_CUSTOMER_ID` is ingesteld, wordt de lijst beperkt tot dat account en zijn onderliggende accounts. Manageraccounts zelf worden niet aangeboden als campagneaccount. Namen, klantnummers en inactieve status helpen gelijknamige accounts onderscheiden.

De bestaande OAuth-koppeling en ontwikkelaarstoken worden gebruikt. De juiste manager-ID wordt automatisch meegenomen bij het laden en opgeslagen bij de projectkoppeling. Het dashboard gebruikt die ID ook voor campagnecijfers. Bestaande koppelingen zonder manager-ID blijven de ingestelde standaard gebruiken.

Bij ontbrekende toegang of een laadfout verschijnt een melding en kan de lijst opnieuw worden geladen. Een leeg accountoverzicht wordt apart gemeld. Wisselen van account wist de geladen campagnes en selectie.

API-referenties: [toegankelijke accounts](https://developers.google.com/google-ads/api/docs/account-management/listing-accounts), [directe en indirecte managerclients](https://developers.google.com/google-ads/api/fields/v25/customer_client), [Google Ads-toegangsmodel](https://developers.google.com/google-ads/api/docs/oauth/access-model).
