# Intégration native Linux

Le mode natif place une barre compacte juste avant le composeur de Codex Desktop. Le panneau s'ouvre dans la même fenêtre, par la flèche. L'adaptateur utilise le runtime Electron de l'application. Ce n'est pas un simple panneau navigateur ni une fonctionnalité officielle des plugins Codex.

## Préparer et activer

Depuis le dépôt, avec Python 3.9+ :

```bash
python3 scripts/prepare-native.py --check
python3 scripts/prepare-native.py --source /usr/lib/chatgpt --destination /chemin/neuf/codex-cockpit-desktop
```

Ferme complètement Codex, y compris les autres fenêtres, puis lance `/chemin/neuf/codex-cockpit-desktop/launch-cockpit`. Si Codex d'origine tourne encore, le lanceur s'arrête avec un message et, si disponible, une notification. La relance reprend le profil habituel de Codex ; ne fais pas fonctionner deux profils identiques simultanément.

`launch-cockpit --diagnose` indique le chemin attendu et l'éventuelle instance d'origine encore ouverte. Le journal de lancement est conservé dans `cockpit-launch.log` à côté du lanceur ; il reste local et ne doit pas être publié sans vérification.

Le mode natif n'a besoin ni de Node installé séparément, ni du serveur MCP ou HTTP, ni d'une clé API. La préparation crée environ 1 Go de fichiers, dont une copie de l'exécutable et une archive modifiée. Les autres ressources restent liées à l'installation système. Conserve cette dernière installée.

## Modifications précises

1. Le préparateur valide le numéro de version et le SHA-256 des deux fichiers ciblés avant d'écrire quoi que ce soit. Profil initial : Linux, `26.1027.30824`.
2. Dans la copie de l'archive, le composant du composeur reçoit un attribut DOM contenant son identifiant de conversation résolu. Les références de variables sont vérifiées par l'empreinte du fichier complet.
3. Une petite initialisation charge `native/host.cjs` au démarrage. Une erreur de chargement est journalisée et ne bloque pas le démarrage de l'application.
4. Le processus principal lit les journaux locaux, puis actualise la barre toutes les 2 secondes dans un monde JavaScript isolé. L'adaptateur ne s'exécute que dans les fenêtres principales `app://-`, jamais sur les pages distantes du navigateur intégré.
5. Le rendu utilise un Shadow DOM pour contenir ses styles. Aucun accès au système de fichiers, IPC supplémentaire, clé ou port de débogage n'est exposé au JavaScript de la page. Aucun texte du champ de saisie n'est lu.

Les offsets ASAR et les empreintes d'intégrité des fichiers modifiés sont recalculés. L'archive système et les fichiers de l'application installée restent inchangés. Le dossier créé est indépendant du dépôt, car les fichiers nécessaires de Cockpit y sont copiés.

## Retour arrière et mises à jour

Ferme la copie et relance l'application d'origine. Le retour arrière ne demande aucune modification du profil, des conversations ou de l'installation système. Le dossier de copie peut ensuite être supprimé.

La copie n'est pas mise à jour automatiquement. Après une mise à jour de Codex, le profil de compatibilité doit être revérifié. Ne retire pas les contrôles d'empreintes pour forcer une installation : les variables du bundle peuvent avoir changé. Utilise un nouveau dossier pour recréer une copie ; le préparateur refuse d'écraser un dossier existant.

Le dépôt ne distribue aucun binaire de Codex ni bundle propriétaire. Chaque utilisateur prépare la copie à partir de sa propre installation locale.

## Validation

Tests Node du pont isolé, tests Python du réassemblage ASAR et du refus des versions inconnues ; essai interactif du rendu dans un navigateur sur un composeur synthétique ; essai du même hôte natif dans le runtime Electron installé, avec une fenêtre masquée, un profil temporaire et des journaux synthétiques. L'essai Electron vérifie les métriques locales, l'isolation des globals, l'emplacement, la flèche, le brouillon et le changement de conversation.

Le lanceur de la copie complète doit encore être utilisé après fermeture de la session courante pour valider le résultat dans le profil réel. Le préparateur ne ferme jamais une application en cours et ne redémarre pas Codex à ta place.

Pour refaire l'essai visuel du renderer : `node scripts/native-preview.mjs`. La page est explicitement signalée comme un banc de test. `scripts/electron-smoke.cjs` est un point d'entrée réservé à une archive de test Electron distincte ; ne pas le charger dans le processus Codex actif.
