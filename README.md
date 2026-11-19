# Codex Cockpit

Un Cockpit local pour **Codex Desktop** : barre de contexte compacte, petite flèche pour ouvrir les détails, agents, fichiers et activité récente. Projet communautaire indépendant, sans affiliation avec OpenAI.

**État : v0.1.0, panneau compagnon fonctionnel.** La barre et la flèche vivent dans le panneau Cockpit. L'insertion directement au-dessus du champ de saisie natif de Codex n'est pas implémentée : aucun point d'extension documenté n'a été identifié pour cet emplacement. Cette limite est suivie dans la feuille de route.

## Démarrage

Prérequis : Node.js 22 ou plus, Codex Desktop avec des sessions locales.

```bash
git clone https://github.com/PatLeGrand/codex-cockpit.git
cd codex-cockpit
node src/cli.mjs
```

Ouvre l'URL affichée. Clique sur la petite flèche à droite de la barre pour ouvrir le Cockpit. Pas de dépendance à installer ni de clé API à configurer. Le serveur écoute exclusivement sur `127.0.0.1`, sur un port libre ; `--port 4318` fixe le port. Arrêt avec `Ctrl+C`.

```bash
node src/cli.mjs --demo # aperçu avec données fictives, signalé dans l'interface
node --test             # tests
```

## Plugin Codex Desktop

Ce dépôt fournit un manifeste de compatibilité Codex, un catalogue et un serveur MCP local stdio. Ajoute le catalogue :

```bash
codex plugin marketplace add PatLeGrand/codex-cockpit
```

Redémarre Codex Desktop, ouvre les plugins, sélectionne la source **Codex Cockpit**, puis installe **codex-cockpit**. Demande ensuite « Ouvre le Cockpit pour cette conversation ». Le skill récupère l'URL privée et utilise l'outil d'ouverture du panneau navigateur lorsqu'il est disponible.

La découverte et l'installation dans le catalogue sont à valider sur chaque version de Codex Desktop. Le serveur MCP et le panneau se testent aussi indépendamment avec les commandes ci-dessus. Le plugin doit tourner sur la machine où sont les journaux : une connexion MCP distante ne donne pas accès aux sessions locales.

Outils exposés : `open_cockpit` renvoie l'URL du panneau ; `cockpit_snapshot` renvoie les métriques observées, avec un paramètre optionnel `session` pour choisir une conversation.

## Données affichées

| Élément | Source et limite |
| --- | --- |
| Contexte | Estimation depuis `last_token_usage.total_tokens / model_context_window`. Le cumul de tokens n'est jamais utilisé comme occupation de contexte. |
| Agents | Sessions reliées explicitement par `parent_thread_id`, descendants inclus. Pas de rapprochement par dossier ou par heure. |
| État | Derniers événements `task_started`, `task_complete`, `turn_aborted`. Un état en cours sans événement depuis 2 minutes est marqué ancien. |
| Durée | Début du dernier tour observé, fin au dernier événement pour les tours terminés. |
| Fichiers | Chemins explicites des outils d'écriture et en-têtes `apply_patch`. Les modifications dans des commandes shell ou des appels imbriqués ne sont pas détectées. |
| Activité | Noms et résultats structurés des appels d'outils. Les erreurs dans du texte libre peuvent ne pas être reconnues. |
| Quotas | Pourcentages utilisés des fenêtres de limitation, si présents dans le journal. |

Les coûts monétaires ne sont pas affichés : les journaux ne fournissent pas de facture fiable. Les métriques absentes restent indisponibles. Les noms d'agents ne sont affichés que s'ils sont fournis ; sinon leur identifiant est utilisé.

Lecture incrémentale de `$CODEX_HOME/sessions` (par défaut `~/.codex/sessions`), jusqu'à 160 journaux récents, actualisation toutes les 2 secondes. Les gros journaux peuvent nécessiter plusieurs cycles. Le format des journaux est un adaptateur expérimental, susceptible de changer avec Codex. Les sessions stockées exclusivement ailleurs, paginées hors de ces journaux ou exécutées à distance peuvent être absentes.

## Confidentialité

Le serveur ne modifie pas les conversations et ne lance pas de tâche Codex. Il ne transmet rien à un service externe. L'accès aux métriques nécessite le jeton aléatoire fourni dans le fragment de l'URL ; le navigateur l'envoie dans un en-tête local. Ne partage pas cette URL. Les conversations, instructions et résultats bruts ne sont pas exposés par l'API. Des noms d'outils, chemins et identifiants de sessions peuvent être visibles dans le panneau.

## Maintenance

Voir [architecture](docs/architecture.md) et [feuille de route](docs/roadmap.md). Les correctifs passent par une pull request ; la CI teste Node 22 et 24. Rapporte les problèmes de compatibilité en indiquant la version de Codex, ton système et un exemple synthétique, sans joindre tes journaux privés.

Documentation de référence : [plugins Codex](https://developers.openai.com/plugins/build/plugins), [App Server](https://learn.chatgpt.com/docs/app-server). Licence MIT.
