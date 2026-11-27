// Tests des 8 moteurs + orchestrateur (plus de 75 scénarios). Usage : node test-moteurs.cjs [shaman-moteurs.js]
// Ce script teste l'implémentation JavaScript ; le même fichier, lancé avec le moteur Kotlin compilé,
// est utilisé par smoke-test.cjs via engine.reply() (voir la fin de ce fichier pour les tests « chatbot »).
const fs = require('fs'), path = require('path');
const lex = JSON.parse(fs.readFileSync(path.join(__dirname, 'shaman-lexicon.json'), 'utf8'));
// Chargé comme un script (et non avec require) : le package.json du dépôt est en « type: module », ce qui ferait lire le .js comme un module ES.
const vm = require('vm'), fichierMoteurs = path.resolve(process.argv[2] || path.join(__dirname, 'shaman-moteurs.js'));
globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(fichierMoteurs, 'utf8'), { filename: fichierMoteurs });
const M = globalThis.ShamanMoteursJS;
const norm = M._internes.norm;
let fails = 0, n = 0;
const ok = (c, m, d) => { n++; console.log((c ? 'OK   ' : 'FAIL ') + m + (!c && d ? '\n       ' + d : '')); if (!c) fails++; };
const mk = (o) => M.create(lex.moteurs, Object.assign({ seed: 11 }, o || {}));
const say = (o, msg, opt, p) => o.traiter(p || 'p1', msg, opt);
const fakeFetch = (log) => (url) => {
  log.push(url);
  const j = (o) => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(o)) });
  if (url.includes('geocoding')) return j({ results: [{ name: 'Abidjan', latitude: 5.36, longitude: -4.01 }] });
  if (url.includes('open-meteo')) return j({ current: { temperature_2m: 29.4, weather_code: 3, wind_speed_10m: 12 }, daily: { temperature_2m_min: [25], temperature_2m_max: [32], precipitation_probability_max: [60] } });
  if (url.includes('shaman-actualite.json')) return j({ updated: new Date(Date.now() - 40 * 60000).toISOString(), cats: { sport: { source: 'RFI', updated: new Date(Date.now() - 40 * 60000).toISOString(), items: [{ title: 'Les Éléphants se qualifient après une victoire 2-0' }, { title: 'Le championnat reprend ce week-end' }] },
    infos: { source: 'France 24', updated: new Date(Date.now() - 3 * 86400000).toISOString(), items: [{ title: 'Un titre trop ancien' }] } } });
  return Promise.resolve({ ok: false, text: () => Promise.resolve('') });
};

(async () => {
  /* --- détection par moteur (10) --- */
  const det = [
    ['Mon patron me met la pression', 'PROFESSIONNEL', 'conflit'],
    ["Je prépare un entretien d'embauche demain", 'PROFESSIONNEL', 'entretien'],
    ['Je manque de confiance en moi', 'PERSONNEL', 'confiance'],
    ['Mon fils ne fait pas ses devoirs', 'FAMILIAL', 'enfants'],
    ['Mon mari et moi nous disputons tout le temps', 'COUPLE', 'dispute'],
    ['Mon voisin fait trop de bruit la nuit', 'SOCIAL', 'voisinage'],
    ["Je n'arrive pas à gérer mon budget, le loyer est trop cher", 'FINANCE', 'budget'],
    ['Je cherche du personnel qualifié pour mon entreprise', 'RECRUTEMENT', 'besoin_personnel'],
    ['Quelle est la météo à Abidjan demain ?', 'ACTUALITE', 'meteo'],
    ['Qui a gagné le match de foot hier ?', 'ACTUALITE', 'sport'],
  ];
  /* --- les 8 nouveaux moteurs (casting, études, numérique, démarches, business, logement, image, management) --- */
  const det2 = [
    ['Je prépare un casting pour mannequin demain', 'CASTING', 'mannequinat'],
    ['Je cherche des photos pour mon book', 'CASTING', 'dossier_casting'],
    ['Je veux devenir figurant dans un film', 'CASTING', 'cinema_figuration'],
    ['Que faire après le bac ? Je dois choisir une filière', 'ETUDES', 'orientation'],
    ['Comment préparer mes examens ?', 'ETUDES', 'examens'],
    ["Mon compte WhatsApp a été piraté, on a changé mon mot de passe", 'NUMERIQUE', 'comptes_securite'],
    ["On m'a envoyé un lien suspect et on me demande de l'argent", 'NUMERIQUE', 'arnaques_en_ligne'],
    ['Comment faire renouveler mon passeport ?', 'DEMARCHES', 'identite'],
    ['Où obtenir un casier judiciaire ?', 'DEMARCHES', 'certificats'],
    ['Comment trouver mes premiers clients pour ma boutique ?', 'BUSINESS', 'trouver_clients'],
    ["Je n'ai pas de clients dans mon commerce", 'BUSINESS', 'trouver_clients'],
    ['Je cherche un appartement à louer', 'LOGEMENT', 'chercher_logement'],
    ["J'ai le trac pour mon discours, comment parler en public ?", 'IMAGE', 'parler_en_public'],
    ['Comment motiver mon équipe, plusieurs employés sont démotivés ?', 'MANAGEMENT', 'motiver_equipe'],
    ["Comment gérer un conflit dans l'équipe avec un employé insolent ?", 'MANAGEMENT', 'discipline_conflits'],
  ];
  det2.forEach(([msg, dom, th], i) => {
    const r = say(mk(), msg);
    ok(r.type === 'MOTEUR' && r.domaine === dom && r.theme === th, `N${i + 1} nouveau moteur : « ${msg} » -> ${dom}/${th}`, `obtenu ${r.type} ${r.domaine}/${r.theme}`);
  });
  const mixte = say(mk(), "Mon propriétaire veut augmenter le loyer, que dit le bail ?");
  ok(mixte.domaine === 'LOGEMENT' && mixte.secondaire === 'FINANCE', 'N16 message mixte : logement (principal) + argent (secondaire)', `${mixte.domaine}+${mixte.secondaire}`);
  const mixte2 = say(mk(), "Comment bien m'habiller pour un entretien ?");
  ok(mixte2.domaine === 'IMAGE' && mixte2.secondaire === 'PROFESSIONNEL', 'N17 message mixte : image (principal) + travail (secondaire)', `${mixte2.domaine}+${mixte2.secondaire}`);
  const pontsOk = say(mk(), 'Je prépare un casting pour mannequin demain');
  ok(pontsOk.chips.indexOf('Créer mon profil') >= 0 && pontsOk.chips.length <= 6, 'N18 casting : boutons « ponts » vers les réponses de l\'agence (profil, contact…)', JSON.stringify(pontsOk.chips));
  ok(say(mk(), 'Bonjour').chips.indexOf('Casting') >= 0, 'N19 accueil : le bouton « Casting » est proposé', JSON.stringify(say(mk(), 'Bonjour').chips));
  const exp = say(mk(), "Mon propriétaire menace d'expulsion");
  ok(exp.domaine === 'LOGEMENT' && /juriste|avocat/.test(exp.parties.slice(1).join(' ')), 'N20 garde-fou juridique : litige de logement renvoyé vers un juriste', exp.texte);
  const neutres = ['Quelle heure est-il ?', 'Donne-moi une recette de poulet braisé', 'Raconte-moi une blague', 'Combien font 12 fois 15 ?', 'Explique-moi la photosynthèse', 'Traduis bonjour en anglais', 'Quel est le plus grand pays du monde ?', 'Explique la différence entre un virus et une bactérie', 'Où se trouve la Tour Eiffel ?', 'Comment ça marche ?', 'Écris un poème sur la mer', "C'est quoi un trou noir ?"];
  const faux = neutres.filter(m => say(mk(), m, { passerHorsDomaine: true }).type !== 'HORS_DOMAINE' && say(mk(), m, { passerHorsDomaine: true }).type !== 'FIXE');
  ok(faux.length === 0, `N21 pas de faux positifs : ${neutres.length} messages hors sujet restent hors domaine`, JSON.stringify(faux));

  det.forEach(([msg, dom, th], i) => {
    const r = say(mk(), msg);
    ok(r.type === 'MOTEUR' && r.domaine === dom && r.theme === th, `S${i + 1} détection : « ${msg} » -> ${dom}/${th}`, `obtenu ${r.type} ${r.domaine}/${r.theme}`);
  });

  /* --- suite de conversation / verrouillage (S11-S13) --- */
  let o = mk();
  let r1 = say(o, 'Mon patron me met la pression');
  let r2 = say(o, 'oui');
  ok(r2.domaine === 'PROFESSIONNEL' && r2.theme === 'conflit' && r2.decision.verrou, 'S11 suite : « oui » reste sur PROFESSIONNEL/conflit (sujet verrouillé)', JSON.stringify(r2.decision));
  let r3 = say(o, 'depuis deux mois');
  ok(r3.domaine === 'PROFESSIONNEL' && r3.theme === 'conflit', 'S12 suite : une réponse sans mot-clé garde le sujet et le sous-sujet', `${r3.domaine}/${r3.theme}`);
  ok(norm(r3.texte).includes('patron') || norm(r3.texte).includes('conflit'), 'S13 suite : la réponse reprend le fil (patron / conflit)', r3.texte);

  /* --- changement de sujet (S14-S16) --- */
  let c1 = say(o, 'Mon fils ne veut plus aller à l\'école');
  ok(c1.domaine === 'FAMILIAL' && c1.sujetChange === true, 'S14 changement implicite de sujet : travail -> famille', `${c1.domaine} ${c1.sujetChange}`);
  let c2 = say(o, 'Changeons de sujet');
  ok(c2.type === 'CLARIFICATION' && (c2.texte.match(/\?/g) || []).length === 1, 'S15 changement explicite : une seule question « de quoi parler ? »', c2.texte);
  let c3 = say(o, 'les finances');
  ok(c3.type === 'MOTEUR' && c3.domaine === 'FINANCE', 'S16 après la clarification : bascule sur FINANCE', `${c3.type} ${c3.domaine}`);

  /* --- message mixte (S17-S18) --- */
  let m1 = say(mk(), 'Mon mari a perdu son travail');
  const set = new Set([m1.domaine, m1.secondaire]);
  ok(m1.type === 'MOTEUR' && set.has('PROFESSIONNEL') && set.has('COUPLE'), 'S17 message mixte : moteur principal + secondaire (travail + couple)', `${m1.domaine}+${m1.secondaire}`);
  ok(m1.parties.length === 2 && /^Côté /.test(m1.parties[1]), 'S18 message mixte : 2 SMS, le second annonce « Côté … »', JSON.stringify(m1.parties));

  /* --- message ambigu (S19-S21) --- */
  o = mk();
  let a1 = say(o, 'ma famille et mon travail');
  ok(a1.type === 'CLARIFICATION' && (a1.texte.match(/\?/g) || []).length === 1, 'S19 message ambigu : UNE question de clarification', `${a1.type} ${a1.texte}`);
  ok(a1.chips && a1.chips.length >= 2, 'S20 clarification : boutons de réponse proposés', JSON.stringify(a1.chips));
  let a2 = say(o, 'le travail');
  ok(a2.type === 'MOTEUR' && a2.domaine === 'PROFESSIONNEL', 'S21 réponse à la clarification : route vers PROFESSIONNEL', `${a2.type} ${a2.domaine}`);

  /* --- hors domaine (S22-S24) --- */
  let h1 = say(mk(), 'Quelle est la capitale du Japon ?');
  ok(h1.type === 'HORS_DOMAINE' && /travail/.test(h1.texte) && /famille/.test(h1.texte), 'S22 hors domaine : recentrage poli listant les sujets', h1.texte);
  o = mk();
  let h2 = say(o, 'raconte moi une blague', { passerHorsDomaine: true });
  ok(h2.passe === true && o.depot.p1.historique.length === 0, 'S23 hors domaine (mode « passer ») : rien produit, historique intact');
  o = mk(); say(o, 'Mon patron me met la pression');
  let h3 = say(o, 'donne-moi une recette de poulet');
  ok(h3.type === 'HORS_DOMAINE', 'S24 hors domaine en pleine conversation : pas d\'absorption par le sujet verrouillé', h3.type);

  /* --- détresse (S25-S27) --- */
  let d1 = say(mk(), 'Je veux me tuer');
  ok(d1.type === 'DETRESSE' && d1.parties.length >= 2 && /professionnel/.test(d1.texte) && /personne de confiance|proche/.test(d1.texte), 'S25 détresse : soutien + orientation proche/professionnel', d1.texte);
  let d2 = say(mk({ numerosUrgence: '112' }), 'Je vais me tuer ce soir');
  ok(d2.type === 'DETRESSE' && d2.parties.length === 3 && /secours/.test(d2.texte) && /112/.test(d2.texte), 'S26 détresse critique : 3 SMS, rappel des secours + numéro configuré', d2.texte);
  let d3 = say(mk(), 'il me frappe tous les soirs');
  ok(d3.type === 'DETRESSE', 'S27 violence : message de soutien', d3.type);

  /* --- règles SMS (S28-S30) --- */
  const msgs = det.map(x => x[0]).concat(det2.map(x => x[0])).concat(['Je suis très stressé par mon travail', 'Dis-moi en détail les étapes pour négocier mon salaire avec mon patron']);
  let maxLen = 0, maxParts = 0, vides = 0, marq = 0;
  for (let i = 0; i < 80; i++) msgs.forEach(msg => {
    const r = say(mk({ seed: 100 + i }), msg);
    maxParts = Math.max(maxParts, r.parties.length);
    r.parties.forEach(p => { maxLen = Math.max(maxLen, p.length); if (!p.trim()) vides++; if (/[{}<>\[\]|]/.test(p)) marq++; });
  });
  ok(maxLen <= 160, `S28 longueur : aucun SMS au-delà de 160 caractères (max ${maxLen})`);
  ok(maxParts <= 3, `S29 longueur : 3 SMS maximum (max ${maxParts})`);
  ok(vides === 0 && marq === 0, 'S30 aucun SMS vide ni marqueur de gabarit non résolu', `vides=${vides} marqueurs=${marq}`);

  /* --- combinaisons (S31) --- */
  const st = mk().stats();
  ok(Object.keys(st.moteurs).length === 16 && Object.values(st.moteurs).every(x => x.combinaisons >= 5e8), `S31 combinaisons : 16 moteurs, chacun > 500 millions (${(Object.values(st.moteurs)[0].combinaisons / 1e9).toFixed(2)} milliards, ${(st.total / 1e9).toFixed(1)} au total)`);

  /* --- anti-répétition (S32-S33) --- */
  o = mk(); say(o, 'Mon patron me met la pression');
  let rep = 0, prev = o.depot.p1.historique.slice(-1)[0].reponse, memeConseil = 0, prevV = o.depot.p1.historique.slice(-1)[0].variantes;
  for (let i = 0; i < 60; i++) {
    const r = say(o, i % 2 ? 'oui' : 'et ensuite');
    if (r.texte === prev) rep++;
    const v = o.depot.p1.historique.slice(-1)[0].variantes;
    if (v.CONSEIL && prevV.CONSEIL && v.CONSEIL === prevV.CONSEIL) memeConseil++;
    prev = r.texte; prevV = v;
  }
  ok(rep === 0, 'S32 anti-répétition : jamais deux fois le même texte de suite (60 tours)', 'répétitions=' + rep);
  ok(memeConseil === 0, 'S33 anti-répétition : jamais la même formulation de conseil deux fois de suite', 'répétitions=' + memeConseil);
  const set2 = new Set(); for (let i = 0; i < 400; i++) set2.add(say(mk({ seed: 500 + i }), 'Mon patron me met la pression').texte);
  ok(set2.size > 300, `S34 variété : ${set2.size} réponses distinctes sur 400`);

  /* --- politesse, prénom, ton (S35-S38) --- */
  const tuRe = /\b(tu|ton|ta|tes|toi|te)\b/i, tElision = /\bt'[a-zéèêàâîïôûù]/i, vousRe = /\b(vous|votre|vos)\b/i;
  let bad = 0; for (let i = 0; i < 100; i++) { const r = say(mk({ seed: i + 1 }), 'Mon patron me met la pression'); if (tuRe.test(norm(r.texte).replace(/un ton calme/g, '')) || tElision.test(r.texte)) bad++; }
  ok(bad === 0, 'S35 vouvoiement par défaut : aucune forme de tutoiement', 'erreurs=' + bad);
  bad = 0; for (let i = 0; i < 100; i++) { const r = say(mk({ seed: i + 1, politesse: 'TUTOIEMENT' }), 'Mon patron me met la pression'); if (vousRe.test(r.texte)) bad++; }
  ok(bad === 0, 'S36 tutoiement configuré : aucune forme de vouvoiement', 'erreurs=' + bad);
  const au = mk({ politesse: 'AUTO' }); const ra = say(au, 'peux-tu m\'aider avec mon patron ?');
  ok(!vousRe.test(ra.texte), 'S37 politesse automatique : la personne tutoie, on tutoie', ra.texte);
  let pn = 0, mult = 0; for (let i = 0; i < 60; i++) { const r = say(mk({ seed: i + 1 }), 'Mon patron me met la pression', { prenom: 'Awa' }); const c = (r.texte.match(/Awa/g) || []).length; pn += c ? 1 : 0; if (c > 1) mult++; }
  ok(mult === 0 && pn > 5, `S38 prénom : jamais plus d'une fois par réponse (utilisé dans ${pn}/60)`, 'doublons=' + mult);

  /* --- émotion, reprise d'éléments, garde-fous (S39-S43) --- */
  let e1 = say(mk(), 'Je suis très stressé par mon patron');
  ok(e1.emotion === 'ANXIEUX' && e1.decision.principal === 'PROFESSIONNEL' && e1.journal.join().includes('EMPATHIE'), 'S39 émotion : stress détecté, bloc d\'empathie utilisé', e1.journal.join('\n'));
  let q1 = say(mk(), 'Mon patron me met la pression');
  ok(norm(q1.texte).includes('patron') || norm(q1.texte).includes('conflit'), 'S40 contrôle qualité : la réponse reprend un élément du message', q1.texte);
  let g1 = say(mk(), 'Je suis en burn out au travail');
  ok(/médecin|professionnel de santé/.test(g1.texte), 'S41 garde-fou médical : renvoi vers un professionnel de santé', g1.texte);
  let g2 = say(mk(), "Mon patron veut me licencier, j'ai besoin d'un avocat");
  ok(/juriste|avocat/.test(g2.parties.slice(1).join(' ')), 'S42 garde-fou juridique : renvoi vers un juriste', g2.texte);
  const DIAG = ['vous avez une depression', 'tu as une depression', 'c est illegal', 'vous souffrez de', 'tu souffres de', 'c est une maladie'];
  let diag = 0; for (let i = 0; i < 150; i++) msgs.forEach(msg => { const t = norm(say(mk({ seed: 900 + i }), msg).texte); if (DIAG.some(d => t.includes(d))) diag++; });
  ok(diag === 0, 'S43 aucune réponse ne pose de diagnostic ni d\'avis juridique définitif', 'occurrences=' + diag);

  /* --- actualité en direct + cache + hors ligne (S44-S50) --- */
  let log = []; o = mk({ fetch: fakeFetch(log) });
  let w0 = say(o, 'Quel temps fait-il demain ?');
  ok(w0.domaine === 'ACTUALITE' && w0.question && /ville|localité|lieu/.test(w0.texte), 'S44 météo sans ville : une seule question pour la ville', w0.texte);
  await o.precharger('p2', 'Quelle est la météo à Abidjan ?');
  let w1 = say(o, 'Quelle est la météo à Abidjan ?', null, 'p2');
  ok(w1.domaine === 'ACTUALITE' && /Abidjan/.test(w1.texte) && /29/.test(w1.texte) && /°C/.test(w1.texte), 'S45 météo en direct : ville, température, état du ciel', w1.texte);
  ok(/parapluie/.test(w1.texte), 'S46 météo : conseil dérivé des données (pluie 60 % -> parapluie)', w1.texte);
  const nb = log.length; await o.precharger('p2', 'et la météo à Abidjan demain ?'); ok(log.length === nb, 'S47 cache : pas de nouvel appel réseau pendant la durée de validité', `appels ${nb} -> ${log.length}`);
  o = mk({ fetch: () => Promise.reject(new Error('hors ligne')) }); await o.precharger('p1', 'Quelle est la météo à Bouaké ?');
  let w2 = say(o, 'Quelle est la météo à Bouaké ?');
  ok(w2.domaine === 'ACTUALITE' && /pas d'?\s?(information|info|donn)|aucune (information|info)|n'ai (rien|pas)|ne dispose/i.test(w2.texte) && !/°C/.test(w2.texte), 'S48 sans connexion : on dit honnêtement qu\'il n\'y a pas d\'info récente', w2.texte);
  log = []; o = mk({ fetch: fakeFetch(log) });
  let s0 = say(o, 'Qui a gagné le match de foot hier ?');
  ok(s0.domaine === 'ACTUALITE' && !s0.donnees && /pas d|aucune|n'ai (rien|pas)|ne dispose|me manquent|ne peux pas/i.test(s0.texte), 'S49 sport sans source configurée : honnêtement pas d\'info récente', s0.texte);
  o.configurerActualite({ proxy: 'https://site.exemple/shaman-actualite.json' }); await o.precharger('p1', 'Qui a gagné le match de foot hier ?');
  let s1 = say(o, 'Qui a gagné le match de foot hier ?');
  ok(s1.donnees && /Éléphants/.test(s1.texte) && /RFI/.test(s1.texte) && /mis à jour il y a 4\d min/.test(s1.texte), 'S50 sport via shaman-actualite.json : titres + source + date de mise à jour', s1.texte);
  await o.precharger('p3', 'Quelles sont les dernières infos ?');
  let s2 = say(o, 'Quelles sont les dernières infos ?', null, 'p3');
  ok(s2.domaine === 'ACTUALITE' && !s2.donnees && !/trop ancien/.test(s2.texte), 'S55 info trop ancienne (3 jours) : jamais présentée comme récente', s2.texte);

  /* --- état (S51-S53) --- */
  o = mk(); say(o, 'Mon patron me met la pression'); const dump = o.exporter('p1'); const o2 = mk(); o2.importer('p1', dump);
  ok(say(o2, 'oui').theme === 'conflit', 'S51 état exporté puis rechargé : le sujet verrouillé est retrouvé');
  o = mk(); for (let i = 0; i < 25; i++) say(o, i % 2 ? 'oui' : 'Mon patron me met la pression');
  ok(o.depot.p1.historique.length === 10, 'S52 historique limité aux 10 derniers échanges');
  ok(say(mk(), '   ').type === 'VIDE', 'S53 message vide : demande polie de réécrire');
  const cl = []; for (let i = 0; i < 40; i++) { const r = say(mk({ seed: 300 + i }), 'ma famille et mon travail'); cl.push((r.texte.match(/\?/g) || []).length); }
  ok(cl.every(x => x === 1), 'S54 clarification : toujours exactement UNE question');

  console.log(`\n${n - fails}/${n} scénarios réussis`);
  process.exit(fails ? 1 : 0);
})();
