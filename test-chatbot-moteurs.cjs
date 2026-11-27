// Tests « chatbot » : les 8 moteurs vus à travers l'API du moteur (reply / replyAsync / stats / journal).
// Usage : node test-chatbot-moteurs.cjs <fichier-moteur.js>   (Kotlin compilé ou port JS)
const fs = require('fs'), vm = require('vm'), path = require('path');
const file = process.argv[2] || 'shaman-engine-kotlin.js', root = __dirname;
globalThis.self = globalThis; globalThis.window = globalThis;
const mj = path.join(root, 'shaman-moteurs.js');
if (fs.existsSync(mj)) vm.runInThisContext(fs.readFileSync(mj, 'utf8'), { filename: mj });
vm.runInThisContext(fs.readFileSync(path.resolve(file), 'utf8'), { filename: file });
const make = globalThis.createShamanEngine || ((l, c, s) => globalThis.ShamanEngineJS.create(l, c, s));
const lex = fs.readFileSync(path.join(root, 'shaman-lexicon.json'), 'utf8'), cours = fs.readFileSync(path.join(root, 'shaman-cours.json'), 'utf8');
let fails = 0, n = 0;
const ok = (c, m, d) => { n++; console.log((c ? 'OK   ' : 'FAIL ') + m + (!c && d ? '\n       ' + d : '')); if (!c) fails++; };
const fresh = () => make(lex, cours, 7);
const R = (e, t) => JSON.parse(e.reply(t));
const J = (o) => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(o)) });
const fakeFetch = (url) => /geocoding/.test(url) ? J({ results: [{ name: 'Abidjan', latitude: 5.36, longitude: -4.01 }] })
  : /open-meteo/.test(url) ? J({ current: { temperature_2m: 29.4, weather_code: 3, wind_speed_10m: 12 }, daily: { temperature_2m_min: [25], temperature_2m_max: [32], precipitation_probability_max: [60] } })
  : Promise.resolve({ ok: false, text: () => Promise.resolve('') });

(async () => {
  let e = fresh(), r = R(e, 'Mon patron me met la pression');
  ok(r.kind === 'moteur' && r.moteur === 'PROFESSIONNEL' && r.theme === 'conflit', 'C1 le chatbot route vers le moteur Professionnel (sous-sujet conflit)', JSON.stringify([r.kind, r.moteur, r.theme]));
  ok(r.parts && r.parts.length >= 1 && r.parts.every(p => p.length <= 160), 'C2 la réponse est découpée en SMS de 160 caractères au plus');
  r = R(e, 'oui'); ok(r.moteur === 'PROFESSIONNEL' && r.theme === 'conflit', 'C3 suite de conversation : le sujet reste verrouillé', JSON.stringify([r.kind, r.moteur, r.theme]));
  r = R(e, 'Quels sont les frais de prestation ?'); ok(r.intent === 'fees', 'C4 les réponses curatées de l\'agence gardent la priorité (frais)', r.intent);
  r = R(e, 'oui'); ok(r.moteur !== 'PROFESSIONNEL', 'C5 après une réponse de l\'agence, l\'ancien sujet est libéré', JSON.stringify([r.kind, r.moteur]));
  r = R(fresh(), 'Quelle est la capitale du Japon ?'); ok(r.kind === 'fallback' && /travail/.test(r.text) && /famille/.test(r.text), 'C6 hors domaine : recentrage poli sur ce que l\'assistant sait faire', r.text);
  r = R(fresh(), 'Je veux me tuer'); ok(r.kind === 'safety', 'C7 détresse : message de soutien (garde-fou)');
  r = R(fresh(), 'ma famille et mon travail'); ok(r.kind === 'clarification' && (r.text.match(/\?/g) || []).length === 1 && r.chips.indexOf('Travail') >= 0, 'C8 message ambigu : UNE question, boutons de réponse', JSON.stringify([r.kind, r.text, r.chips]));
  e = fresh(); e.setInstructions('politesse: tu'); r = R(e, 'Mon patron me met la pression');
  ok(!/\b(vous|votre|vos)\b/i.test(r.text), 'C9 instruction « politesse: tu » respectée', r.text);
  e = fresh(); r = R(e, 'Mon patron me met la pression'); ok(!/\b(tu|ton|ta|tes|toi)\b/i.test(r.text.replace(/un ton calme/g, '')), 'C10 vouvoiement par défaut (règle de l\'agence)', r.text);
  e = fresh(); R(e, 'Mon fils ne fait pas ses devoirs'); const dbg = JSON.parse(e.journal());
  ok(dbg.some(l => /ÉTAPE 7/.test(l)) && dbg.some(l => /ÉTAPES 4-5/.test(l)), 'C11 journal de debug : routage, score, sujet verrouillé, contrôle qualité', dbg.slice(-4).join('\n'));
  const st = JSON.parse(e.stats()); ok(st.moteurs && Object.keys(st.moteurs.moteurs).length === 16 && st.moteurs.total >= 4e10, 'C12 stats : 16 moteurs, plus de 40 milliards de combinaisons au total');
  e = fresh(); R(e, 'Mon patron me met la pression'); const dump = e.exportConversation(); const e2 = fresh(); e2.importConversation(dump);
  r = R(e2, 'oui'); ok(r.moteur === 'PROFESSIONNEL', 'C13 conversation exportée puis rechargée : le sujet est retrouvé');
  e.reset(); r = R(e, 'oui'); ok(r.moteur !== 'PROFESSIONNEL', 'C14 reset : le sujet verrouillé est effacé');
  e = fresh(); R(e, 'Mon patron me met la pression'); let prev = '', dup = 0; for (let i = 0; i < 30; i++) { const t = R(e, i % 2 ? 'oui' : 'et ensuite').text; if (t === prev) dup++; prev = t; }
  ok(dup === 0, 'C15 anti-répétition : jamais deux fois le même texte de suite');
  e = fresh(); r = R(e, 'Je prépare un casting pour mannequin demain');
  ok(r.moteur === 'CASTING' && r.chips.indexOf('Créer mon profil') >= 0, 'C18 casting : le chatbot répond avec le moteur Casting et propose un pont vers l\'agence', JSON.stringify([r.moteur, r.chips]));
  r = R(e, 'Créer mon profil'); ok(r.intent === 'candidate', 'C19 le bouton « Créer mon profil » ouvre la réponse de l\'agence (candidat)', JSON.stringify([r.kind, r.intent]));
  r = R(fresh(), 'Où obtenir un casier judiciaire ?'); ok(r.moteur === 'DEMARCHES', 'C20 démarches : casier judiciaire -> moteur Démarches', JSON.stringify([r.kind, r.moteur]));
  r = R(fresh(), 'Je suis recruteur'); ok(r.intent === 'recruiter', 'C21 « Je suis recruteur » reste une réponse de l\'agence', JSON.stringify([r.kind, r.intent]));
  r = R(fresh(), 'Est-ce fiable ?'); ok(r.intent === 'security', 'C22 « Est-ce fiable ? » reste une réponse de l\'agence (sécurité)', JSON.stringify([r.kind, r.intent]));
  const st2 = JSON.parse(fresh().stats()); ok(st2.moteurs && Object.keys(st2.moteurs.moteurs).length === 16, 'C23 stats : 16 moteurs thématiques actifs');
  if (typeof e.replyAsync === 'function') {
    const old = globalThis.fetch; globalThis.fetch = fakeFetch;
    e = fresh(); r = JSON.parse(await e.replyAsync('Quelle est la météo à Abidjan ?'));
    ok(r.moteur === 'ACTUALITE' && /Abidjan/.test(r.text) && /°C/.test(r.text), 'C16 météo en direct (données factices) : ville + température', r.text);
    globalThis.fetch = () => Promise.reject(new Error('hors ligne'));
    e = fresh(); r = JSON.parse(await e.replyAsync('Quelle est la météo à Bouaké ?'));
    ok(r.moteur === 'ACTUALITE' && !/°C/.test(r.text) && /pas d|aucune|n'ai|ne dispose|ne peux|manquent/i.test(r.text), 'C17 sans connexion : honnête, aucune donnée inventée', r.text);
    globalThis.fetch = old;
  } else console.log('INFO replyAsync absent (ancien build) : tests C16-C17 ignorés');
  console.log(`\n${n - fails}/${n} vérifications réussies`);
  process.exit(fails ? 1 : 0);
})();
