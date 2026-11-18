# Ledoux Performance Tracker

Plugin WordPress qui collecte les performances d'un site et les envoie vers le dashboard central Next.js.

## Installation

1. Uploader `gripp-site-analytics.zip` via `Extensions > Ajouter une extension > Televerser une extension`.
2. Activer `Ledoux Performance Tracker` dans WordPress.
3. Ouvrir `Reglages > Ledoux Performance Tracker`.
4. Si l'URL du dashboard n'est pas deja preconfiguree dans le ZIP, renseigner uniquement l'URL du dashboard, par exemple `https://votre-domaine.vercel.app`.
5. Cliquer sur `Tester la connexion dashboard` quand le statut est connecte.
6. Vider le cache WordPress/hebergeur/CDN apres installation ou mise a jour du plugin.

Le plugin s'enregistre ensuite automatiquement depuis l'admin ou depuis la premiere requete publique si le ZIP est preconfigure. Le dashboard genere le Site ID et le token, puis le plugin les stocke dans WordPress.

## Configuration Next.js

Pour l'enregistrement automatique en production, configure un stockage persistant:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

`SITE_ANALYTICS_SITES` reste supporte pour declarer des sites manuellement, mais il n'est plus obligatoire pour les nouveaux sites qui utilisent l'enregistrement automatique.

Optionnel: si `SITE_ANALYTICS_REGISTRATION_TOKEN` est configure dans Vercel, le ZIP du plugin doit etre preconfigure avec le meme token.

## Donnees collectees

- Vues par page
- Visiteurs uniques et sessions avec identifiants aleatoires hashes cote dashboard
- Referents et UTM source / medium / campaign
- Temps actif par page et profondeur de scroll

Le plugin ne transmet pas l'adresse IP et ne stocke pas le token site dans le navigateur.

## Consentement aux statistiques (version 0.2.5)

La banniere du site doit enregistrer le cookie first-party `cc_toestemming`, lisible
par JavaScript, contenant du JSON encode pour une URL. Seul le booleen
`keuzes.statistieken: true` autorise la lecture et l'ecriture des identifiants dans
`localStorage`. La chaine `"true"`, un cookie absent ou invalide ne vaut pas consentement.

Sans consentement, le tracker supprime ses deux anciennes cles au demarrage, sans
en lire les valeurs: `gripp_site_analytics_visitor_id` et `gripp_site_analytics_session`.
Il continue a envoyer les evenements avec des identifiants temporaires en memoire.
Les visiteurs uniques, sessions et taux de conversion bases sur ces identifiants
peuvent donc etre moins fiables. Le format des evenements reste inchange.

Quand le visiteur accepte les statistiques, le prochain evenement conserve les
identifiants de la page dans `localStorage` (ping toutes les 15 secondes si visible).
En cas de retrait du consentement, la banniere doit recharger la page pour supprimer
les anciennes cles et utiliser de nouveaux identifiants temporaires.

Pour mettre a jour une installation existante, uploader le nouveau ZIP puis choisir
de remplacer la version installee. Les reglages de connexion restent en base WordPress.
Vider ensuite les caches du site et verifier que `assets/tracker.js?ver=0.2.5` est charge.
La banniere et le headcode ne sont pas installes ni modifies par cette mise a jour.
