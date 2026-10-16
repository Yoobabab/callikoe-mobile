# Callikoe mobile

**Callikoe** transforme ton téléphone en poste de ton standard téléphonique IP (PBX Callikoe). L'appli se configure en scannant un QR code : plus besoin de saisir un serveur, un identifiant ou un mot de passe SIP à la main.

Version actuelle : **0.1.0** (première version, faite pour tester dans Expo Go).

## Tester avec Expo Go (sans rien installer sur le PC)

À chaque modification, GitHub publie l'appli automatiquement (action « Publier dans Expo Go », secret `EXPO_TOKEN` du dépôt).
Ouvre le lien donné par l'action (onglet *Actions* › dernière exécution) ou la page du projet sur expo.dev, bouton **Preview**, et scanne le QR code avec Expo Go.

### En local (développeurs)

Prérequis : Node.js 20 ou plus, et l'appli **Expo Go** installée sur ton téléphone (App Store / Google Play).

```bash
npm install
npx expo start
```

1. Scanne le QR code affiché par Metro (dans le terminal) avec Expo Go (Android) ou l'appareil photo (iPhone). Le téléphone et l'ordinateur doivent être sur le même réseau (sinon : `npx expo start --tunnel`).
2. Dans Callikoe, appuie sur **« Scanner le QR code »**.
3. Scanne le QR code Callikoe du poste : dans la console du PBX, *fiche utilisateur › Général › Application mobile*, ou dans le mail envoyé par l'administrateur.
4. Vérifie la carte « Poste 201 · Marie Dupont · Nom du PBX » puis appuie sur **« Utiliser ce poste »**.
5. Autorise le micro : le softphone s'affiche en plein écran, tu peux appeler et recevoir des appels.
6. Le bouton menu du softphone ouvre le menu natif : **Comptes**, **Réglages**, **Scanner code QR**, **Aide**, **À propos**.

### Plusieurs comptes

Comme dans l'appli 3CX, tu peux enregistrer plusieurs postes (plusieurs PBX ou plusieurs extensions) :

- Menu › **Comptes** : la liste affiche « Nom » et « 201@serveur » ; le compte actif a une coche ronde.
- Appuie sur un compte pour l'activer (le softphone se recharge avec ce poste).
- **Ajouter** (ou Menu › **Scanner code QR**) : scanne un nouveau QR code. Si le poste existe déjà (même `extension@serveur`), il est remplacé.
- **Supprimer** (bouton sur la ligne, ou appui long) : après confirmation, le PBX est prévenu (`logout_url`, le jeton du téléphone est révoqué) et le compte est effacé du téléphone. Sans compte, l'appli revient à l'écran d'accueil.

Lien direct (sans caméra) : `callikoe://provision?url=<URL de provisioning encodée>` lance la même configuration. Dans Expo Go, le schéma `callikoe://` n'est pas enregistré : ce lien ne fonctionne qu'avec une vraie build (EAS). Le scanner, lui, accepte aussi un QR code contenant ce lien.

Commandes utiles :

```bash
npm run typecheck                    # vérification TypeScript
npx expo export --platform android   # vérifie que le bundle se construit
npm run icons                        # régénère les icônes (python3 + Pillow)
```

## Comment ça marche

```
QR code (console PBX)  ──►  https://<pbx>/app/provision?t=<jeton à usage limité>
        │
        ▼
GET …&format=json   ──►  configuration du poste + device_token (secret propre à ce téléphone)
        │
        ▼
expo-secure-store (« callikoe.accounts » + « callikoe.active »)  ──  stockage chiffré
        │
        ▼
WebView : <app_login_url>?d=<device_token>  ──►  le PBX pose un cookie de session
        │                                      et redirige vers le softphone web (WebRTC, /softphone?app=1)
        ▼
Appels audio dans l'appli (micro autorisé)
```

### Dialogue entre le softphone web et l'appli

- Avant le chargement de la page, l'appli définit `window.CALLIKOE_APP = { version: "0.1.0", platform: "ios" | "android" }` : la page sait qu'elle tourne dans l'appli.
- La page envoie des messages avec `window.ReactNativeWebView.postMessage(JSON.stringify({ type }))` :
  - `{"type":"menu"}` ouvre le menu natif (avatar, nom, poste, serveur + Comptes, Réglages, Scanner code QR, Aide, À propos) ;
  - `{"type":"accounts"}` ouvre directement l'écran Comptes.
- Menu › **Réglages** exécute `location.hash = "#/reglages"` dans la page (réglages du softphone web).
- Seuls les messages venant du serveur du compte actif sont pris en compte.

- **Provisioning** (`src/lib/provision.ts`) : validation de l'URL du QR code, appel JSON, lecture des erreurs du serveur (404 QR invalide/expiré, 429 trop de tentatives) et message générique en cas de problème réseau.
- **Comptes** (`src/lib/account.ts`, `src/screens/Accounts.tsx`) : liste des postes dans le trousseau sécurisé (Keychain iOS / Keystore Android), identifiant `extension@serveur`, compte actif. L'ancienne clé `callikoe.account` est migrée automatiquement.
- **Téléphone** (`src/screens/Phone.tsx`) : softphone web du PBX dans une WebView plein écran (sans barre native : la page a sa propre barre du haut et ses onglets Équipe, Contacts, Clavier, Appels, Chat, Messagerie). La WebView reste ouverte sous les autres écrans pour ne pas couper un appel.
- **Menu** (`src/screens/MenuSheet.tsx`) et pont page ↔ appli (`src/lib/bridge.ts`).

Arborescence :

```
App.tsx                  navigation simple (état) : accueil → scan → confirmation → téléphone ⇄ comptes
src/theme.ts             couleurs Callikoe, espacements
src/components/ui.tsx    point dégradé (logo), boutons, cartes
src/lib/provision.ts     fonctions pures : URL, lien profond, JSON, messages d'erreur
src/lib/account.ts       comptes : stockage sécurisé, ajout/remplacement, suppression, initiales
src/lib/bridge.ts        messages de la page web, script injecté
src/screens/             Welcome, Scan, Confirm, Phone, MenuSheet, Accounts
scripts/generate-icons.py  icônes (fond #16141a + point dégradé)
```

## Limites de la v0.1

- **Les appels ne fonctionnent que quand l'appli est ouverte** (au premier plan) : le softphone tourne dans une WebView, il n'y a pas encore de réveil de l'appli pour un appel entrant.
- **Pas de notifications push**, pas d'intégration **CallKit** (iOS) ni **ConnectionService** (Android) : un appel entrant ne s'affiche pas sur l'écran verrouillé.
- **Le PBX doit avoir un certificat HTTPS valide** (ex. Let's Encrypt) : sans HTTPS, le navigateur refuse l'accès au micro (WebRTC) et la WebView peut bloquer la page.
- Un seul poste actif à la fois : seul le compte actif peut recevoir des appels.
- Pas de balayage (swipe) pour supprimer un compte : bouton « Supprimer » sur la ligne ou appui long.
- Le lien `callikoe://` n'est actif qu'avec une build installée (pas dans Expo Go).

## Feuille de route

1. **SIP natif + push VoIP** : client SIP natif (identifiants `auth_id` / `password` déjà récupérés au provisioning), notifications PushKit (iOS) et FCM (Android) pour réveiller l'appli, affichage via CallKit / ConnectionService. Cela demande une *development build* (ne fonctionne plus dans Expo Go).
2. **Builds EAS pour les stores** (`eas build`, `eas submit`). Coûts à prévoir :
   - **Apple Developer Program : 99 $ par an** (obligatoire pour publier sur l'App Store et utiliser les push VoIP).
   - **Google Play Console : 25 $ une seule fois** (frais d'inscription).
   - EAS Build : offre gratuite avec un nombre limité de builds par mois, suffisante pour démarrer ; au-delà, abonnement payant (de l'ordre de 19 $/mois pour l'offre d'entrée, tarif à vérifier sur expo.dev). Optionnel : on peut aussi compiler en local gratuitement (Mac obligatoire pour iOS).
3. Plusieurs comptes actifs en même temps, journal d'appels natif, messagerie vocale (`*97`) en un appui.

---

Callikoe mobile 0.1.0 — IRT NETWORK.
