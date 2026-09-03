# Gripp Site Analytics

Plugin WordPress qui collecte les performances d'un site et les envoie vers le dashboard central Next.js.

## Installation

1. Copier le dossier `gripp-site-analytics` dans `wp-content/plugins/`.
2. Activer `Gripp Site Analytics` dans WordPress.
3. Ouvrir `Reglages > Gripp Analytics`.
4. Renseigner:
   - Endpoint dashboard: `https://votre-domaine.vercel.app/api/site-analytics/collect`
   - Site ID: identifiant unique, par exemple `client-site`
   - Token site: token configure dans `SITE_ANALYTICS_SITES`

## Configuration Next.js

Ajouter chaque site dans `SITE_ANALYTICS_SITES`:

```json
[
  {
    "id": "client-site",
    "name": "Client Site",
    "url": "https://client.example",
    "token": "generez-un-token-long-unique"
  }
]
```

Un token peut etre genere avec:

```bash
openssl rand -hex 32
```

## Donnees collectees

- Vues par page
- Visiteurs uniques et sessions avec identifiants aleatoires hashes cote dashboard
- Referents et UTM source / medium / campaign
- Temps actif par page et profondeur de scroll

Le plugin ne transmet pas l'adresse IP et ne stocke pas le token site dans le navigateur.
