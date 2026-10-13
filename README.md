# TV Time Rebirth

<p align="center">
  <img src="frontend/assets/logo.png" alt="TV Time Rebirth" width="140" />
</p>

Une application mobile **auto-hébergée** pour suivre tes séries et tes films : ce que tu as vu, ce qu'il te reste à voir et les prochaines sorties. Le projet est né de la fermeture de TV Time, pour retrouver le même usage en gardant la main sur ses données.

Il n'y a **pas de serveur public** : chacun déploie son propre backend et compile sa propre application, pour soi, sa famille ou ses amis.

> **Tu veux juste l'installer ?** Le tutoriel complet, pas à pas, est dans **[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

## Fonctionnalités

- **Séries** : suivi épisode par épisode, saisons entières, revisionnages, statut (en cours, à jour, arrêtée, à voir plus tard…)
- **Films** : films vus, à voir, revisionnages
- **Explorer** : recherche de films et séries via TMDB, fiches détaillées (saisons, épisodes, dates de sortie)
- **Statistiques** : temps passé, répartition par genre, chaîne, année…
- **Favoris** et **watchlist**
- **Import TV Time** : reprise d'un export TV Time (JSON séries / films, ou ZIP) avec les dates de visionnage d'origine
- **Export / sauvegarde** de toutes tes données au format JSON, ré-importable
- **Social** : profils avec avatar et bannière, abonnements entre utilisateurs du même serveur
- Plusieurs comptes par serveur

L'interface est en français.

## Architecture

```
tv-time-rebirth/
├── backend/             API REST en Go (Gin) + base SQLite
├── frontend/            Application mobile React Native (Expo SDK 54)
├── docker-compose.yml   Déploiement du backend
└── docs/INSTALLATION.md Tutoriel d'installation complet
```

| Brique | Techno | Rôle |
|---|---|---|
| Backend | Go 1.25, Gin, SQLite (pur Go, sans CGO), JWT | Comptes, visionnages, watchlist, favoris, abonnements, avatars |
| Frontend | Expo / React Native, TypeScript | L'application Android (iOS possible mais non testé) |
| Données films/séries | [TMDB](https://www.themoviedb.org/) | Appelé directement par l'application, avec **ta** clé API |

Le backend ne stocke que tes données personnelles (comptes, historique). Les affiches, résumés et dates de sortie viennent de TMDB.

## Démarrage rapide

Pour celles et ceux qui connaissent déjà Docker et Expo. Sinon, suis [le tutoriel](docs/INSTALLATION.md).

```bash
git clone https://github.com/<ton-pseudo>/tv-time-rebirth.git
cd tv-time-rebirth

# 1. Backend
cp .env.example .env            # puis renseigne JWT_SECRET (openssl rand -hex 32)
docker compose up -d --build    # API sur http://localhost:8080/api

# 2. Application
cd frontend
cp .env.example .env            # clé TMDB + URL de ton backend
npm install
npx expo start                  # développement

# 3. APK
npm install -g eas-cli
eas login && eas init
eas env:create --environment preview --name EXPO_PUBLIC_TMDB_API_KEY --value "<clé>" --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value "https://<ton-serveur>/api" --visibility plaintext
eas build --platform android --profile preview
```

## Configuration

### Backend (`.env` à la racine)

| Variable | Obligatoire | Défaut | Description |
|---|---|---|---|
| `JWT_SECRET` | oui | — | Secret de signature des jetons de connexion. Longue valeur aléatoire, à garder privée. |
| `PORT` | non | `8080` | Port exposé sur la machine hôte. |

Hors Docker, le backend lit aussi `DB_PATH` (défaut `./data/tv-time.db`) et `UPLOAD_DIR` (défaut `./data/uploads`).

### Application (`frontend/.env`)

| Variable | Obligatoire | Description |
|---|---|---|
| `EXPO_PUBLIC_TMDB_API_KEY` | oui | Clé API TMDB (v3). |
| `EXPO_PUBLIC_API_URL` | oui | URL du backend, avec `/api` à la fin, sans slash final. |
| `EXPO_PUBLIC_UPDATE_URL` | non | Lien ouvert par le bouton « Mettre à jour » quand le serveur exige une version plus récente. |

Les variables `EXPO_PUBLIC_*` sont **embarquées en clair dans l'APK**. Ne distribue ton APK qu'aux personnes à qui tu fais confiance, et n'y mets jamais de secret serveur.

### Versions : le point à ne pas rater

Le backend refuse toute application dont la version n'est pas **exactement** celle qu'il attend (réponse `426`, l'app affiche alors l'écran « Une mise à jour est disponible »). Ces deux valeurs doivent toujours être identiques :

- `version` dans [frontend/app.json](frontend/app.json)
- `RequiredAppVersion` dans [backend/internal/middleware/version.go](backend/internal/middleware/version.go)

Quand tu changes l'une, change l'autre, puis redéploie le backend **et** recompile l'APK.

## Sécurité : à savoir avant d'exposer ton serveur

- L'**inscription est ouverte** : toute personne qui connaît l'URL de ton backend peut y créer un compte.
- Il n'y a pas de limitation du nombre de requêtes (rate limiting) ni de restriction CORS.
- Les avatars et bannières sont servis sans authentification sous `/uploads`.
- Expose le backend en **HTTPS** uniquement (reverse proxy ou tunnel), et ne partage l'URL qu'à tes proches.

## Contribuer

Les issues et pull requests sont les bienvenues. Avant de proposer une PR :

- ne commite jamais de fichier `.env`, de base de données ni d'export personnel (le `.gitignore` les exclut déjà) ;
- vérifie que le backend compile (`cd backend && go build ./...`) et que le frontend passe le typage (`cd frontend && npx tsc --noEmit`).

## Mentions

- Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.
- Projet indépendant, sans aucun lien avec TV Time ni avec Whip Media.
