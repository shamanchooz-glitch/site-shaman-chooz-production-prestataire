# SHAMAN CHOOZ PRODUCTION — Chatbot WhatsApp & site

Ce dossier contient le serveur qui fait fonctionner :
1. Les réponses automatiques sur vos deux numéros WhatsApp Business
   (+225 07 48 93 56 86 et +225 07 49 97 09 18)
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

## Étape 3 — Ajouter vos deux numéros

⚠️ Important : un numéro déjà utilisé dans l'appli WhatsApp Business
classique doit être **migré**. Faites-le d'abord avec un seul numéro,
vérifiez que tout fonctionne, puis migrez le second.

1. Dans le tableau de bord WhatsApp de votre app → "Numéros de
   téléphone" → "Ajouter un numéro"
2. Entrez +225 07 48 93 56 86, suivez la vérification par SMS/appel
3. Notez le **"Phone number ID"** affiché (une longue suite de
   chiffres) — vous en aurez besoin
4. Recommencez pour +225 07 49 97 09 18

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

Envoyez un message WhatsApp à l'un de vos deux numéros depuis votre
téléphone personnel. Le bot doit répondre en quelques secondes.
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
