# CRM-tellingen in het accountmanagerdashboard

De huidige GoHighLevel-pipelinefase bepaalt de kolom. **Leads (CRM)** telt alleen opportunities in **Nieuwe lead** (of **New lead**). **Afspraken (CRM)** telt alleen opportunities in **Afspraak** (of **Appointment**), inclusief expliciete labels zoals **Afspraak ingepland** en **Appointment booked**. Andere fases, waaronder opvolging, geannuleerde afspraken en algemene intake- of demofases, tellen in geen van beide kolommen mee.

Een opportunity die van Nieuwe lead naar Afspraak verhuist, telt dus alleen nog als afspraak. De periodefilter blijft gebaseerd op de aanmaakdatum voor nieuwe leads en de laatste fasewijziging voor afspraken, met kalenderdagen in Europe/Brussels. Dit zijn tellingen op basis van de huidige fase, geen historisch overzicht van alle faseovergangen.

Project-CVR en de CVR bij een accountmanagerfilter gebruiken `(leads + afspraken) / websitebezoekers × 100`. Beide kolommen zijn afzonderlijke groepen, zodat een opportunity niet dubbel meetelt. Een ontbrekende fase of noodzakelijke datum geeft een onbeschikbare telling; CVR blijft onbeschikbaar zolang een van de twee tellingen ontbreekt.

Verificatie: `npm test` bevat tests voor faseherkenning, verplaatsing tussen fases, ontdubbeling over pagina’s, periodegrenzen, ontbrekende CRM-data, projectaggregatie en accountmanager-CVR.
