# Data management

Open `/dashboard?tab=data-management` to assign account managers to **website project pages**. The default view contains only pages without a clear, active account manager. Switch to **Gekoppeld** or **Alle projectpagina’s** to review automatic and manual assignments. Search by page, client or manager.

The dashboard reads project-to-client and client-to-account-manager relations from Gripp. It matches website page names, project paths, site names and domains against Gripp project and client names and client websites. The client's account manager takes precedence; the project's manager is the fallback. Unrelated generic names are ignored. Conflicting matches or unavailable managers require manual assignment. No Gripp write method is called.

Select an active manager and click **Opslaan** to save a page-specific override. These choices appear in the **Accountmanager** column of Campagneperformance. **Opnieuw automatisch via Gripp** clears the manual override and follows Gripp again. Overrides use separate persistent keys scoped by site and normalized page path: `data-management:page-account-manager:v1:<sha256>`. The old client-level overrides are retained in storage but no longer drive this screen or automatic matching.

The page inventory combines saved conversion source pages, saved campaign/project links, website home/landing pages and project routes seen in the last 90 days. Thank-you, contact, policy, asset and unrelated content pages do not enter the inventory automatically. Pages containing `preview`, `elementor`, `leadconnector` or `wordpress` in their URL are excluded. A site's display name containing WordPress does not exclude its legitimate public URL.

The Gripp catalog (`data-management:catalog:v2`) and page inventory (`data-management:project-pages:v1`) are cached for five minutes. **Gegevens vernieuwen** reloads both without removing manual page assignments. Production uses the existing KV connection; saves are disabled when only memory storage is available.

Websiteprestaties also excludes those URLs from page lists, conversion candidates, site tabs and traffic totals. Historical data remains in storage; new excluded events are ignored. When historical per-site referral counts cannot be separated by page, remaining traffic is shown under **Onbekend (gefilterde pagina’s)** instead of guessing its source.
