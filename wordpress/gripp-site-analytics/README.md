# Gripp Site Analytics

Plugin WordPress qui collecte les performances d'un site et les envoie vers le dashboard central Next.js.

## Installation

1. Uploader `gripp-site-analytics.zip` via `Extensions > Ajouter une extension > Televerser une extension`.
2. Activer `Gripp Site Analytics` dans WordPress.
3. Ouvrir `Reglages > Gripp Analytics`.
4. Si l'URL du dashboard n'est pas deja preconfiguree dans le ZIP, renseigner uniquement l'URL du dashboard, par exemple `https://votre-domaine.vercel.app`.

Le plugin s'enregistre ensuite automatiquement. Le dashboard genere le Site ID et le token, puis le plugin les stocke dans WordPress.

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
