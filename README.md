# SHAMAN CHOOZ PRODUCTION — Chatbot WhatsApp & site

Ce dossier contient le serveur qui fait fonctionner :
1. Les réponses automatiques sur vos quatre numéros WhatsApp Business
   (+225 07 48 93 56 86, +225 07 49 97 09 18, +225 05 74 53 36 36
   et +225 01 73 77 39 39)
2. Le petit chat intégré sur votre site (déjà ajouté dans `index.html`)

Il fallait un vrai serveur pour ça — GitHub Pages ne peut héberger que
des fichiers statiques, pas un programme qui tourne en continu.

---

## Étape 1 — Compte Meta Business

1. Allez sur **business.facebook.com**, créez un compte Meta Business
   au nom de SHAMAN CHOOZ PRODUCTION si vous n'en avez pas déjà un
2. Complétez la **vérification d'entreprise** (documents de votre
   société) — cela peut prendre de quelques heures à quelques jours

## Étape 2 — Créer l'application WhatsApp

1. Allez sur **developers.facebook.com** → "Mes Apps" → "Créer une app"
2. Type d'app : **Entreprise**
3. Une fois l'app créée, ajoutez le produit **WhatsApp**
4. Meta vous attribue automatiquement un **WABA** (WhatsApp Business
   Account) de test — c'est normal, on y ajoutera vos vrais numéros
   ensuite

## Étape 3 — Ajouter vos quatre numéros

⚠️ Important : un numéro déjà utilisé dans l'appli WhatsApp Business
classique doit être **migré**. Faites-le d'abord avec un seul numéro,
vérifiez que tout fonctionne, puis migrez les trois autres un par un.

1. Dans le tableau de bord WhatsApp de votre app → "Numéros de
   téléphone" → "Ajouter un numéro"
2. Entrez +225 07 48 93 56 86, suivez la vérification par SMS/appel
3. Notez le **"Phone number ID"** affiché (une longue suite de
   chiffres) — vous en aurez besoin pour chaque numéro
4. Recommencez pour +225 07 49 97 09 18
5. Recommencez pour +225 05 74 53 36 36
6. Recommencez pour +225 01 73 77 39 39

## Étape 4 — Générer un token permanent

Le token "temporaire" fourni par défaut expire au bout de 24h — il
vous faut un token permanent :

1. Dans Meta Business → "Paramètres de l'entreprise" → "Utilisateurs
   système" → "Ajouter" → créez un utilisateur système (rôle Admin)
2. Attribuez-lui l'app WhatsApp créée à l'étape 2, avec la permission
   `whatsapp_business_messaging`
3. Générez un **token sans expiration** pour cet utilisateur système
   → copiez-le, c'est votre `WHATSAPP_TOKEN`

## Étape 5 — Clé API Anthropic

1. Allez sur **console.anthropic.com** → "API Keys" → créez une clé
2. Copiez-la, c'est votre `ANTHROPIC_API_KEY`

## Étape 6 — Déployer le serveur (Render, gratuit)

1. Créez un compte sur **render.com**
2. "New" → "Web Service"
3. Connectez ce dossier à un repo GitHub (créez-en un nouveau,
   uploadez `server.js`, `package.json`, et ce README — **jamais**
   le fichier `.env`)
4. Render détecte Node.js automatiquement. Build command : `npm
   install`. Start command : `npm start`
5. Dans l'onglet "Environment", ajoutez ces 4 variables (voir
   `.env.example`) :
   - `VERIFY_TOKEN` — inventez un mot de passe
   - `WHATSAPP_TOKEN` — celui de l'étape 4
   - `ANTHROPIC_API_KEY` — celui de l'étape 5
   - `FIREBASE_URL` — la même URL que dans votre `index.html`
6. Déployez. Render vous donne une adresse du type
   `https://shaman-chooz-bot.onrender.com`

## Étape 7 — Connecter le webhook dans Meta

1. Dans le tableau de bord WhatsApp de votre app → "Configuration" →
   "Webhook"
2. URL de rappel : `https://shaman-chooz-bot.onrender.com/webhook`
3. Jeton de vérification : le même `VERIFY_TOKEN` que vous avez
   choisi à l'étape 6
4. Abonnez-vous au champ **"messages"**

## Étape 8 — Tester

Envoyez un message WhatsApp à l'un de vos quatre numéros depuis votre
téléphone personnel. Le bot doit répondre en quelques secondes.
Testez bien chacun des quatre numéros, pas seulement le premier.
Vérifiez aussi dans Firebase → Data → `whatsapp_conversations` que la
conversation est bien enregistrée.

## Étape 9 — Activer le chat sur le site

Dans `index.html`, remplacez :
```js
const BOT_BACKEND_URL = "https://VOTRE-BACKEND.onrender.com";
```
par votre vraie adresse Render, puis remplacez le fichier sur GitHub
comme d'habitude.

---

### Note sur le plan gratuit de Render

Le plan gratuit "s'endort" après 15 minutes sans visite et met
quelques secondes à se réveiller au message suivant — parfait pour
démarrer. Si le volume augmente, un plan payant (à partir de ~7$/mois)
garde le serveur toujours actif.

### Note sur les coûts

- Anthropic facture à l'usage (quelques centimes par conversation avec
  ce modèle) — vous pouvez fixer un plafond de dépense dans la
  console.
- Meta offre un quota de conversations gratuites par mois, au-delà
  c'est payant selon le pays.

## Les 8 moteurs thématiques (travail, perso, famille, couple, social, argent, recrutement, actualité)

Ils sont branchés dans le chatbot **en plus** de tout ce qui existait (intentions de l'agence, vie courante, cours, quiz,
règles et consignes, réponses apprises, garde-fous). Chaque message passe par l'orchestrateur en 8 étapes :
normaliser → charger l'historique (10 échanges) et l'état → analyser (domaine, sujet, intention, émotion, urgence) →
router avec un score de confiance (moteur principal + secondaire) → verrouiller le sujet → appeler le(s) moteur(s) →
contrôle qualité → mise à jour de l'état.

| Fichier | Rôle |
| --- | --- |
| `src/jsMain/kotlin/shaman/moteurs/*.kt` | Version Kotlin (compilée par GitHub dans `shaman-engine-kotlin.js`) |
| `shaman-moteurs.js` | Même algorithme en JavaScript : repli tant que le build Kotlin n'a pas tourné, et référence testable |
| `shaman-lexicon.json` → clé `moteurs` | Toutes les données : mots-clés, sous-sujets, conseils, 8 blocs × 15 variantes par moteur, messages fixes |
| `test-moteurs.cjs` | 55 scénarios (détection, changement de sujet, ambigu, mixte, suite, hors domaine, détresse, SMS, combinaisons, anti-répétition, politesse, actualité) |
| `actualite-flux.cjs` | Robot GitHub : lit les flux d'actualité et écrit `shaman-actualite.json` |
| `test-chatbot-moteurs.cjs` | 17 vérifications à travers l'API du chatbot (`reply`, `replyAsync`, `stats`, `journal`) |

**Priorités dans `doReply`** : sécurité, nom, quiz, interdits, règles, réponses apprises, informations, cours → *intentions propres
à l'agence quand elles sont fortes* (inscription, frais, suivi, contact…) → **8 moteurs** → vie courante (cuisine, humour, heure…) →
recentrage poli. Un message hors des 8 domaines est laissé aux autres moteurs ; s'ils n'ont rien non plus, l'assistant recentre.

**Réglages (consignes du chatbot)** : `politesse: vous` (défaut, règle de l'agence), `politesse: tu`, `politesse: auto` ;
`ton: pro` ou `ton: chaleureux`.

**Actualité en direct** : la météo vient d'Open-Meteo (directement depuis le navigateur, sans clé). Sports, infos et international
viennent du fichier `shaman-actualite.json`, écrit toutes les heures par GitHub (`actualite-flux.cjs` + `.github/workflows/actualite.yml`,
flux RSS de RFI / France 24 / BBC Afrique / Le Monde). Aucune clé, aucun serveur. Pour changer de média : modifier la liste `FLUX` dans
`actualite-flux.cjs`. Si aucun flux ne répond, ou si l'information a plus de 12 h, le chatbot dit honnêtement qu'il n'a pas
d'information récente ; il n'invente jamais.

**Journal de debug** : `ShamanDebug()` dans la console du navigateur (pourquoi tel moteur, score, sujet verrouillé, contrôle qualité) ;
le dernier routage s'affiche aussi dans l'onglet d'administration.
