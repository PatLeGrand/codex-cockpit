# Architecture

`src/sessions.mjs` transforme les événements JSONL locaux en un instantané normalisé. Le cache garde un curseur par fichier et attend une fin de ligne avant de parser un enregistrement. Les réécritures plus courtes réinitialisent le lecteur. Les symlinks de l'arborescence ne sont pas suivis. Aucun texte de message, prompt ou résultat brut n'est conservé dans le modèle exposé.

`src/server.mjs` sert trois ressources statiques et une API GET authentifiée. Host et Origin sont vérifiés, aucun CORS n'est activé, la CSP refuse les ressources tierces. Le jeton est éphémère. Le navigateur le conserve dans son sessionStorage après avoir nettoyé l'URL. Ce serveur est destiné à une machine personnelle ; ce n'est pas un service multi-utilisateur.

`src/mcp.mjs` fournit un serveur JSON-RPC MCP stdio minimal avec initialisation, ping et deux outils. Il ne lance aucun agent et ne se connecte pas au processus App Server de Codex. Le navigateur est hébergé par le même processus ; il s'arrête lorsque le client MCP ferme stdin.

`web/` est une interface JavaScript sans build. Elle utilise textContent pour les données observées, garde l'ouverture du panneau en mémoire locale, permet de choisir une session et suspend l'actualisation des onglets masqués. Le clavier permet d'ouvrir la barre et Échap ferme le panneau.

## Limites connues

- Lecture des 160 journaux les plus récents selon les dossiers datés et noms de fichiers, pas de recherche historique exhaustive.
- Au plus 8 Mio lus par fichier et par cycle. Une ligne de plus de 4 Mio est ignorée et signalée ; une fin de ligne partielle est relue au cycle suivant.
- Le journal n'est pas une sonde du processus : un arrêt brutal peut laisser un dernier état en cours.
- Les outils appelés dans du code imbriqué peuvent apparaître uniquement sous leur enveloppe `exec` ; aucun parsing de code ou de commandes shell n'est effectué.
- Le point d'insertion natif au-dessus du composeur n'est pas disponible dans cette version. Le composant web pourra être adapté si une interface publique appropriée est fournie.

Pour maintenir l'adaptateur, ajouter un cas synthétique au lecteur et tester le format avant de changer son interprétation. Ne jamais inclure de journaux réels dans le dépôt.
