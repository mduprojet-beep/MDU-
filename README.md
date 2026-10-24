# Chantier Photo

Application web pour iPhone (installable sur l'écran d'accueil) inspirée de CompanyCam :
photos de chantier classées par projet, et **visite commentée IA**. Vous parlez et
prenez des photos en marchant sur le chantier, puis l'IA (Claude) rédige le compte rendu.

## Fonctions

- **Chantiers** : création, adresse, suppression.
- **Photos** : l'appareil photo intégré prend les photos à la volée (aperçu en direct, sans écran « Utiliser la photo »). Import depuis la galerie, légende, suppression.
- **Annotations** : flèche, dessin libre, rectangle, cercle, texte, 6 couleurs, annulation. La photo d'origine est conservée, on peut donc modifier les annotations plus tard. C'est la version annotée qui est envoyée à l'IA et qui apparaît dans les rapports.
- **Visite commentée IA**
  - Démarrer, mettre en pause, reprendre, terminer. Un chronomètre tourne pendant la visite.
  - Dictée automatique en français quand le navigateur la permet. Sinon, notes écrites ou dictées avec le micro du clavier.
  - Bouton photo pendant la visite : chaque photo est placée au bon moment dans la transcription.
  - Avant de générer le rapport, vous pouvez relire et corriger la transcription.
  - Le **rapport IA** contient un titre, un résumé, les observations par zone (avec leur gravité et leurs photos), les actions à mener et les points à vérifier.
  - Le rapport se modifie directement dans l'app. On peut l'enregistrer en **PDF** (via Imprimer) ou le **partager**.
  - Les actions à mener deviennent une **liste de tâches** à cocher.

## Données

Tout reste **sur le téléphone** (IndexedDB) : pas de compte ni de serveur. Si vous supprimez l'app ou les
données de Safari, tout est effacé.
Pour générer un rapport, la transcription et les photos de la visite sont envoyées à l'API Anthropic
avec **votre** clé API. Cette clé est enregistrée uniquement sur le téléphone.

## Mise en ligne (GitHub Pages)

1. Sur GitHub : **Settings → Pages → Build and deployment**. Choisissez *Deploy from a branch*, puis la branche `main` et le dossier `/ (root)`.
2. L'app sera disponible à l'adresse `https://<compte>.github.io/<dépôt>/`, en HTTPS. Le HTTPS est obligatoire pour l'appareil photo et le micro.

## Installation sur l'iPhone

1. Ouvrez l'adresse dans **Safari**.
2. Touchez **Partager → Sur l'écran d'accueil**.
3. Dans l'app, touchez **⚙︎** et collez votre clé API Anthropic. Pour en créer une : console.anthropic.com → API Keys. L'usage est facturé sur votre compte Anthropic.

## Limites connues

- **Dictée automatique sur iPhone** : elle utilise la reconnaissance vocale du navigateur. Selon la version
  d'iOS, elle peut être indisponible, surtout quand l'app est lancée depuis l'écran d'accueil.
  Elle peut aussi se couper quand on ouvre l'appareil photo. L'app la relance automatiquement. Si ça ne marche pas,
  utilisez le micro du clavier dans le champ de note.
- Au maximum 40 photos par visite sont envoyées à l'IA.
- Un seul utilisateur, pas de synchronisation entre appareils (version 1).

## Développement

Il n'y a pas d'étape de compilation : ce sont des fichiers statiques. Pour tester sur un ordinateur : `python3 -m http.server`, puis ouvrez `http://localhost:8000`.
