# Tutoriel d'installation

Ce guide t'emmène de zéro à une application installée sur ton téléphone, connectée à **ton** serveur. Compte une petite heure la première fois.

**Sommaire**

1. [Vue d'ensemble](#1-vue-densemble)
2. [Prérequis](#2-prérequis)
3. [Récupérer le projet](#3-récupérer-le-projet)
4. [Obtenir une clé API TMDB](#4-obtenir-une-clé-api-tmdb)
5. [Déployer le backend](#5-déployer-le-backend)
6. [Rendre le backend accessible en HTTPS](#6-rendre-le-backend-accessible-en-https)
7. [Configurer l'application](#7-configurer-lapplication)
8. [Tester en développement (optionnel)](#8-tester-en-développement-optionnel)
9. [Compiler l'APK avec EAS](#9-compiler-lapk-avec-eas)
10. [Alternative : compiler l'APK avec GitHub Actions](#10-alternative--compiler-lapk-avec-github-actions)
11. [Installer l'app et créer ton compte](#11-installer-lapp-et-créer-ton-compte)
12. [Importer tes données TV Time](#12-importer-tes-données-tv-time)
13. [Mettre à jour](#13-mettre-à-jour)
14. [Sauvegarder et restaurer](#14-sauvegarder-et-restaurer)
15. [Dépannage](#15-dépannage)

---

## 1. Vue d'ensemble

Il y a trois morceaux à mettre en place :

```
 Téléphone (APK)  ──HTTPS──▶  Ton backend (Docker)  ──▶  SQLite (tes données)
        │
        └────────HTTPS──▶  TMDB (affiches, résumés, dates de sortie)
```

- Le **backend** tourne sur une machine à toi (VPS, NAS, Raspberry Pi, PC allumé en permanence…). Il stocke les comptes et l'historique.
- L'**application** est compilée par tes soins, avec l'adresse de ton backend et ta clé TMDB **inscrites dedans au moment de la compilation**. Si l'une des deux change, il faut recompiler.
- **TMDB** fournit le catalogue. Chaque installation utilise sa propre clé gratuite.

## 2. Prérequis

| Outil | Pour quoi faire | Lien |
|---|---|---|
| Git | Récupérer le code | https://git-scm.com |
| Docker + Docker Compose | Faire tourner le backend | https://docs.docker.com/get-docker/ |
| Node.js 20 ou plus (22 recommandé) | Construire l'application | https://nodejs.org |
| Un compte Expo (gratuit) | Compiler l'APK dans le cloud avec EAS | https://expo.dev/signup |
| Un compte TMDB (gratuit) | Obtenir une clé API | https://www.themoviedb.org/signup |
| Un téléphone Android | Installer l'APK | — |

Tu n'as **pas** besoin d'Android Studio ni du SDK Android : EAS compile dans le cloud.

## 3. Récupérer le projet

```bash
git clone https://github.com/<ton-pseudo>/tv-time-rebirth.git
```

```bash
cd tv-time-rebirth
```

## 4. Obtenir une clé API TMDB

1. Crée un compte sur https://www.themoviedb.org puis connecte-toi.
2. Va dans **Paramètres → API** (https://www.themoviedb.org/settings/api).
3. Demande une clé de type **Developer**, usage personnel, et remplis le formulaire.
4. Copie la **Clé d'API (v3 auth)** : une chaîne de 32 caractères. C'est elle qu'il faut — pas le long « jeton d'accès en lecture (v4) ».

Garde-la sous la main pour l'étape 7.

## 5. Déployer le backend

Sur la machine qui hébergera le serveur, à la racine du projet :

**a. Crée le fichier de configuration**

```bash
cp .env.example .env
```

**b. Génère un secret**

```bash
openssl rand -hex 32
```

Sous Windows sans `openssl`, dans PowerShell :

```powershell
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
```

Ouvre `.env` et colle la valeur :

```
JWT_SECRET=la_longue_valeur_générée
```

Ce secret signe les jetons de connexion. Ne le publie jamais, et ne le change pas ensuite sans raison : tous les utilisateurs seraient déconnectés.

**c. Lance le serveur**

```bash
docker compose up -d --build
```

**d. Vérifie qu'il répond**

```bash
curl -i http://localhost:8080/api/me
```

Une réponse **`426`** avec `{"error":"update_required"}` est le résultat attendu : le serveur tourne et refuse simplement les clients qui n'annoncent pas la bonne version d'application. Si la connexion est refusée, regarde les journaux :

```bash
docker compose logs -f backend
```

Les données (base SQLite, avatars, bannières) sont dans le volume Docker `backend_data` et survivent aux redémarrages et aux mises à jour.

<details>
<summary>Sans Docker (Go installé sur la machine)</summary>

Il faut Go 1.25 ou plus. Aucune dépendance système : le pilote SQLite est en pur Go.

```bash
cd backend
JWT_SECRET="la_longue_valeur_générée" go run .
```

Les données sont alors écrites dans `backend/data/`.
</details>

## 6. Rendre le backend accessible en HTTPS

L'application doit pouvoir joindre le backend depuis ton téléphone, et **en HTTPS** : un APK Android compilé en mode release bloque par défaut les connexions `http://` non chiffrées. Choisis l'une de ces options.

### Option A — Nom de domaine + reverse proxy (recommandé pour un serveur permanent)

Avec [Caddy](https://caddyserver.com), qui obtient le certificat tout seul. Fais pointer ton (sous-)domaine vers le serveur, ouvre les ports 80 et 443, puis dans un `Caddyfile` :

```
tvtime.mondomaine.fr {
    reverse_proxy localhost:8080
}
```

Ton URL d'API sera `https://tvtime.mondomaine.fr/api`. Nginx, Traefik ou le reverse proxy intégré de ton NAS conviennent tout autant.

### Option B — Tunnel (sans ouvrir de port sur ta box)

- **Cloudflare Tunnel** : gratuit avec un domaine géré chez Cloudflare, URL stable.
- **Tailscale** : réseau privé entre tes appareils ; seul un téléphone connecté à ton Tailscale accède au serveur. Active HTTPS dans Tailscale pour obtenir un certificat.
- **ngrok** : le plus rapide pour essayer (`ngrok http 8080`). Utilise un domaine statique, sinon l'URL change à chaque redémarrage et il faut recompiler l'APK.

### Vérifier

Depuis ton téléphone (en 4G, pour être sûr de tester l'accès extérieur), ouvre `https://<ton-adresse>/api/me` dans le navigateur. Tu dois voir `{"error":"update_required"}`.

> **Rappel sécurité** : l'inscription est ouverte à quiconque connaît cette adresse. Ne la diffuse pas publiquement.

## 7. Configurer l'application

Sur ton ordinateur :

```bash
cd frontend
```

```bash
npm install
```

```bash
cp .env.example .env
```

Renseigne `frontend/.env` :

```
EXPO_PUBLIC_TMDB_API_KEY=ta_clé_tmdb_v3
EXPO_PUBLIC_API_URL=https://tvtime.mondomaine.fr/api
EXPO_PUBLIC_UPDATE_URL=
```

- `EXPO_PUBLIC_API_URL` se termine par `/api`, **sans** slash final.
- `EXPO_PUBLIC_UPDATE_URL` est facultatif : c'est le lien ouvert par le bouton « Mettre à jour » (par exemple l'endroit où tu déposes tes nouveaux APK). Laisse vide pour masquer le bouton.

Ce fichier sert au développement local (étape 8). Il est ignoré par Git et **n'est pas envoyé à EAS** : pour l'APK, les mêmes valeurs sont déclarées à l'étape 9.

## 8. Tester en développement (optionnel)

Pour vérifier que tout communique avant de lancer une compilation :

```bash
npx expo start
```

Installe **Expo Go** sur ton téléphone (dans la version correspondant au SDK 54), puis scanne le QR code affiché. Téléphone et ordinateur doivent être sur le même Wi-Fi.

Si le backend tourne sur ton ordinateur, n'utilise pas `localhost` dans `EXPO_PUBLIC_API_URL` (pour le téléphone, `localhost` c'est lui-même) mais l'adresse IP locale de l'ordinateur, par exemple `http://192.168.1.42:8080/api`. Après toute modification du `.env`, relance avec `npx expo start --clear`.

## 9. Compiler l'APK avec EAS

EAS Build est le service de compilation d'Expo. L'offre gratuite suffit pour un usage personnel (nombre de builds mensuel limité, file d'attente parfois longue).

**a. Installe l'outil et connecte-toi**

```bash
npm install -g eas-cli
```

```bash
eas login
```

**b. Rattache le projet à ton compte Expo**

Depuis le dossier `frontend/` :

```bash
eas init
```

Accepte la création du projet. La commande ajoute ton propre `projectId` dans `app.json` — c'est normal, ce fichier modifié t'appartient.

> Si tu comptes installer ton APK à côté d'une autre variante de l'app sur le même téléphone, change d'abord `android.package` dans `app.json` (par exemple `fr.tonpseudo.tvtimerebirth`). Deux applications ne peuvent pas partager le même identifiant.

**c. Déclare les variables d'environnement pour le build**

```bash
eas env:create --environment preview --name EXPO_PUBLIC_TMDB_API_KEY --value "ta_clé_tmdb_v3" --visibility plaintext
```

```bash
eas env:create --environment preview --name EXPO_PUBLIC_API_URL --value "https://tvtime.mondomaine.fr/api" --visibility plaintext
```

Et, si tu l'utilises :

```bash
eas env:create --environment preview --name EXPO_PUBLIC_UPDATE_URL --value "https://ton-lien" --visibility plaintext
```

Tu peux relire ce qui est enregistré avec `eas env:list --environment preview`, et corriger une valeur avec `eas env:update`.

**d. Lance la compilation**

```bash
eas build --platform android --profile preview
```

- Au premier build, EAS propose de **générer un keystore** (la clé de signature Android) : réponds oui. Il est conservé sur ton compte Expo et réutilisé à chaque build.
- La compilation prend en général 10 à 20 minutes. Tu peux fermer le terminal : le suivi est aussi sur https://expo.dev.
- À la fin, EAS affiche un **lien et un QR code** pour télécharger le fichier `.apk`.

Le profil `preview` produit un `.apk` installable directement. Le profil `production` produit un `.aab`, utile uniquement pour une publication sur le Play Store (déclare alors les variables avec `--environment production`).

> **Garde le même projet Expo** d'un build à l'autre. Un APK signé avec un autre keystore ne peut pas remplacer l'ancien : Android imposera une désinstallation, donc une reconnexion.

## 10. Alternative : compiler l'APK avec GitHub Actions

Le dépôt contient un workflow ([.github/workflows/build-apk.yml](../.github/workflows/build-apk.yml)) qui compile un APK sans compte Expo.

1. **Forke** le dépôt sur ton compte GitHub.
2. Dans ton fork : **Settings → Secrets and variables → Actions → New repository secret**, crée :
   - `EXPO_PUBLIC_TMDB_API_KEY`
   - `EXPO_PUBLIC_API_URL`
   - `EXPO_PUBLIC_UPDATE_URL` (facultatif)
3. Onglet **Actions** → active les workflows si GitHub le demande → **Build APK** → **Run workflow**.
4. Une fois le job terminé, télécharge l'artefact `tv-time-rebirth-debug` en bas de la page du run (conservé 7 jours).

À savoir : c'est un APK de **debug**, plus lourd et signé avec une clé de debug régénérée à chaque exécution. Il dépanne bien, mais chaque nouvelle version demandera de désinstaller la précédente. Pour un usage durable, préfère EAS.

## 11. Installer l'app et créer ton compte

1. Télécharge l'APK sur le téléphone (lien ou QR code EAS).
2. Ouvre-le. Android demandera d'autoriser l'installation depuis cette source (navigateur ou gestionnaire de fichiers) : accepte.
3. Lance **TV Time Rebirth**, touche le lien sous « Pas encore de compte ? » pour ouvrir l'écran **Créer un compte**, puis choisis un nom d'utilisateur, un e-mail et un mot de passe (8 caractères minimum).

L'e-mail sert uniquement d'identifiant de connexion : aucun message n'est envoyé, et il n'existe pas de procédure « mot de passe oublié ». Note ton mot de passe.

Pour tes proches : donne-leur le même APK, ils créent chacun leur compte sur ton serveur et vous pouvez vous suivre mutuellement.

## 12. Importer tes données TV Time

Si tu disposes d'un export de ton compte TV Time (fichiers JSON des séries et des films, ou une archive ZIP les contenant) :

1. Copie le fichier sur ton téléphone.
2. Dans l'app : **Profil → Paramètres → Importer des données**.
3. Sélectionne le fichier. L'app retrouve chaque titre sur TMDB puis envoie l'historique au serveur, avec les dates de visionnage d'origine.

L'import d'un gros historique peut durer plusieurs minutes ; laisse l'application ouverte. Certains titres peuvent ne pas être retrouvés automatiquement sur TMDB.

Le même écran accepte aussi les sauvegardes produites par l'application elle-même (**Paramètres → Exporter mes données**).

## 13. Mettre à jour

**Récupérer une nouvelle version du projet**

```bash
git pull
```

```bash
docker compose up -d --build
```

Puis recompile l'APK (`eas build --platform android --profile preview` depuis `frontend/`) et installe-le par-dessus l'ancien.

**La règle des versions.** Le backend n'accepte que les applications dont la version est strictement identique à la sienne. Ces deux valeurs doivent correspondre :

| Fichier | Champ |
|---|---|
| `frontend/app.json` | `"version"` |
| `backend/internal/middleware/version.go` | `RequiredAppVersion` |

Conséquence pratique : dès que le backend est redéployé avec une nouvelle version, les anciens APK affichent « Une mise à jour est disponible » jusqu'à leur remplacement. Redéploie le serveur et distribue le nouvel APK dans la foulée.

Si tu modifies l'app pour toi sans vouloir forcer de mise à jour, ne touche à aucun des deux numéros.

## 14. Sauvegarder et restaurer

**Depuis l'app (par utilisateur)** : **Paramètres → Exporter mes données** produit un fichier JSON avec tes séries, films, favoris et historique. Il se ré-importe via **Paramètres → Importer des données**.

**Côté serveur (tout le monde, avatars compris)** :

```bash
docker compose cp backend:/app/data ./sauvegarde-data
```

Pour restaurer sur un serveur fraîchement installé :

```bash
docker compose cp ./sauvegarde-data/. backend:/app/data
```

```bash
docker compose restart backend
```

Pense à sauvegarder aussi ton fichier `.env` (le `JWT_SECRET`) en lieu sûr.

## 15. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `required variable JWT_SECRET is missing a value` au lancement de Docker | Fichier `.env` absent ou vide à la racine | Reprends l'étape 5. |
| L'app affiche « Une mise à jour est disponible » dès l'ouverture | Version de l'app ≠ `RequiredAppVersion` du backend | Aligne les deux valeurs (étape 13), redéploie et recompile. |
| « Clé API TMDB manquante » ou catalogue vide | `EXPO_PUBLIC_TMDB_API_KEY` absente au moment du build | Vérifie `eas env:list --environment preview`, puis recompile. |
| Erreur réseau à la connexion ou à l'inscription | URL d'API fausse, backend injoignable, ou URL en `http://` dans un APK release | Teste `https://<adresse>/api/me` dans le navigateur du téléphone ; vérifie le `/api` final ; passe en HTTPS. |
| L'app semble appeler `localhost` | `EXPO_PUBLIC_API_URL` n'était pas définie au build | Déclare-la côté EAS (étape 9c) et recompile. |
| « Application non installée » lors d'une mise à jour | APK signé avec une autre clé (autre projet Expo, ou APK de debug) | Désinstalle l'ancienne version puis réinstalle. |
| Modification du `.env` sans effet en développement | Cache Metro | `npx expo start --clear` |
| Déconnexion de tous les utilisateurs | `JWT_SECRET` modifié (ou session de plus de 7 jours) | Reconnecte-toi ; garde un secret stable. |
| L'envoi d'un avatar échoue derrière un reverse proxy | Taille maximale de requête trop basse | Augmente la limite côté proxy (`client_max_body_size` sous Nginx). |
