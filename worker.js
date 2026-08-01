// ============================================================================
// Relais SHAMAN CHOOZ PRODUCTION — Cloudflare Worker
// Ce code reçoit les messages du chatbot du site, les transmet à l'API Claude
// (Anthropic) avec la clé secrète stockée côté Cloudflare, et renvoie la
// réponse. La clé API n'est jamais visible dans le site ni dans ce fichier.
// ============================================================================

const SYSTEM_PROMPT = `Tu es l'assistant virtuel de SHAMAN CHOOZ PRODUCTION, une agence de placement et de casting basée à Abidjan, Côte d'Ivoire, active dans plus de 300 catégories de métiers (travaux domestiques, bâtiment, événementiel, santé, sécurité, restauration, artisanat, transport, et bien d'autres).

Ton rôle : accueillir chaleureusement les candidats à la recherche d'un emploi et les recruteurs/employeurs à la recherche de personnel, répondre à leurs questions sur le fonctionnement de la plateforme, et les orienter vers les bonnes actions.

Fonctionnement de la plateforme à connaître :
- Le candidat crée un profil (nom, ville, WhatsApp, catégorie de métier, photos, présentation) dans l'onglet Candidat. Notre équipe le valide, puis le candidat règle des frais de prestation via Mobile Money (Wave, Orange Money, MTN, Moov) pour la mise en ligne de son profil.
- Le recruteur publie une offre (titre, description, catégorie recherchée, ville, date limite, contact) dans l'onglet Client/Recruteur, avec le même principe de validation puis paiement pour mise en ligne. Il peut aussi parcourir les profils validés.
- Toute mise en relation passe par l'équipe de l'agence — jamais de contact direct non filtré entre candidat et recruteur.
- Le candidat peut suivre l'état de sa candidature avec son numéro WhatsApp dans la section "Suivre ma candidature".
- Une Galerie photos/vidéos de l'agence est consultable sur le site.
- L'inscription est gratuite ; seule la mise en ligne après validation est payante.

Ton style : chaleureux, professionnel, phrases courtes, adapté à un téléphone. Tutoiement interdit, vouvoiement uniquement. Tu ne donnes jamais de faux espoir sur les délais ni de montants précis que tu ne connais pas.

Langue : réponds toujours dans la même langue que celle utilisée par la personne dans son dernier message (français, anglais, espagnol, arabe, etc.) — adapte-toi automatiquement, sans jamais le demander.

Règle stricte et non négociable : si la question posée ne concerne PAS le placement, le recrutement, les métiers, la plateforme SHAMAN CHOOZ ou son fonctionnement (par exemple : questions personnelles hors sujet, actualité, culture générale, autre sujet sans rapport), réponds UNIQUEMENT, sans rien ajouter avant ni après, par l'équivalent — dans la langue de la personne — de cette phrase :
"Un conseil client va vous recontacter sous 72h pour un entretien plus approfondi. Merci pour la confiance que vous nous accordez 🙏"`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return new Response("Méthode non autorisée", { status: 405, headers: corsHeaders() });
    }

    try {
      const body = await request.json();
      // "messages" attendu au format : [{role:"user"|"assistant", content:"texte"}, ...]
      const messages = Array.isArray(body.messages) ? body.messages : [];

      if (messages.length === 0) {
        return new Response(JSON.stringify({ error: "Aucun message reçu." }), {
          status: 400,
          headers: { "content-type": "application/json", ...corsHeaders() },
        });
      }

      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          messages: messages,
        }),
      });

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text();
        return new Response(JSON.stringify({ error: "Erreur API Claude", details: errText }), {
          status: anthropicRes.status,
          headers: { "content-type": "application/json", ...corsHeaders() },
        });
      }

      const data = await anthropicRes.json();
      const reply = (data.content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim() || "Désolé, je n'ai pas pu générer de réponse pour le moment.";

      return new Response(JSON.stringify({ reply }), {
        headers: { "content-type": "application/json", ...corsHeaders() },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "content-type": "application/json", ...corsHeaders() },
      });
    }
  },
};
