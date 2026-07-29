/**
 * SHAMAN CHOOZ PRODUCTION — Serveur du chatbot
 * ------------------------------------------------
 * Ce serveur fait deux choses :
 *  1. Répond automatiquement aux messages reçus sur vos numéros WhatsApp
 *     (via la WhatsApp Business Platform / Cloud API de Meta).
 *  2. Sert de "pont" sécurisé pour le chat intégré sur le site web
 *     (le site n'appelle jamais directement l'API Anthropic — la clé
 *     API reste secrète, ici, sur le serveur).
 *
 * Toutes les conversations sont enregistrées dans votre base Firebase
 * existante (celle du site) pour que vous puissiez les consulter et
 * reprendre la main dès que vous êtes disponible.
 */

import express from 'express';
import 'dotenv/config';

const app = express();
app.use(express.json());

const {
  VERIFY_TOKEN,        // mot de passe que VOUS choisissez, à recopier dans Meta
  WHATSAPP_TOKEN,       // token permanent généré dans Meta Business
  ANTHROPIC_API_KEY,    // votre clé API Anthropic (console.anthropic.com)
  FIREBASE_URL,         // la même base que celle utilisée par le site
  PORT = 3000
} = process.env;

/* ------------------------------------------------------------------ */
/* 1. Le "cerveau" du bot : ce qu'il sait et comment il doit répondre */
/* ------------------------------------------------------------------ */
const SYSTEM_PROMPT = `Tu es l'assistant virtuel de SHAMAN CHOOZ PRODUCTION, une agence de casting et de recrutement basée à Abidjan, Côte d'Ivoire.

Catégories couvertes par l'agence : Mannequin, Acteur / Actrice, Figuration, Événementiel, Voix / Doublage, Autre.

Ton rôle :
- Accueillir chaleureusement les personnes qui écrivent, qu'elles soient candidats ou clients/recruteurs.
- Expliquer clairement le fonctionnement : inscription candidat, publication d'une offre, délais de traitement, catégories disponibles.
- Si la personne veut s'inscrire ou déposer une offre, recueillir poliment son nom, sa catégorie (ou son besoin), sa ville et confirmer qu'un membre de l'équipe la recontactera personnellement. Ne jamais improviser un enregistrement final toi-même — c'est le formulaire du site ou l'équipe qui valide.
- Ne jamais garantir une sélection, un salaire ou un contrat.
- Rester bref et naturel, adapté à une conversation WhatsApp (pas de longs paragraphes, pas de listes à puces sauf si nécessaire).
- Rappeler que le fondateur ou l'équipe revient personnellement vers la personne pour toute décision.
- Répondre dans la langue utilisée par la personne (français par défaut).
- Si la question sort du cadre de l'agence (sujet totalement hors sujet), rediriger poliment vers l'objet de l'agence.`;

async function askAssistant(userMessage, history = []) {
  const messages = [...history, { role: 'user', content: userMessage }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages
    })
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Erreur API Anthropic:', data);
    return "Merci pour votre message ! Notre équipe revient vers vous très rapidement.";
  }
  const textBlock = (data.content || []).find(b => b.type === 'text');
  return textBlock ? textBlock.text : "Merci pour votre message, nous revenons vers vous rapidement.";
}

/* ------------------------------------------------------------------ */
/* 2. Enregistrement des conversations dans Firebase (même base que le site) */
/* ------------------------------------------------------------------ */
async function logToFirebase(path, data) {
  try {
    await fetch(`${FIREBASE_URL}/${path}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (e) {
    console.error('Erreur d\'enregistrement Firebase:', e);
  }
}

/* ------------------------------------------------------------------ */
/* 3. WhatsApp — vérification du webhook (obligatoire, demandé par Meta) */
/* ------------------------------------------------------------------ */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook vérifié avec succès.');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/* ------------------------------------------------------------------ */
/* 4. WhatsApp — réception des messages entrants et réponse automatique */
/* ------------------------------------------------------------------ */
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Répondre immédiatement à Meta (obligatoire), traiter ensuite
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const from = message.from;                       // numéro de l'expéditeur
    const text = message.text.body;                  // contenu du message
    const phoneNumberId = change.metadata.phone_number_id; // numéro SHAMAN CHOOZ qui a reçu le message

    const reply = await askAssistant(text);
    await sendWhatsAppMessage(phoneNumberId, from, reply);

    await logToFirebase('whatsapp_conversations', {
      from, message: text, reply, phoneNumberId,
      date: new Date().toISOString()
    });
  } catch (e) {
    console.error('Erreur de traitement du message WhatsApp:', e);
  }
});

async function sendWhatsAppMessage(phoneNumberId, to, text) {
  await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      text: { body: text }
    })
  });
}

/* ------------------------------------------------------------------ */
/* 5. Chat du site web — appelé par le widget de index.html            */
/* ------------------------------------------------------------------ */
app.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'message manquant' });

    const reply = await askAssistant(message, history || []);

    await logToFirebase('site_conversations', {
      message, reply, date: new Date().toISOString()
    });

    res.json({ reply });
  } catch (e) {
    console.error('Erreur /chat:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/', (req, res) => {
  res.send('SHAMAN CHOOZ PRODUCTION — serveur du chatbot actif ✅');
});

app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
