# Callikoe mobile

**Callikoe** transforme ton téléphone en poste de ton standard téléphonique IP (PBX Callikoe). L'appli se configure en scannant un QR code : plus besoin de saisir un serveur, un identifiant ou un mot de passe SIP à la main.

Version actuelle : **0.1.0** (première version, faite pour tester dans Expo Go).

## Tester avec Expo Go

Prérequis : Node.js 20 ou plus, et l'appli **Expo Go** installée sur ton téléphone (App Store / Google Play).

```bash
npm install
npx expo start
```

1. Scanne le QR code affiché par Metro (dans le terminal) avec Expo Go (Android) ou l'appareil photo (iPhone). Le téléphone et l'ordinateur doivent être sur le même réseau (sinon : `npx expo start --tunnel`).
2. Dans Callikoe, appuie sur **« Scanner le QR code »**.
3. Scanne le QR code Callikoe du poste : dans la console du PBX, *fiche utilisateur › Général › Application mobile*, ou dans le mail envoyé par l'administrateur.
4. Vérifie la carte « Poste 201 · Marie Dupont · Nom du PBX » puis appuie sur **« Utiliser ce poste »**.
5. Autorise le micro : le softphone s'affiche, tu peux appeler et recevoir des appels.

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
expo-secure-store (clé « callikoe.account »)  ──  stockage chiffré sur le téléphone
        │
        ▼
WebView : <app_login_url>?d=<device_token>  ──►  le PBX pose un cookie de session
        │                                      et redirige vers le softphone web (WebRTC)
        ▼
Appels audio dans l'appli (micro autorisé)
```

- **Provisioning** (`src/lib/provision.ts`) : validation de l'URL du QR code, appel JSON, lecture des erreurs du serveur (404 QR invalide/expiré, 429 trop de tentatives) et message générique en cas de problème réseau.
- **Compte** (`src/lib/account.ts`) : un seul poste pour l'instant, stocké dans le trousseau sécurisé (Keychain iOS / Keystore Android).
- **Téléphone** (`src/screens/Phone.tsx`) : softphone web du PBX dans une WebView plein écran, avec une barre « Poste 201 · Nom du PBX » et l'accès aux réglages.
- **Réglages** (`src/screens/Settings.tsx`) : infos du poste, « Recharger », « Déconnecter ce téléphone » (prévient le PBX via `logout_url` pour révoquer le jeton, puis efface le compte local).

Arborescence :

```
App.tsx                  navigation simple (état) : accueil → scan → confirmation → téléphone
src/theme.ts             couleurs Callikoe, espacements
src/components/ui.tsx    point dégradé (logo), boutons, cartes
src/lib/provision.ts     fonctions pures : URL, lien profond, JSON, messages d'erreur
src/lib/account.ts       stockage sécurisé + déconnexion
src/screens/             Welcome, Scan, Confirm, Phone, Settings
scripts/generate-icons.py  icônes (fond #16141a + point dégradé)
```

## Limites de la v0.1

- **Les appels ne fonctionnent que quand l'appli est ouverte** (au premier plan) : le softphone tourne dans une WebView, il n'y a pas encore de réveil de l'appli pour un appel entrant.
- **Pas de notifications push**, pas d'intégration **CallKit** (iOS) ni **ConnectionService** (Android) : un appel entrant ne s'affiche pas sur l'écran verrouillé.
- **Le PBX doit avoir un certificat HTTPS valide** (ex. Let's Encrypt) : sans HTTPS, le navigateur refuse l'accès au micro (WebRTC) et la WebView peut bloquer la page.
- Un seul poste par téléphone. Scanner un nouveau QR code remplace le poste enregistré.
- Le lien `callikoe://` n'est actif qu'avec une build installée (pas dans Expo Go).

## Feuille de route

1. **SIP natif + push VoIP** : client SIP natif (identifiants `auth_id` / `password` déjà récupérés au provisioning), notifications PushKit (iOS) et FCM (Android) pour réveiller l'appli, affichage via CallKit / ConnectionService. Cela demande une *development build* (ne fonctionne plus dans Expo Go).
2. **Builds EAS pour les stores** (`eas build`, `eas submit`). Coûts à prévoir :
   - **Apple Developer Program : 99 $ par an** (obligatoire pour publier sur l'App Store et utiliser les push VoIP).
   - **Google Play Console : 25 $ une seule fois** (frais d'inscription).
   - EAS Build : offre gratuite avec un nombre limité de builds par mois, suffisante pour démarrer ; au-delà, abonnement payant (de l'ordre de 19 $/mois pour l'offre d'entrée, tarif à vérifier sur expo.dev). Optionnel : on peut aussi compiler en local gratuitement (Mac obligatoire pour iOS).
3. Plusieurs postes / plusieurs PBX, journal d'appels natif, messagerie vocale (`*97`) en un appui.

---

Callikoe mobile 0.1.0 — IRT NETWORK.
