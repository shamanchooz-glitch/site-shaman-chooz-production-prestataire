// Test de fumée : vérifie qu'un moteur (Kotlin compilé ou port JS) répond correctement.
// Usage : node smoke-test.cjs <fichier-moteur.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const file = process.argv[2] || 'shaman-engine-kotlin.js';
const root = __dirname;
globalThis.self = globalThis; globalThis.window = globalThis;
// Les 8 moteurs thématiques en JavaScript (utilisés par le port JS ; sans effet pour le moteur Kotlin compilé).
const mj = path.join(root, 'shaman-moteurs.js');
if (fs.existsSync(mj)) vm.runInThisContext(fs.readFileSync(mj, 'utf8'), { filename: mj });
vm.runInThisContext(fs.readFileSync(path.resolve(file), 'utf8'), { filename: file });
const make = globalThis.createShamanEngine ||
  (globalThis.ShamanEngineJS && ((l, c, s) => globalThis.ShamanEngineJS.create(l, c, s)));
if (!make) { console.error('FAIL : aucune fabrique de moteur trouvée dans', file); process.exit(1); }
const lex = fs.readFileSync(path.join(root, 'shaman-lexicon.json'), 'utf8');
const cours = fs.readFileSync(path.join(root, 'shaman-cours.json'), 'utf8');
const e = make(lex, cours, 7);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const R = t => JSON.parse(e.reply(t));
const st = JSON.parse(e.stats());
ok(st.combinations >= 1e8, 'moteur contexte : plus de 100 millions de messages (' + st.combinations + ')');
ok(st.lifeCombinations >= 2 * st.combinations, 'moteur vie courante : au moins 2 fois plus (' + st.lifeCombinations + ')');
ok(st.chapters >= 357, 'cours chargés : ' + st.chapters + ' chapitres');
ok(R('Bonjour').intent === 'greeting', 'salutation reconnue');
ok(R('Comment créer mon profil candidat ?').intent === 'candidate', 'question candidat');
ok(R('Quels sont les frais de prestation ?').intent === 'fees', 'question frais');
ok(R('Quelle est la capitale du Japon ?').kind === 'fallback', 'question hors champ : réponse prudente');
ok(R('Qui a gagné le match de foot hier ?').intent === 'sport', 'vie courante : sport');
ok(R('Mon fils ne veut pas faire ses devoirs').intent === 'enfants', 'vie courante : enfants');
ok(R('Comment cuisiner l\'attiéké ?').intent === 'cuisine', 'vie courante : cuisine');
ok(R('raconte moi une blague').intent === 'humour', 'vie courante : humour');
ok(R('Quelle heure est-il ?').intent === 'datetime', 'date et heure');
ok(R('Je veux me tuer').kind === 'safety', 'garde-fou détresse');
ok(R('Mon père a une douleur dans la poitrine').kind === 'safety', 'garde-fou urgence médicale');
e.reset();
ok(R('Cours droit du travail').kind === 'course', 'menu de matière');
ok(/\[1\/\d+\]/.test(R('Cours : contrat de travail').text), 'cours détaillé démarré');
ok(/\[2\/\d+\]/.test(R('suite').text), 'section suivante');
const si = JSON.parse(e.setInstructions('nom: Awa\nsi horaires alors Lundi au samedi.'));
ok(si.applied === 2, 'instructions appliquées');
ok(R('horaires ?').kind === 'rule', 'règle personnalisée');
e.setLearned(JSON.stringify({ qa: [{ q: 'slogan shaman', a: 'Le bon visage.' }], courses: [] }));
ok(R('Quel est le slogan de Shaman ?').kind === 'learned', 'réponse apprise');
const seen = new Set(); for (let i = 0; i < 3000; i++) seen.add(R('Comment ça marche ?').text);
ok(seen.size > 2500, 'variété des réponses : ' + seen.size + ' messages distincts sur 3000');
const seen2 = new Set(); for (let i = 0; i < 3000; i++) seen2.add(R('Parlons de cuisine').text);
ok(seen2.size > 2500, 'variété vie courante : ' + seen2.size + ' messages distincts sur 3000');
process.exit(fails ? 1 : 0);
