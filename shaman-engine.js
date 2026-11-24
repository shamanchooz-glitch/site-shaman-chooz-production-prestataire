/* SHAMAN CHOOZ PRODUCTION — moteur de conversation (version JavaScript).
 * Même algorithme et même API que le moteur Kotlin (shaman-chatbot/kotlin-engine).
 * Quand le build Kotlin/JS est présent (shaman-engine-kotlin.js), le site l'utilise en priorité. */
(function (root) {
  'use strict';
  var ACC = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', PLN = 'aaaaaaceeeeiiiinooooouuuuyyoa';
  var STOP = ('le la les un une des de du et ou en au aux a ce ces cet cette ca que qui quoi dans pour par sur avec sans est es suis ' +
    'sommes etes sont etre avoir ai as avons avez ont je tu il elle on nous vous ils elles mon ma mes ton ta tes son sa ses notre ' +
    'votre vos leur leurs me te se moi toi lui y ne pas plus comment quel quelle quels quelles qu s l d j m t n c').split(' ');

  function norm(s) {
    s = String(s || '').toLowerCase();
    var o = '';
    for (var i = 0; i < s.length; i++) { var k = ACC.indexOf(s.charAt(i)); o += k >= 0 ? PLN.charAt(k) : s.charAt(i); }
    return o.replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function sig(n, min) { return n.split(' ').filter(function (w) { return w.length >= (min || 3) && STOP.indexOf(w) < 0; }); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function lowerFirst(s) { return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function has(pad, w) { return pad.indexOf(' ' + w + ' ') >= 0; }
  function anyPhrase(pad, list) { for (var i = 0; i < list.length; i++) if (has(pad, norm(list[i]))) return true; return false; }
  function lev(a, b) {
    var p = [], i, j;
    for (j = 0; j <= b.length; j++) p[j] = j;
    for (i = 1; i <= a.length; i++) {
      var prev = p[0]; p[0] = i;
      for (j = 1; j <= b.length; j++) {
        var t = p[j];
        p[j] = Math.min(p[j] + 1, p[j - 1] + 1, prev + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        prev = t;
      }
    }
    return p[b.length];
  }
  function splitSentences(t) {
    var out = [], cur = '';
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i); cur += ch;
      if ((ch === '.' || ch === '!' || ch === '?') && (i + 1 >= t.length || t.charAt(i + 1) === ' ')) {
        var nx = t.charAt(i + 2);
        if (i + 1 >= t.length || (nx && nx !== nx.toLowerCase())) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function Rng(seed) {
    var s = (seed | 0) || 123456789;
    this.next = function (n) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 1) % n; };
  }

  function Engine(lex, courses, seed) {
    var L = typeof lex === 'string' ? JSON.parse(lex) : lex;
    var C = typeof courses === 'string' ? JSON.parse(courses || '{}') : (courses || {});
    this.L = L; this.base = C; this.rng = new Rng(seed || (Date.now() & 0x7fffffff));
    this.intents = L.intents.map(function (it) { return { it: it, kw: it.kw.map(norm) }; });
    this.life = L.life || { topics: [], openers: [], bridges: [], closers: [], acks: [], fallback: L.fallback, safety: { crisis_kw: [], violence_kw: [], emergency_kw: [] } };
    this.lifeTopics = this.life.topics.map(function (t) { return { it: t, kw: t.kw.map(norm) }; });
    var sf = this.life.safety;
    this.safe = { crisis: sf.crisis_kw.map(norm), violence: sf.violence_kw.map(norm), emergency: sf.emergency_kw.map(norm) };
    this.sectors = Object.keys(L.sectors);
    this.metiers = [];
    for (var s in L.sectors) { var arr = L.sectors[s]; for (var i = 0; i < arr.length; i++) if (norm(arr[i]) !== 'autre') this.metiers.push({ m: arr[i], s: s, t: sig(norm(arr[i].replace(/\([^)]*\)/g, ' ')), 4) }); }
    this.userCourses = []; this.instr = this.emptyInstr(); this.learned = []; this.st = this.freshState();
    this.rebuild();
    /* 8 moteurs thématiques + orchestrateur (shaman-moteurs.js) : branchés en plus des intentions et de la vie courante. */
    var MJ = root.ShamanMoteursJS || (typeof module !== 'undefined' && module.exports && typeof require === 'function' ? (function () { try { return require('./shaman-moteurs.js'); } catch (e) { return null; } })() : null);
    this.moteurs = (MJ && L.moteurs) ? MJ.create(L.moteurs, { seed: seed, politesse: 'VOUVOIEMENT' }) : null;
  }
  var P = Engine.prototype;

  P.emptyInstr = function () { return { name: '', tone: '', signature: '', politesse: '', forbidden: [], rules: [], facts: [] }; };
  P.freshState = function () { return { last: null, lastLife: null, name: '', course: null, quiz: null, menu: '', recent: {}, used: {} }; };
  P.reset = function () { this.st = this.freshState(); if (this.moteurs) this.moteurs.oublier('web'); return '{"ok":true}'; };

  P.rebuild = function () {
    var map = {}, k, me0 = this;
    for (k in this.base) map[k] = this.base[k];
    for (var i = 0; i < this.userCourses.length; i++) { var u = this.userCourses[i]; map[norm(u.s) + '|' + norm(u.c)] = u.t; }
    this.entries = [];
    for (k in map) {
      var p = k.split('|'); if (p.length < 2) continue;
      this.entries.push({ subject: p[0], chapter: p[1], text: map[k], sT: sig(norm(p[0]), 4), cT: sig(norm(p[1]), 3) });
    }
    this.acc = {};
    String(this.L.accents || '').split(' ').forEach(function (p) { var kv = p.split(':'); if (kv.length === 2) me0.acc[kv[0]] = kv[1]; });
    var me = this, src = this.entries.map(function (e) { return e.text; }).join(' ') + ' ' + JSON.stringify(this.L.course);
    (src.match(/[A-Za-zÀ-ÿœ'’-]+/g) || []).forEach(function (w) {
      var lw = w.toLowerCase(), nw = norm(lw);
      if (nw !== lw && nw.length >= 5 && nw.indexOf(' ') < 0 && !me.acc[nw]) me.acc[nw] = lw;
    });
    var subs = {}; this.entries.forEach(function (e) { subs[e.subject] = 1; }); this.subjects = Object.keys(subs);
  };

  P.pick = function (key, list) {
    var rec = this.st.recent[key] || (this.st.recent[key] = []), idx = 0, tries = 0;
    do { idx = this.rng.next(list.length); tries++; } while (list.length > 4 && rec.indexOf(idx) >= 0 && tries < 12);
    rec.push(idx); if (rec.length > 3) rec.shift();
    return list[idx];
  };
  P.chance = function (pct) { return this.rng.next(100) < pct; };
  P.distinct = function (list, n) {
    var out = [], g = 0; while (out.length < n && g++ < 40) { var v = list[this.rng.next(list.length)]; if (out.indexOf(v) < 0) out.push(v); } return out;
  };
  P.fill = function (s) {
    if (s.indexOf('{') < 0) return s;
    var sc = this.distinct(this.sectors, 3), me = this.distinct(this.metiers, 2);
    return s.replace(/\{secteur\}/g, sc[0]).replace(/\{secteur2\}/g, sc[1] || sc[0]).replace(/\{secteur3\}/g, sc[2] || sc[0])
      .replace(/\{metier\}/g, me[0].m.replace(/\([^)]*\)/g, '')).replace(/\{metier2\}/g, (me[1] || me[0]).m.replace(/\([^)]*\)/g, ''));
  };
  P.out = function (text, chips, kind, intent, extra) {
    var sg = this.instr.signature;
    if (sg && kind !== 'course' && kind !== 'quiz' && kind !== 'safety') text += '\n' + sg;
    var o = { text: text, chips: chips || [], kind: kind || 'intent', intent: intent || '' };
    if (extra) for (var k in extra) o[k] = extra[k];
    else if (this.moteurs) this.moteurs.relacher('web');   // une autre partie du chatbot répond : le sujet verrouillé est libéré
    return JSON.stringify(o);
  };

  /* ---------- Les 8 moteurs thématiques (orchestrateur) ---------- */
  var AGENCE = { greeting: 1, howareyou: 1, thanks: 1, bye: 1, identity: 1, agency: 1, how: 1, candidate: 1, recruiter: 1, sectors: 1, fees: 1, validation: 1,
    tracking: 1, contact: 1, documents: 1, security: 1, cv_tips: 1, job_search: 1, training: 1, international: 1, site_features: 1 };
  /* Réponse de l'orchestrateur, ou null si le message est hors de ses 8 domaines (les autres moteurs essaient alors). */
  P.moteursReply = function (raw, recentrer) {
    var o = this.moteurs, ins = this.instr;
    o.politesseMode = ins.politesse || 'VOUVOIEMENT';
    o.tonFixe = /cool|chaleur|amical|decontract/.test(ins.tone) ? 'AMICAL' : /pro|formel|serieux/.test(ins.tone) ? 'PROFESSIONNEL' : null;
    var r = o.traiter('web', raw, { prenom: this.st.name || null, passerHorsDomaine: !recentrer });
    if (r.passe) return null;
    var kind = r.type === 'DETRESSE' ? 'safety' : r.type === 'HORS_DOMAINE' ? 'fallback' : r.type === 'CLARIFICATION' ? 'clarification' : 'moteur';
    this.st.last = null; this.st.lastLife = null;
    return this.out(r.parties.join('\n\n'), r.chips || [], kind, r.theme || (r.domaine ? r.domaine.toLowerCase() : r.type.toLowerCase()),
      { parts: r.parties, moteur: r.domaine || '', theme: r.theme || '', secondaire: r.secondaire || '', confiance: r.confiance || 0,
        sujetChange: !!r.sujetChange, donnees: !!r.donnees, debug: r.journal });
  };
  P.replyAsync = function (input) {
    var self = this, t = String(input == null ? '' : input);
    if (!this.moteurs) return Promise.resolve(this.reply(t));
    return this.moteurs.precharger('web', t).then(function () { return self.reply(t); }, function () { return self.reply(t); });
  };
  P.journal = function () { return JSON.stringify(this.moteurs ? this.moteurs.journal.slice(-80) : []); };
  P.exportConversation = function () { return JSON.stringify({ v: 1, name: this.st.name, conv: this.moteurs ? JSON.parse(this.moteurs.exporter('web')) : null }); };
  P.importConversation = function (json) {
    try { var d = JSON.parse(json); if (d.name) this.st.name = d.name; if (this.moteurs && d.conv) this.moteurs.importer('web', JSON.stringify(d.conv)); return '{"ok":true}'; } catch (e) { return '{"ok":false}'; }
  };
  P.configureLive = function (json) { try { if (this.moteurs) this.moteurs.configurerActualite(JSON.parse(json)); return '{"ok":true}'; } catch (e) { return '{"ok":false}'; } };

  /* ---------- Instructions (onglet « Ajouter des instructions ») ---------- */
  P.setInstructions = function (text) {
    var ins = this.emptyInstr(), ok = 0, ignored = [], lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim(); if (!t || t.charAt(0) === '#') continue;
      var m = /^(nom|ton|signature|interdit|info|politesse)\s*[:=]\s*(.+)$/i.exec(t);
      if (m) {
        var key = norm(m[1]), val = m[2].trim();
        if (key === 'nom') ins.name = val;
        else if (key === 'ton') ins.tone = norm(val);
        else if (key === 'signature') ins.signature = val;
        else if (key === 'politesse') ins.politesse = /^(tu|tutoi)/.test(norm(val)) ? 'TUTOIEMENT' : /^auto/.test(norm(val)) ? 'AUTO' : 'VOUVOIEMENT';
        else if (key === 'interdit') val.split(/[,;]/).forEach(function (w) { var f = norm(w); if (f) ins.forbidden.push(f); });
        else if (key === 'info') ins.facts.push({ txt: val, t: sig(norm(val), 3) });
        ok++; continue;
      }
      var r = /^si\s+(.+?)\s+alors\s+(.+)$/i.exec(t);
      if (r) {
        var kws = r[1].split(/,|;|\sou\s/i).map(norm).filter(function (x) { return x; });
        if (kws.length) { ins.rules.push({ kws: kws, answer: r[2].trim() }); ok++; continue; }
      }
      ignored.push(t);
    }
    this.instr = ins;
    return JSON.stringify({ applied: ok, ignored: ignored });
  };
  P.emojiChance = function () { var t = this.instr.tone; return t === 'cool' ? 100 : t === 'chaleureux' ? 70 : t === 'pro' || t === 'formel' ? 15 : 55; };

  /* ---------- Apprentissage (onglet « Apprendre ») ---------- */
  P.setLearned = function (json) {
    var d = {}; try { d = JSON.parse(json || '{}'); } catch (e) { }
    this.learned = (d.qa || []).map(function (x) { return { a: String(x.a || ''), t: sig(norm(x.q || ''), 3) }; }).filter(function (x) { return x.t.length && x.a; });
    this.userCourses = (d.courses || []).filter(function (x) { return x.s && x.c && x.t; });
    this.rebuild();
    return JSON.stringify({ qa: this.learned.length, courses: this.userCourses.length });
  };
  P.matchLearned = function (n) {
    var mt = sig(n, 3), best = null, bs = 0;
    for (var i = 0; i < this.learned.length; i++) {
      var q = this.learned[i], inter = 0;
      q.t.forEach(function (w) { if (mt.indexOf(w) >= 0) inter++; });
      var sc = inter / q.t.length;
      if (sc >= 0.75 && (q.t.length > 1 || mt.length <= 3) && (sc > bs || (sc === bs && best && q.t.length > best.t.length))) { best = q; bs = sc; }
    }
    return best;
  };
  P.matchFact = function (n) {
    var mt = sig(n, 3); if (!mt.length) return null;
    for (var i = 0; i < this.instr.facts.length; i++) {
      var f = this.instr.facts[i], inter = 0;
      mt.forEach(function (w) { if (f.t.indexOf(w) >= 0) inter++; });
      if (inter >= 2 && inter / mt.length >= 0.34) return f;
    }
    return null;
  };

  /* ---------- Nombre de messages possibles ---------- */
  P.combinations = function () {
    var b = this.L.banks, E = b.emojis.length + 1, tot = 0;
    this.L.intents.forEach(function (it) {
      var c = it.core.length, d = it.detail.length, t = it.tip.length;
      tot += it.light ? c * d * t * E : b.openers.length * c * b.bridges.length * d * t * b.closers.length * E;
    });
    return tot;
  };
  P.lifeCombinations = function () {
    var lf = this.life, E = this.L.banks.emojis.length + 1, tot = 0;
    lf.topics.forEach(function (t) {
      var c = t.core.length, d = t.detail.length, tp = t.tip.length, a = t.ask.length;
      tot += t.light ? c * d * tp * E : lf.openers.length * c * lf.bridges.length * d * tp * a * lf.closers.length * E;
    });
    return tot;
  };
  P.stats = function () {
    return JSON.stringify({ engine: 'js', combinations: this.combinations(), lifeCombinations: this.lifeCombinations(), lifeTopics: this.life.topics.length, intents: this.L.intents.length, chapters: this.entries.length,
      subjects: this.subjects.length, learnedQa: this.learned.length, learnedCourses: this.userCourses.length,
      moteurs: this.moteurs ? this.moteurs.stats() : null });
  };

  /* ---------- Réponse principale ---------- */
  P.reply = function (input) {
    var L = this.L, st = this.st, raw = String(input == null ? '' : input).trim().slice(0, 600);
    if (!raw) return this.out("Je vous écoute. Posez votre question sur l'emploi, le recrutement, ou demandez un cours.", L.fallback_chips, 'fallback');
    var n = norm(raw), pad = ' ' + n + ' ', toks = n.split(' ');
    var sfr = this.safety(pad); if (sfr) return sfr;

    var nm = /(?:je m['’ ]appelle|mon nom est|moi c['’]est|mon pr[ée]nom est)\s+([A-Za-zÀ-ÿ-]{2,20})/i.exec(raw);
    if (nm) {
      st.name = cap(nm[1].toLowerCase());
      if (toks.length <= 6) return this.out('Enchanté, ' + st.name + " ! Êtes-vous candidat(e) ou recruteur ? Je vous guide selon votre besoin.", L.intents[0].chips, 'intent', 'greeting');
    }
    if (st.quiz) { if (toks.length <= 4 && raw.indexOf('?') < 0) { var q = this.quizStep(n, toks); if (q) return q; } else st.quiz = null; }
    for (var i = 0; i < this.instr.forbidden.length; i++)
      if (has(pad, this.instr.forbidden[i])) return this.out(this.pick('refuse', L.refuse), L.fallback_chips, 'refuse');
    for (i = 0; i < this.instr.rules.length; i++)
      for (var k = 0; k < this.instr.rules[i].kws.length; k++)
        if (has(pad, this.instr.rules[i].kws[k])) return this.out(this.instr.rules[i].answer, [], 'rule');
    var lq = this.matchLearned(n); if (lq) return this.out(lq.a, [], 'learned');
    var fc = this.matchFact(n); if (fc) return this.out("Voici l'information de l'agence : " + fc.txt, [], 'rule');
    var cr = this.courseTurn(n, pad, toks); if (cr) return cr;
    if (this.moteurs) {
      var pre = this.score(pad, toks);
      var agence = pre && AGENCE[pre.def.id] && (pre.score >= 4 || (pre.def.light && pre.score >= 2) ||
        (pre.score >= 2 && [null, 'RECRUTEMENT'].indexOf(this.moteurs.apercu('web', raw).principal) >= 0));   // les réponses curatées de l'agence priment sur le moteur Recrutement générique
      if (!agence) {
        if (!pre || pre.score < 4) { var sr0 = this.sectorTurn(n, toks); if (sr0) return sr0; }
        var mr = this.moteursReply(raw, false); if (mr) return mr;
      }
    }
    var fu = this.followUp(n, toks); if (fu) return fu;

    var best = this.score(pad, toks);
    if (!best || best.score < 4) { var sr = this.sectorTurn(n, toks); if (sr) return sr; }
    var lb = this.lifeScore(pad, toks), cs = best ? best.score : 0, ls = lb ? lb.score : 0;
    if (lb && ls >= 2 && ls > cs && cs < 4) return this.composeLife(lb.def);
    if (best && cs >= 2) return this.compose(best.def);
    if (lb && ls >= 2) return this.composeLife(lb.def);
    if (st.lastLife && toks.length <= 12) { var lc = this.lifeMore(st.lastLife, true); if (lc) return lc; }
    if (this.moteurs) { var rc = this.moteursReply(raw, true); if (rc) return rc; }
    return this.out(this.pick('lfb', this.life.fallback), L.fallback_chips, 'fallback');
  };

  /* ---------- Sécurité (urgences, détresse) : prioritaire sur tout le reste ---------- */
  P.safety = function (pad) {
    var sf = this.life.safety, s = this.safe, i;
    for (i = 0; i < s.crisis.length; i++) if (has(pad, s.crisis[i])) return this.out(sf.crisis_txt, [], 'safety', 'crisis');
    for (i = 0; i < s.violence.length; i++) if (has(pad, s.violence[i])) return this.out(sf.violence_txt, [], 'safety', 'violence');
    for (i = 0; i < s.emergency.length; i++) if (has(pad, s.emergency[i])) return this.out(sf.emergency_txt, [], 'safety', 'emergency');
    return null;
  };

  /* ---------- Moteur « vie courante » ---------- */
  P.lifeScore = function (pad, toks) {
    var best = null;
    for (var i = 0; i < this.lifeTopics.length; i++) {
      var d = this.lifeTopics[i], sc = this.kwScore(d.kw, pad, toks);
      if (sc > 0 && (!best || sc > best.score)) best = { def: d.it, score: sc };
    }
    return best;
  };
  P.composeLife = function (t) {
    var lf = this.life, st = this.st;
    if (t.id === 'datetime') return this.dateTime(t);
    var core = this.pick('lc' + t.id, t.core), detail = this.pick('ld' + t.id, t.detail), tip = this.pick('lt' + t.id, t.tip);
    var emo = this.chance(this.emojiChance()) ? ' ' + this.pick('emo', this.L.banks.emojis) : '', text;
    if (t.light) text = core + ' ' + detail + '\n\n' + tip + emo;
    else {
      var op = this.pick('lop', lf.openers);
      if (st.name && this.chance(30)) op = st.name + ', ' + lowerFirst(op);
      text = op + ' ' + core + '\n\n' + this.pick('lbr', lf.bridges) + ' ' + detail + ' ' + tip + '\n\n' + this.pick('la' + t.id, t.ask) + ' ' + this.pick('lcl', lf.closers) + emo;
    }
    if (t.note) text += '\n\nℹ️ ' + t.note;
    st.last = t.id; st.lastLife = t.id; st.used[t.id] = [];
    return this.out(text, t.chips, 'life', t.id);
  };
  P.lifeTopic = function (id) { for (var i = 0; i < this.life.topics.length; i++) if (this.life.topics[i].id === id) return this.life.topics[i]; return null; };
  P.lifeMore = function (id, ack) {
    var t = this.lifeTopic(id); if (!t || t.light || t.id === 'datetime') return null;
    var lf = this.life, used = this.st.used[id] || (this.st.used[id] = []), idx = 0, g = 0;
    do { idx = this.rng.next(t.detail.length); g++; } while (used.indexOf(idx) >= 0 && used.length < t.detail.length && g < 20);
    used.push(idx);
    this.st.lastLife = id; this.st.last = id;
    if (ack) return this.out(this.pick('lak', lf.acks) + ' ' + this.pick('la' + id, t.ask) + ' ' + this.pick('lcl', lf.closers), t.chips, 'life', id);
    return this.out(this.pick('lbr', lf.bridges) + ' ' + t.detail[idx] + ' ' + this.pick('lt' + id, t.tip) + '\n\n' + this.pick('la' + id, t.ask) + ' ' + this.pick('lcl', lf.closers), t.chips, 'life', id);
  };
  P.dateTime = function (t) {
    var d = new Date(), lf = this.life, h = d.getHours(), m = d.getMinutes(), day = d.getDate();
    var txt = 'Il est ' + h + ' h ' + (m < 10 ? '0' : '') + m + ", d'après l'horloge de votre appareil.\nNous sommes le " + lf.days[d.getDay()] + ' ' + (day === 1 ? '1er' : day) + ' ' + lf.months[d.getMonth()] + ' ' + d.getFullYear() + '.';
    this.st.last = t.id;
    return this.out(txt, t.chips, 'life', t.id);
  };

  P.kwScore = function (kws, pad, toks) {
    var sc = 0;
    for (var j = 0; j < kws.length; j++) {
      var kw = kws[j];
      if (kw.indexOf(' ') >= 0) { if (has(pad, kw)) sc += 2 * kw.split(' ').length; }
      else if (toks.indexOf(kw) >= 0) sc += 2;
      else if (kw.length >= 5 && toks.some(function (t) { return t.length > kw.length && t.indexOf(kw) === 0; })) sc += 1.5;
    }
    return sc;
  };
  P.score = function (pad, toks) {
    var best = null;
    for (var i = 0; i < this.intents.length; i++) {
      var d = this.intents[i], sc = this.kwScore(d.kw, pad, toks);
      if (sc > 0 && (!best || sc > best.score)) best = { def: d.it, score: sc };
    }
    return best;
  };

  P.compose = function (it) {
    var b = this.L.banks, id = it.id, st = this.st;
    var core = this.fill(this.pick('c' + id, it.core)), detail = this.fill(this.pick('d' + id, it.detail)), tip = this.fill(this.pick('t' + id, it.tip));
    var emo = this.chance(this.emojiChance()) ? ' ' + this.pick('emo', b.emojis) : '';
    var text;
    if (it.light) text = core + ' ' + detail + '\n\n' + tip + emo;
    else {
      var op = this.pick('op', b.openers);
      if (st.name && this.chance(40)) op = st.name + ', ' + lowerFirst(op);
      if (id === 'identity' && this.instr.name) core = "Je m'appelle " + this.instr.name + '. ' + core;
      text = op + ' ' + core + '\n\n' + this.pick('br', b.bridges) + ' ' + detail + ' ' + tip + '\n\n' + this.pick('cl', b.closers) + emo;
    }
    st.last = id; st.lastLife = null; st.used[id] = [];
    return this.out(text, it.chips, 'intent', id);
  };

  P.followUp = function (n, toks) {
    var L = this.L, st = this.st, pad = ' ' + n + ' ';
    if (toks.length <= 3 && anyPhrase(pad, L.no) && L.no.some(function (w) { return toks[0] === norm(w).split(' ')[0]; }))
      return this.out("Très bien. Je reste disponible : posez-moi une question sur l'emploi, le recrutement ou demandez un cours.", L.fallback_chips, 'intent');
    if (toks.length <= 3 && L.yes.some(function (w) { return toks[0] === norm(w).split(' ')[0]; })) {
      var lm = st.lastLife ? this.lifeMore(st.lastLife, false) : null; if (lm) return lm;
      var it = null;
      for (var i = 0; i < L.intents.length; i++) if (L.intents[i].id === st.last) it = L.intents[i];
      if (!it || it.light) return this.out("Avec plaisir. Sur quel sujet souhaitez-vous des détails : l'inscription, les offres, les frais, un conseil ou un cours ?", L.fallback_chips, 'intent');
      var used = st.used[it.id] || (st.used[it.id] = []), idx = -1, g = 0;
      do { idx = this.rng.next(it.detail.length); g++; } while (used.indexOf(idx) >= 0 && used.length < it.detail.length && g < 20);
      used.push(idx);
      var tp = this.pick('t' + it.id, it.tip), b = L.banks;
      return this.out(this.pick('br', b.bridges) + ' ' + this.fill(it.detail[idx]) + ' ' + this.fill(tp) + '\n\n' + this.pick('cl', b.closers), it.chips, 'intent', it.id);
    }
    return null;
  };

  /* ---------- Secteurs & métiers ---------- */
  P.sectorTurn = function (n, toks) {
    var L = this.L, cue = ['metier', 'metiers', 'secteur', 'secteurs', 'poste', 'postes', 'emploi', 'emplois', 'travail', 'travailler', 'job', 'domaine', 'cherche', 'liste', 'exemple', 'exemples', 'quels'];
    var hasCue = toks.some(function (t) { return cue.indexOf(t) >= 0; }), i, j;
    for (i = 0; i < this.sectors.length; i++) {
      var s = this.sectors[i], st2 = sig(norm(s), 4), hit = 0, big = false;
      for (j = 0; j < st2.length; j++) if (toks.indexOf(st2[j]) >= 0) { hit++; if (st2[j].length >= 5) big = true; }
      if (!hit || !big) continue;
      var ratio = hit / st2.length;
      if ((ratio === 1 && toks.length <= st2.length + 3) || (ratio >= 0.5 && hasCue)) {
        var list = L.sectors[s], pickList = this.distinct(list, Math.min(6, list.length)).map(function (x) { return x.replace(/\([^)]*\)/g, ''); });
        var txt = this.pick('sct', L.sector_tpl).replace('{secteur}', s).replace('{n}', String(list.length)).replace('{liste}', pickList.join(', ')) + ' ' + this.pick('scl', L.sector_tail);
        this.st.last = 'sectors'; this.st.lastLife = null;
        return this.out(txt, L.sector_chips, 'intent', 'sectors');
      }
    }
    var bm = null;
    for (i = 0; i < this.metiers.length; i++) {
      var m = this.metiers[i]; if (!m.t.length) continue;
      var all = m.t.every(function (w) { return toks.indexOf(w) >= 0; });
      if (all && (toks.length <= m.t.length + 3 || hasCue) && (!bm || m.t.length > bm.t.length)) bm = m;
    }
    if (bm) {
      this.st.last = 'sectors';
      return this.out(this.pick('mtp', L.metier_tpl).replace('{metier}', bm.m.replace(/\([^)]*\)/g, '')).replace('{secteur}', bm.s) + ' ' + this.pick('scl', L.sector_tail), L.sector_chips, 'intent', 'sectors');
    }
    return null;
  };

  /* ---------- Cours universitaires ---------- */
  P.disp = function (s) {
    var am = this.acc || {};
    return cap(s.split(' ').map(function (w) { return am[w] || w; }).join(' '));
  };
  P.findCourse = function (n, toks, cue) {
    var cands = [], i, me = this;
    function inT(w) { return toks.some(function (t) { return t === w || (w.length >= 5 && t.length >= 5 && (t.indexOf(w) === 0 || w.indexOf(t) === 0)); }); }
    for (i = 0; i < this.entries.length; i++) {
      var e = this.entries[i], sM = e.sT.length > 0 && e.sT.every(inT), cM = e.cT.length > 0 && e.cT.every(inT);
      if (sM || cM) cands.push({ e: e, sM: sM, cM: cM });
    }
    if (!cands.length) return null;
    var both = cands.filter(function (c) { return c.sM && c.cM; }).sort(function (x, y) { return (y.e.sT.length + y.e.cT.length) - (x.e.sT.length + x.e.cT.length); });
    if (both.length) return { kind: 'chapter', entry: both[0].e };
    var bS = 0, bC = 0;
    cands.forEach(function (c) { if (c.sM && c.e.sT.length > bS) bS = c.e.sT.length; if (c.cM && c.e.cT.length > bC) bC = c.e.cT.length; });
    if (bS > bC) cands = cands.filter(function (c) { return c.sM; });
    var chap = cands.filter(function (c) { return c.cM; });
    if (chap.length && cue) {
      var ctx = this.st.menu || (this.st.course ? this.st.course.entry.subject : '');
      var inCtx = chap.filter(function (c) { return c.e.subject === ctx; });
      if (inCtx.length) return { kind: 'chapter', entry: inCtx[0].e };
      if (chap.length === 1) return { kind: 'chapter', entry: chap[0].e };
      return { kind: 'ambiguous', list: chap.map(function (c) { return c.e; }) };
    }
    var subs = cands.filter(function (c) { return c.sM; }).sort(function (x, y) { return y.e.sT.length - x.e.sT.length; });
    if (subs.length) {
      var sub = subs[0].e.subject, sl = sig(norm(sub), 4).length;
      if (cue || toks.length <= sl + 1) return { kind: 'subject', subject: sub };
    }
    return null;
  };

  P.courseTurn = function (n, pad, toks) {
    var L = this.L, st = this.st;
    var strong = anyPhrase(pad, L.course_words), soft = anyPhrase(pad, L.soft_words), cue = strong || soft;
    if (st.course) {
      var yes = toks.length <= 3 && L.yes.some(function (w) { return toks[0] === norm(w).split(' ')[0]; });
      if (yes || (toks.length <= 3 && anyPhrase(pad, L.next_words))) return this.nextSection();
      if (anyPhrase(pad, L.quiz_words)) return this.gotoSection('quiz');
      if (has(pad, 'exercice') || has(pad, 'exercices')) return this.gotoSection('exercice');
      if (has(pad, 'resume') || has(pad, 'synthese') || has(pad, 'bilan')) return this.gotoSection('synthese');
      if (has(pad, 'complet') || pad.indexOf(' en entier ') >= 0) return this.fullCourse();
      if (has(pad, 'stop') || has(pad, 'arrete') || has(pad, 'quitter') || has(pad, 'terminer')) {
        st.course = null; return this.out("Très bien, nous arrêtons le cours ici. Vous pouvez en reprendre un autre quand vous voulez.", ['Un cours', 'Comment ça marche ?'], 'course');
      }
      if (pad.indexOf(' chapitres ') >= 0 && (has(pad, 'autres') || has(pad, 'autre'))) return this.subjectMenu(st.course.entry.subject);
    }
    var m = this.findCourse(n, toks, cue);
    if (m) {
      if (m.kind === 'chapter') return this.startChapter(m.entry);
      if (m.kind === 'subject') return this.subjectMenu(m.subject);
      var me = this;
      return this.out('Plusieurs matières proposent ce chapitre. Laquelle choisissez-vous ?', m.list.slice(0, 6).map(function (e) { return 'Cours ' + me.disp(e.subject) + ' ' + me.disp(e.chapter); }), 'course');
    }
    if (strong) return this.coursesMenu();
    return null;
  };

  P.coursesMenu = function () {
    var me = this, ch = this.distinct(this.subjects, 6).map(function (s) { return 'Cours ' + me.disp(s); });
    this.st.menu = '';
    return this.out('📚 Je peux vous donner des cours détaillés : ' + this.entries.length + ' chapitres dans ' + this.subjects.length +
      ' matières (droit, gestion, médecine, ingénierie, lettres, sciences, arts, agriculture…).\n\nDites par exemple « cours de comptabilité » ou « cours droit du travail dérivation ». Voici quelques idées :', ch, 'course');
  };
  P.subjectMenu = function (subject) {
    var me = this, list = this.entries.filter(function (e) { return e.subject === subject; });
    this.st.menu = subject; this.st.course = null;
    var lines = list.map(function (e, i) { return (i + 1) + '. ' + me.disp(e.chapter); }).join('\n');
    return this.out('📚 ' + this.disp(subject) + ' — chapitres disponibles :\n' + lines + '\n\nChoisissez un chapitre pour démarrer le cours.', list.map(function (e) { return 'Cours : ' + me.disp(e.chapter); }), 'course');
  };

  P.buildSections = function (e) {
    var C = this.L.course, me = this, mat = this.disp(e.subject), chap = this.disp(e.chapter), ss = splitSentences(e.text);
    function f(s) { return s.replace(/\{matiere\}/g, mat).replace(/\{chap\}/g, chap); }
    var def = ss[0] || e.text, ex = ss.filter(function (s) { return /^exemple/i.test(s); }), tools = ss.filter(function (s) { return /^(outils|m[ée]thode|principe)/i.test(s); });
    var others = ss.filter(function (s) { return s !== def && ex.indexOf(s) < 0 && tools.indexOf(s) < 0; });
    var disc = ''; var ns = norm(e.subject);
    C.disclaimers.forEach(function (d) { if (!disc && d.re.some(function (r) { return ns.indexOf(r) >= 0; })) disc = '\n\n' + d.txt; });
    var secs = [];
    secs.push({ t: 'Introduction', x: '📘 ' + mat + ' — ' + chap + '\n' + f(this.pick('ci', C.intro)) + '\n\n🎯 ' + f(this.pick('co', C.objectifs)) + disc });
    secs.push({ t: 'Notions clés', x: '📖 Notions clés\n• Définition : ' + def + others.slice(0, 6).map(function (s) { return '\n• ' + s; }).join('') });
    secs.push({ t: 'Exemple', x: ex[0] ? '💡 Exemple concret\n' + ex[0] + '\n\nÀ vous : refaites cet exemple avec vos propres données, puis modifiez une valeur et observez ce qui change.' : '💡 À illustrer\nCe chapitre ne contient pas d\'exemple chiffré. Imaginez une situation réelle de votre quotidien ou de votre métier où cette notion s\'applique, puis décrivez-la en deux phrases.\n\nNotion à illustrer : ' + def });
    secs.push({ t: 'Méthode', x: '🛠️ Méthode et outils\n' + (tools.length ? tools.join(' ') : "Méthode générale : 1) définir précisément le problème, 2) choisir l'outil adapté, 3) appliquer pas à pas, 4) vérifier le résultat.") });
    secs.push({ t: 'Pièges', x: '⚠️ Pièges à éviter\n' + f(this.pick('cp', C.pitfalls)) + '\n' + f(this.pick('cp', C.pitfalls)) });
    secs.push({ t: 'Exercice', x: '✍️ Exercice\n' + f(this.pick('ce', C.exercice)) });
    var qs = this.makeQuiz(e.text);
    if (qs.length) secs.push({ t: 'Quiz', x: '', quiz: qs });
    secs.push({ t: 'Synthèse', x: '🧾 Synthèse\n' + f(this.pick('cs', C.synthese)) + '\n\n' + f(this.pick('cg', C.plus_loin)) });
    return secs;
  };
  P.makeQuiz = function (text) {
    var qs = [], ss = splitSentences(text), bad = ['quelque', 'plusieurs', 'souvent', 'toujours', 'pendant', 'chaque', 'depuis', 'ensemble', 'quelques', 'exemple', 'outils', 'lorsque', 'comme', 'entre'];
    for (var i = 0; i < ss.length && qs.length < 3; i++) {
      var s = ss[i]; if (s.length < 50 || /^exemple/i.test(s)) continue;
      var words = s.split(/[\s,;:()«»]+/), tgt = '';
      words.forEach(function (w) { var wn = norm(w); if (/^[A-Za-zÀ-ÿ-]+$/.test(w) && wn.length >= 7 && bad.indexOf(wn) < 0 && wn.length > norm(tgt).length) tgt = w; });
      if (!tgt) continue;
      qs.push({ q: s.replace(tgt, '_____'), a: norm(tgt), raw: tgt });
    }
    return qs;
  };
  P.secOut = function (c, i, extra) {
    var s = c.sections[i], txt = s.x, chips = ['Suite ▶', 'Quiz', 'Autres chapitres'];
    if (s.quiz) { this.st.quiz = { qs: s.quiz, i: 0, score: 0 }; txt = '🧠 Quiz — 1/' + s.quiz.length + '\nComplétez le mot manquant :\n' + s.quiz[0].q; chips = ['Passer le quiz']; }
    return this.out('[' + (i + 1) + '/' + c.sections.length + '] ' + txt + (extra || ''), chips, 'course');
  };
  P.startChapter = function (e) {
    var c = { entry: e, sections: this.buildSections(e), i: 0 };
    this.st.course = c; this.st.menu = e.subject; this.st.last = 'course'; this.st.lastLife = null;
    return this.secOut(c, 0);
  };
  P.nextSection = function () {
    var c = this.st.course; if (!c) return this.coursesMenu();
    if (c.i + 1 < c.sections.length) { c.i++; return this.secOut(c, c.i); }
    var list = this.entries.filter(function (e) { return e.subject === c.entry.subject; }), me = this, pos = -1;
    list.forEach(function (e, i) { if (e === c.entry) pos = i; });
    var chips = [];
    if (pos >= 0 && pos + 1 < list.length) chips.push('Cours : ' + this.disp(list[pos + 1].chapter));
    chips.push('Autres chapitres', 'Un cours');
    this.st.course = null;
    return this.out('🎓 Chapitre « ' + this.disp(c.entry.chapter) + ' » terminé. Bravo ! Pour fixer les acquis, refaites l\'exercice demain sans notes.' +
      (chips[0].indexOf('Cours :') === 0 ? '\n\nSouhaitez-vous poursuivre avec le chapitre suivant ?' : ''), chips, 'course');
  };
  P.gotoSection = function (name) {
    var c = this.st.course; if (!c) return null;
    for (var i = 0; i < c.sections.length; i++) if (norm(c.sections[i].t) === name || (name === 'quiz' && c.sections[i].quiz) || (name === 'synthese' && c.sections[i].t === 'Synthèse')) { c.i = i; return this.secOut(c, i); }
    return this.out("Il n'y a pas de quiz pour ce chapitre. Tapez « suite » pour continuer.", ['Suite ▶'], 'course');
  };
  P.fullCourse = function () {
    var c = this.st.course; if (!c) return null;
    var txt = c.sections.filter(function (s) { return !s.quiz; }).map(function (s) { return s.x; }).join('\n\n');
    c.i = c.sections.length - 1;
    return this.out(txt, ['Quiz', 'Autres chapitres', 'Un cours'], 'course');
  };
  P.quizStep = function (n, toks) {
    var qz = this.st.quiz, c = this.st.course;
    if (toks.length <= 3 && (n === 'passer le quiz' || n === 'passer' || n === 'stop' || n === 'arrete' || n === 'suite')) { this.st.quiz = null; return this.nextSection(); }
    var cur = qz.qs[qz.i], ans = cur.a, ok = n === ans || toks.indexOf(ans) >= 0 || (ans.length >= 6 && toks.some(function (t) { return lev(t, ans) <= 1; }));
    if (ok) qz.score++;
    var fb = ok ? '✅ Exact !' : '❌ Pas tout à fait. Réponse attendue : « ' + cur.raw + ' ».';
    qz.i++;
    if (qz.i < qz.qs.length) return this.out(fb + '\n\n🧠 Quiz — ' + (qz.i + 1) + '/' + qz.qs.length + '\nComplétez le mot manquant :\n' + qz.qs[qz.i].q, ['Passer le quiz'], 'quiz');
    this.st.quiz = null;
    return this.out(fb + '\n\n🏁 Score : ' + qz.score + '/' + qz.qs.length + (qz.score === qz.qs.length ? ' — parfait !' : ' — relisez la section « Notions clés » puis retentez le quiz.'), ['Suite ▶', 'Quiz', 'Autres chapitres'], 'quiz');
  };

  root.ShamanEngineJS = { create: function (lex, courses, seed) {
    var e = new Engine(lex, courses, seed);
    return { reply: function (t) { return e.reply(t); }, setInstructions: function (t) { return e.setInstructions(t); },
      setLearned: function (j) { return e.setLearned(j); }, stats: function () { return e.stats(); }, reset: function () { return e.reset(); },
      replyAsync: function (t) { return e.replyAsync(t); }, journal: function () { return e.journal(); }, exportConversation: function () { return e.exportConversation(); },
      importConversation: function (j) { return e.importConversation(j); }, configureLive: function (j) { return e.configureLive(j); } };
  } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ShamanEngineJS;
})(typeof window !== 'undefined' ? window : globalThis);
