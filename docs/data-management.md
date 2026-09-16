# Data management

Open `/dashboard?tab=data-management` to link account managers to clients. Search by client or project name, select an active employee and click **Opslaan**. Expand a client to see its projects. All projects inherit the client's saved account manager. **Geen accountmanager** explicitly removes the dashboard assignment, including an initial assignment from Gripp.

Clients, employees and project-to-client relations are read from Gripp. Clients include companies with the CUSTOMER role and companies referenced by projects. Existing Gripp client account managers are used until a dashboard override is saved. Inactive employees remain visible when already assigned but cannot receive new assignments.

Assignments affect only this dashboard. No Gripp write method is called. Overrides are stored persistently under separate `data-management:client-account-manager:v1:<clientId>` JSON cache keys, so simultaneous updates to different clients do not overwrite one another. Production requires the existing KV connection; saves are disabled if only volatile memory storage is available.

The catalog contains only names, identifiers, active/archive flags and relations. It is cached for five minutes under `data-management:catalog:v1`. **Gegevens vernieuwen** reloads Gripp metadata while preserving saved dashboard assignments. Invalid data or unavailable storage produces an error rather than a successful save or demo data.
