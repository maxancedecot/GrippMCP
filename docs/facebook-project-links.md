# Facebook-campagnes aan projecten koppelen

Open **Data management → Facebook Ads**. Kies het advertentieaccount op naam uit de keuzelijst en klik op **Campagnes laden**, kies de projectpagina en selecteer één of meerdere campagnes. Klik op **Campagnes koppelen**. Actieve en gepauzeerde campagnes kunnen worden geselecteerd; verwijderde en gearchiveerde campagnes worden niet aangeboden.

De accountlijst laadt automatisch bij het openen van Facebook Ads. **Accounts vernieuwen** haalt de actuele accounts op waartoe de bestaande Meta-koppeling toegang heeft. Bij het kiezen van een ander account worden de geladen campagnes en selectie gewist, zodat campagnes uit verschillende accounts niet door elkaar lopen.

De opgeslagen koppelingen staan per project onderaan. Je kunt campagnes aan een ander project toewijzen of een koppeling verwijderen. Google-koppelingen en campagnes uit andere accounts blijven behouden. Handmatige Facebook-koppelingen werken ook voor accounts die nog niet via automatische detectie aan een website gekoppeld zijn en voor campagnes zonder ‘Ledoux’ in hun naam.

Het accountmanagerdashboard toont bij het gekozen project de huidige Live-status en de CTR en spend voor de geselecteerde periode. Een handmatige koppeling krijgt voorrang op automatisch gevonden advertentiebestemmingen, ook wanneer de advertentie nog naar een andere website verwijst. Meerdere accounts kunnen hetzelfde project voeden; account- en campagne-ID bepalen samen welke meting wordt gebruikt.

De functies wijzigen alleen dashboardkoppelingen. Meta wordt via de bestaande servercredential gelezen; campagnes, advertenties en budgetten worden niet aangepast. Voor opslaan is persistente dashboardopslag vereist.

Verificatie: `npm test` controleert account-ID’s, paginering, selectie en verwijdering, behoud van Google-koppelingen, meerdere Meta-accounts en voorrang van handmatige koppelingen. `npm run build:vercel` controleert het beheerscherm en serveracties.
