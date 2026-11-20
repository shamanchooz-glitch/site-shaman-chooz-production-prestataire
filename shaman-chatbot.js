/* SHAMAN CHOOZ PRODUCTION — chatbot du site (remplace l'ancien widget bleu).
 * Moteur : shaman-engine-kotlin.js (build Kotlin/JS) si présent, sinon shaman-engine.js (port JS du même moteur).
 * Données : shaman-lexicon.json (phrases/intentions/secteurs) + shaman-cours.json (cours universitaires). */
(function () {
  'use strict';
  if (window.__shamanBot) return;
  window.__shamanBot = true;

  var SC = document.currentScript;
  var BASE = SC && SC.src ? SC.src.replace(/[^\/]*$/, '') : '';
  var K = { instr: 'shb_instr', learned: 'shb_learned', voice: 'shb_voice' };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  var CSS = '' +
    '.shb-launch{position:fixed;bottom:22px;right:16px;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;z-index:100001;background:var(--wine,#7A1F30);color:#fff;box-shadow:0 8px 22px rgba(28,19,13,.35);display:flex;align-items:center;justify-content:center;transition:transform .15s}' +
    '.shb-launch:hover{background:var(--wine-light,#9C3349);transform:scale(1.05)}' +
    '.shb-launch svg{width:28px;height:28px;fill:#fff}' +
    '.shb-panel{position:fixed;bottom:92px;right:12px;width:min(390px,calc(100vw - 24px));height:min(600px,calc(100vh - 120px));height:min(600px,calc(100dvh - 120px));z-index:100002;display:none;flex-direction:column;background:var(--paper,#FBF4E6);color:var(--ink,#1C130D);border-radius:18px;overflow:hidden;box-shadow:0 24px 48px -12px rgba(28,19,13,.45);font-family:var(--font-body,sans-serif);font-size:15px;line-height:1.4}' +
    '.shb-panel.open{display:flex}' +
    '.shb-panel.full{inset:0;bottom:0;right:0;width:100vw;height:100vh;height:100dvh;border-radius:0}' +
    '.shb-head{background:var(--ink,#1C130D);color:var(--paper,#FBF4E6);padding:12px 14px;display:flex;align-items:center;gap:10px}' +
    '.shb-av{width:34px;height:34px;border-radius:50%;background:var(--gold,#C6932F);color:var(--ink,#1C130D);display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0}' +
    '.shb-ht{font-weight:700;font-size:.95rem}.shb-hs{font-size:.68rem;opacity:.7}' +
    '.shb-hb{margin-left:auto;display:flex;gap:2px}' +
    '.shb-hb button{background:none;border:none;color:inherit;font-size:1.05rem;cursor:pointer;padding:6px 8px;border-radius:8px;opacity:.85}.shb-hb button:hover{background:rgba(255,255,255,.12);opacity:1}' +
    '.shb-tabs{display:flex;background:var(--paper-soft,#F1E4CC);border-bottom:1px solid var(--line,rgba(28,19,13,.13))}' +
    '.shb-tabs button{flex:1;border:none;background:none;padding:10px 4px;font-size:.8rem;font-weight:700;color:var(--ink-soft,#5B4C3E);cursor:pointer;border-bottom:3px solid transparent;font-family:inherit}' +
    '.shb-tabs button.on{color:var(--ink,#1C130D);border-bottom-color:var(--wine,#7A1F30)}' +
    '.shb-tab{display:none;flex:1;min-height:0;flex-direction:column}.shb-tab.on{display:flex}' +
    '.shb-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}' +
    '.shb-m{max-width:86%;padding:9px 13px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}' +
    '.shb-m.bot{background:#fff;border:1px solid var(--line,rgba(28,19,13,.13));align-self:flex-start;border-bottom-left-radius:4px}' +
    '.shb-m.user{background:var(--wine,#7A1F30);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}' +
    '.shb-typing{font-size:.78rem;font-style:italic;color:var(--ink-soft,#5B4C3E);align-self:flex-start}' +
    '.shb-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 8px}' +
    '.shb-chips button{background:#fff;border:1.3px solid var(--gold,#C6932F);color:var(--ink,#1C130D);border-radius:999px;padding:6px 12px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit}.shb-chips button:hover{background:var(--gold-light,#E4C077)}' +
    '.shb-in{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line,rgba(28,19,13,.13));background:#fff}' +
    '.shb-in input{flex:1;min-width:0;padding:10px 14px;border-radius:999px;border:1.5px solid var(--line,rgba(28,19,13,.13));font-size:16px;font-family:inherit}.shb-in input:focus{outline:2px solid var(--gold,#C6932F);border-color:var(--gold,#C6932F)}' +
    '.shb-in button{background:var(--wine,#7A1F30);color:#fff;border:none;border-radius:999px;padding:0 18px;font-weight:700;cursor:pointer;font-family:inherit}' +
    '.shb-pad{flex:1;overflow-y:auto;padding:14px;-webkit-overflow-scrolling:touch}' +
    '.shb-pad h4{margin:0 0 6px;font-size:.95rem}.shb-pad p,.shb-pad li{font-size:.8rem;color:var(--ink-soft,#5B4C3E);margin:0 0 8px}' +
    '.shb-pad ul{padding-left:18px;margin:0 0 10px}.shb-pad code{background:var(--paper-soft,#F1E4CC);padding:1px 5px;border-radius:5px;font-size:.76rem}' +
    '.shb-pad textarea,.shb-pad input[type=text]{width:100%;border:1.5px solid var(--line,rgba(28,19,13,.13));border-radius:10px;padding:9px 11px;font-size:16px;font-family:inherit;margin-bottom:8px;background:#fff}' +
    '.shb-pad textarea{min-height:110px;resize:vertical}' +
    '.shb-btn{background:var(--wine,#7A1F30);color:#fff;border:none;border-radius:10px;padding:9px 14px;font-weight:700;font-size:.82rem;cursor:pointer;margin:0 6px 6px 0;font-family:inherit}.shb-btn.alt{background:#fff;color:var(--ink,#1C130D);border:1.5px solid var(--gold,#C6932F)}' +
    '.shb-note{font-size:.78rem;background:var(--paper-soft,#F1E4CC);border-radius:10px;padding:8px 10px;margin:4px 0 10px;display:none;white-space:pre-wrap}.shb-note.on{display:block}' +
    '.shb-seg{display:flex;gap:6px;margin-bottom:10px}.shb-seg button{flex:1;border:1.5px solid var(--gold,#C6932F);background:#fff;border-radius:999px;padding:6px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit}.shb-seg button.on{background:var(--gold,#C6932F)}' +
    '.shb-admin .shb-tab{display:none}.shb-admin .shb-tab.on{display:block}.shb-admin .shb-pad{overflow:visible;padding:14px 4px}.shb-admin .shb-tabs{border-radius:12px;overflow:hidden;margin-bottom:6px}.shb-admin .hint{font-size:.85rem}.shb-admin .shb-note{font-size:.82rem}' +
    '.shb-item{display:flex;gap:8px;align-items:flex-start;background:#fff;border:1px solid var(--line,rgba(28,19,13,.13));border-radius:10px;padding:8px 10px;margin-bottom:6px;font-size:.78rem}.shb-item span{flex:1;overflow-wrap:anywhere}.shb-item button{border:none;background:none;cursor:pointer;font-size:1rem;color:var(--wine,#7A1F30)}';

  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>';

  function h(tag, attrs, kids) {
    var e = document.createElement(tag), k;
    for (k in (attrs || {})) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  var engine = null, engineName = '', voiceOn = lsGet(K.voice, '1') === '1';
  var learned = { qa: [], courses: [] };
  var fileMem = { instructions: '', qa: [], courses: [] };   // contenu de shaman-memoire.json (commun à tous les visiteurs)
  try { var l0 = JSON.parse(lsGet(K.learned, '{}')); learned.qa = l0.qa || []; learned.courses = l0.courses || []; } catch (e) { }

  /* ---------- DOM ---------- */
  var style = h('style', { text: CSS });
  var launch = h('button', { class: 'shb-launch', type: 'button', 'aria-label': 'Ouvrir l\'assistant SHAMAN', html: ICON });
  var msgs = h('div', { class: 'shb-msgs', role: 'log', 'aria-live': 'polite' });
  var chips = h('div', { class: 'shb-chips' });
  var input = h('input', { type: 'text', placeholder: 'Écrivez votre message…', autocomplete: 'off', 'aria-label': 'Votre message', maxlength: '500' });
  var status = h('div', { class: 'shb-hs', text: 'Chargement…' });
  var adminStatus = h('div', { class: 'shb-note on', text: 'Chargement du moteur…' });
  var voiceBtn = h('button', { type: 'button', title: 'Lecture à voix haute', 'aria-label': 'Lecture à voix haute', text: voiceOn ? '🔊' : '🔇' });
  var fullBtn = h('button', { type: 'button', title: 'Plein écran', 'aria-label': 'Plein écran', text: '⛶' });
  var closeBtn = h('button', { type: 'button', title: 'Fermer', 'aria-label': 'Fermer', text: '✕' });
  var tabBtns = ['🧩 Instructions', '🎓 Apprendre'].map(function (t, i) { return h('button', { type: 'button', text: t, onclick: function () { showAdminTab(i); } }); });

  var chatTab = h('div', { class: 'shb-tab on' }, [msgs, chips,
    h('form', { class: 'shb-in', onsubmit: function (e) { e.preventDefault(); var v = input.value; input.value = ''; send(v); } }, [input, h('button', { type: 'submit', text: 'Envoyer' })])]);

  /* Onglet Instructions */
  var instrTa = h('textarea', { placeholder: 'ton: chaleureux\nnom: Awa\nsignature: — L\'équipe SHAMAN CHOOZ\ninterdit: politique, religion\nsi horaires alors Nous répondons sur WhatsApp du lundi au samedi.\ninfo: Les bureaux sont à Abidjan.' });
  instrTa.value = lsGet(K.instr, '');
  var instrNote = h('div', { class: 'shb-note' });
  var instrFileNote = h('div', { class: 'shb-note' });
  var instrTab = h('div', { class: 'shb-tab' }, [h('div', { class: 'shb-pad' }, [
    h('h4', { text: 'Ajouter des instructions' }),
    h('p', { text: 'Une consigne par ligne. Vos ajouts s\'appliquent tout de suite sur cet appareil ; pour les mettre sur le site, utilisez la fusion JSON en bas.' }),
    h('ul', { html: '<li><code>nom: Awa</code> : prénom de l\'assistant</li><li><code>ton: cool</code> / <code>chaleureux</code> / <code>pro</code> : style (emojis)</li><li><code>signature: …</code> : phrase ajoutée à chaque réponse</li><li><code>interdit: mot1, mot2</code> : sujets refusés poliment</li><li><code>si mot1, mot2 alors réponse</code> : réponse imposée</li><li><code>info: …</code> : fait que l\'assistant peut citer</li>' }),
    instrTa,
    h('button', { class: 'shb-btn', type: 'button', text: 'Enregistrer', onclick: saveInstr }),
    h('button', { class: 'shb-btn alt', type: 'button', text: 'Tout effacer', onclick: function () { instrTa.value = ''; saveInstr(); } }),
    instrNote, instrFileNote, mergeBox()])]);

  /* Onglet Apprendre */
  var mode = 'qa';
  var qIn = h('input', { type: 'text', placeholder: 'Question ou mots-clés (ex : slogan de l\'agence)' });
  var aIn = h('textarea', { placeholder: 'Réponse que l\'assistant devra donner' });
  var sIn = h('input', { type: 'text', placeholder: 'Matière (ex : Casting)' });
  var cIn = h('input', { type: 'text', placeholder: 'Chapitre (ex : Audition)' });
  var tIn = h('textarea', { placeholder: 'Texte du cours. Phrases courtes. Commencez une phrase par « Exemple : » ou « Outils : » pour alimenter ces sections et le quiz.' });
  var qaBox = h('div', {}, [qIn, aIn]), crBox = h('div', {}, [sIn, cIn, tIn]);
  var segQa = h('button', { type: 'button', class: 'on', text: 'Question → réponse', onclick: function () { setMode('qa'); } });
  var segCr = h('button', { type: 'button', text: 'Nouveau cours', onclick: function () { setMode('cr'); } });
  var learnNote = h('div', { class: 'shb-note' }), listBox = h('div', {});
  var fileIn = h('input', { type: 'file', accept: 'application/json', style: 'display:none', onchange: importFile });
  crBox.style.display = 'none';
  var learnTab = h('div', { class: 'shb-tab' }, [h('div', { class: 'shb-pad' }, [
    h('h4', { text: 'Apprendre à l\'assistant' }),
    h('p', { text: 'Ce que vous ajoutez est utilisé en priorité dans les conversations. Les éléments 🌐 viennent du fichier du site, les 📱 sont locaux.' }),
    h('div', { class: 'shb-seg' }, [segQa, segCr]), qaBox, crBox,
    h('button', { class: 'shb-btn', type: 'button', text: 'Apprendre', onclick: addLearned }),
    h('button', { class: 'shb-btn alt', type: 'button', text: 'Importer un JSON', onclick: function () { fileIn.click(); } }), fileIn,
    learnNote, listBox, mergeBox()])]);

  var panel = h('div', { class: 'shb-panel', role: 'dialog', 'aria-label': 'Assistant SHAMAN CHOOZ' }, [
    h('div', { class: 'shb-head' }, [h('div', { class: 'shb-av', text: 'S' }),
      h('div', {}, [h('div', { class: 'shb-ht', text: 'Assistant SHAMAN' }), status]),
      h('div', { class: 'shb-hb' }, [voiceBtn, fullBtn, closeBtn])]),
    chatTab]);

  document.head.appendChild(style);
  document.body.appendChild(launch);
  document.body.appendChild(panel);

  /* ---------- Comportements ---------- */
  var opened = false;
  var adminTabs = [instrTab, learnTab];
  function showAdminTab(i) { adminTabs.forEach(function (t, j) { t.classList.toggle('on', i === j); tabBtns[j].classList.toggle('on', i === j); }); }
  /* Espace administrateur : moteur, instructions, apprentissage (le bloc #shb-admin-root est dans le tableau de bord admin du site) */
  function mountAdmin() {
    var root = document.getElementById('shb-admin-root');
    if (!root) return;
    root.classList.add('shb-admin');
    root.appendChild(h('p', { class: 'hint', text: 'Les visiteurs ne voient que la conversation. Ici, vous voyez le moteur et vous le faites évoluer. Pour tester vos ajouts, ouvrez la bulle de chat sur cet appareil.' }));
    root.appendChild(adminStatus);
    root.appendChild(h('div', { class: 'shb-tabs' }, tabBtns));
    root.appendChild(instrTab); root.appendChild(learnTab);
    showAdminTab(0);
  }
  function refreshAdminStatus() {
    if (!engine) return;
    var s = JSON.parse(engine.stats()), n = function (x) { return Math.round(x / 1e6); };
    var m = mergedMemory();
    note(adminStatus, '⚙️ Moteur : ' + engineName + (engineName === 'Kotlin' ? ' ✅ (compilé par GitHub)' : ' — version JavaScript (le build Kotlin n\'est pas actif)') +
      '\n💬 Messages possibles : ' + n(s.combinations) + ' M (emploi et recrutement) + ' + n(s.lifeCombinations) + ' M (vie courante) = ' + (n(s.combinations) + n(s.lifeCombinations)) + ' M' +
      '\n🧭 Sujets de vie courante : ' + s.lifeTopics + ' · Intentions du site : ' + s.intents +
      '\n🎓 Cours : ' + s.chapters + ' chapitres dans ' + s.subjects + ' matières' +
      '\n🌐 Fichier du site (shaman-memoire.json) : ' + fileMem.qa.length + ' question(s), ' + fileMem.courses.length + ' cours, ' + (fileMem.instructions ? fileMem.instructions.split('\n').filter(function (x) { return x.trim(); }).length : 0) + ' consigne(s)' +
      '\n📱 Ajouts locaux (cet appareil) : ' + learned.qa.length + ' question(s), ' + learned.courses.length + ' cours' +
      '\n🧩 Total actif dans le chatbot : ' + m.qa.length + ' question(s), ' + m.courses.length + ' cours');
  }
  function setMode(m) { mode = m; qaBox.style.display = m === 'qa' ? '' : 'none'; crBox.style.display = m === 'cr' ? '' : 'none'; segQa.classList.toggle('on', m === 'qa'); segCr.classList.toggle('on', m === 'cr'); }
  function toggle(open) {
    var o = open === undefined ? !panel.classList.contains('open') : open;
    panel.classList.toggle('open', o);
    if (o) { if (engine && !opened) { opened = true; welcome(); } input.focus(); }
    else if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
  launch.addEventListener('click', function () { toggle(); });
  closeBtn.addEventListener('click', function () { toggle(false); });
  fullBtn.addEventListener('click', function () { panel.classList.toggle('full'); });
  voiceBtn.addEventListener('click', function () {
    voiceOn = !voiceOn; lsSet(K.voice, voiceOn ? '1' : '0'); voiceBtn.textContent = voiceOn ? '🔊' : '🔇';
    if (!voiceOn && window.speechSynthesis) window.speechSynthesis.cancel();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) toggle(false); });

  function addMsg(who, text) {
    var m = h('div', { class: 'shb-m ' + who, text: text }); msgs.appendChild(m);
    msgs.scrollTop = msgs.scrollHeight; return m;
  }
  function setChips(list) {
    chips.innerHTML = '';
    (list || []).slice(0, 7).forEach(function (c) { chips.appendChild(h('button', { type: 'button', text: c, onclick: function () { send(c); } })); });
    msgs.scrollTop = msgs.scrollHeight;
  }
  function speak(t) { if (voiceOn && typeof window.shSpeak === 'function') { try { window.shSpeak(t); } catch (e) { } } }
  function ask(text) {
    try { return JSON.parse(engine.reply(text)); } catch (e) { console.warn('[Shaman]', e); return { text: 'Désolé, un incident technique est survenu. Pouvez-vous reformuler ?', chips: [] }; }
  }
  function welcome() { var r = ask('Bonjour'); addMsg('bot', r.text); setChips(r.chips); }
  function send(text) {
    text = String(text || '').trim().slice(0, 500);
    if (!text) return;
    if (!engine) { addMsg('bot', 'L\'assistant démarre, réessayez dans un instant.'); return; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    addMsg('user', text); setChips([]);
    var t = h('div', { class: 'shb-typing', text: 'L\'assistant écrit…' }); msgs.appendChild(t); msgs.scrollTop = msgs.scrollHeight;
    setTimeout(function () {
      var r = ask(text); t.remove(); addMsg('bot', r.text); setChips(r.chips); speak(r.text);
    }, 250 + Math.floor(Math.random() * 450));
  }

  function note(el, txt) { el.textContent = txt; el.classList.add('on'); }
  function keyQa(x) { return String(x.q || '').toLowerCase().trim(); }
  function keyCr(x) { return (String(x.s || '') + '|' + String(x.c || '')).toLowerCase().trim(); }
  function dedupe(list, keyFn) { var seen = {}, out = []; list.forEach(function (x) { var k = keyFn(x); if (!seen[k]) { seen[k] = 1; out.push(x); } }); return out; }
  /* Fichier du site + ajouts locaux (les ajouts locaux passent devant) */
  function mergedMemory() {
    return { instructions: ((fileMem.instructions || '') + '\n' + instrTa.value).trim(),
      qa: dedupe(learned.qa.concat(fileMem.qa), keyQa), courses: dedupe(learned.courses.concat(fileMem.courses), keyCr) };
  }
  function applyEngine() {
    if (!engine) return { applied: 0, ignored: [] };
    var m = mergedMemory(), r = JSON.parse(engine.setInstructions(m.instructions));
    engine.setLearned(JSON.stringify({ qa: m.qa, courses: m.courses }));
    return r;
  }
  function saveInstr() {
    lsSet(K.instr, instrTa.value);
    var r = applyEngine();
    refreshAdminStatus();
    note(instrNote, '✅ ' + r.applied + ' consigne(s) appliquée(s) (site + vos ajouts).' + (r.ignored.length ? '\n⚠️ Non reconnue(s) :\n• ' + r.ignored.join('\n• ') : ''));
  }
  function persistLearned() { lsSet(K.learned, JSON.stringify(learned)); applyEngine(); renderList(); refreshAdminStatus(); }
  function addLearned() {
    if (mode === 'qa') {
      if (!qIn.value.trim() || !aIn.value.trim()) return note(learnNote, '⚠️ Remplissez la question et la réponse.');
      learned.qa.push({ q: qIn.value.trim(), a: aIn.value.trim() }); qIn.value = ''; aIn.value = '';
      note(learnNote, '✅ Appris. Testez dans l\'onglet Discuter.');
    } else {
      if (!sIn.value.trim() || !cIn.value.trim() || !tIn.value.trim()) return note(learnNote, '⚠️ Remplissez matière, chapitre et texte.');
      learned.courses.push({ s: sIn.value.trim(), c: cIn.value.trim(), t: tIn.value.trim() }); sIn.value = ''; cIn.value = ''; tIn.value = '';
      note(learnNote, '✅ Cours ajouté. Demandez-le : « cours » + matière + chapitre.');
    }
    persistLearned();
  }
  function renderList() {
    listBox.innerHTML = '';
    function row(txt, del) { listBox.appendChild(h('div', { class: 'shb-item' }, [h('span', { text: txt }), del ? h('button', { type: 'button', text: '✕', 'aria-label': 'Supprimer', onclick: del }) : null])); }
    fileMem.qa.forEach(function (x) { row('🌐 ❓ ' + x.q + ' → ' + x.a); });
    fileMem.courses.forEach(function (x) { row('🌐 🎓 ' + x.s + ' — ' + x.c); });
    learned.qa.forEach(function (x, i) { row('📱 ❓ ' + x.q + ' → ' + x.a, function () { learned.qa.splice(i, 1); persistLearned(); }); });
    learned.courses.forEach(function (x, i) { row('📱 🎓 ' + x.s + ' — ' + x.c, function () { learned.courses.splice(i, 1); persistLearned(); }); });
  }
  /* ---------- Fusion des deux onglets dans un seul fichier JSON ---------- */
  function memJSON() { return JSON.stringify(mergedMemory(), null, 1); }
  function mergeBox() {
    var st2 = h('div', { class: 'shb-note' });
    return h('div', {}, [
      h('div', { class: 'shb-note on', text: '🔗 Fusion JSON — instructions + apprentissage (fichier du site + vos ajouts) dans UN seul fichier : shaman-memoire.json. Téléchargez-le, puis remplacez-le sur GitHub (à la racine du site) : tous les visiteurs en profitent.' }),
      h('button', { class: 'shb-btn', type: 'button', text: '⬇️ Télécharger shaman-memoire.json', onclick: function () {
        var blob = new Blob([memJSON()], { type: 'application/json' });
        var a = h('a', { href: URL.createObjectURL(blob), download: 'shaman-memoire.json' }); document.body.appendChild(a); a.click(); a.remove();
        note(st2, '✅ Fichier téléchargé. Envoyez-le sur GitHub à la place de l\'ancien shaman-memoire.json.');
      } }),
      h('button', { class: 'shb-btn alt', type: 'button', text: '📋 Copier le JSON', onclick: function () {
        var txt = memJSON();
        function done() { note(st2, '✅ JSON copié. Dans GitHub : ouvrez shaman-memoire.json → ✏️ → collez à la place du contenu.'); }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { note(st2, '⚠️ Copie impossible : utilisez le téléchargement.'); });
        else { var ta = h('textarea', {}); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { note(st2, '⚠️ Copie impossible : utilisez le téléchargement.'); } ta.remove(); }
      } }),
      h('button', { class: 'shb-btn alt', type: 'button', text: 'Vider mes ajouts locaux', onclick: function () {
        if (!window.confirm('Effacer vos ajouts locaux ? (à faire après avoir mis le fichier à jour sur GitHub)')) return;
        learned = { qa: [], courses: [] }; instrTa.value = ''; lsSet(K.instr, ''); persistLearned(); note(st2, '✅ Ajouts locaux effacés.');
      } }), st2]);
  }
  function importFile() {
    var f = fileIn.files && fileIn.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result), L = d.learned || d;
        learned.qa = learned.qa.concat(L.qa || []); learned.courses = learned.courses.concat(L.courses || []);
        if (d.instructions) { instrTa.value = d.instructions; saveInstr(); }
        persistLearned(); note(learnNote, '✅ Import terminé.');
      } catch (e) { note(learnNote, '⚠️ Fichier illisible.'); }
      fileIn.value = '';
    };
    r.readAsText(f);
  }

  mountAdmin();

  /* ---------- Chargement du moteur ---------- */
  function loadScript(src) { return new Promise(function (ok) { var s = document.createElement('script'); s.src = src; s.onload = function () { ok(true); }; s.onerror = function () { ok(false); }; document.head.appendChild(s); }); }
  function getText(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' : ' + r.status); return r.text(); }); }
  function makeEngine(lex, cours) {
    if (typeof window.createShamanEngine === 'function') {
      try { var k = window.createShamanEngine(lex, cours, 0); JSON.parse(k.stats()); JSON.parse(k.reply('bonjour')); k.reset(); engineName = 'Kotlin'; return k; }
      catch (e) { console.warn('[Shaman] moteur Kotlin inutilisable, repli sur le port JS', e); }
    }
    engineName = 'JavaScript'; return window.ShamanEngineJS.create(lex, cours, 0);
  }
  Promise.all([getText(BASE + 'shaman-lexicon.json'), getText(BASE + 'shaman-cours.json'), loadScript(BASE + 'shaman-engine.js'),
    getText(BASE + 'shaman-memoire.json').catch(function () { return '{}'; })])
    .then(function (r) { return loadScript(BASE + 'shaman-engine-kotlin.js').then(function () { return r; }); })
    .then(function (r) {
      try { var fm = JSON.parse(r[3]); fileMem = { instructions: String(fm.instructions || ''), qa: fm.qa || [], courses: fm.courses || [] }; } catch (e) { console.warn('[Shaman] shaman-memoire.json illisible', e); }
      engine = makeEngine(r[0], r[1]);
      applyEngine();
      if (fileMem.instructions) note(instrFileNote, '🌐 Instructions déjà dans le fichier du site :\n' + fileMem.instructions);
      var s = JSON.parse(engine.stats());
      status.textContent = 'En ligne · répond tout de suite';
      renderList(); refreshAdminStatus();
      if (panel.classList.contains('open') && !opened) { opened = true; welcome(); }
    })
    .catch(function (e) {
      console.error('[Shaman]', e);
      status.textContent = 'Indisponible';
      addMsg('bot', 'L\'assistant n\'a pas pu démarrer (fichiers du chatbot introuvables). Vérifiez que shaman-lexicon.json, shaman-cours.json et shaman-engine.js sont bien à la racine du site.');
    });
})();
