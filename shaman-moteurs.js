/* SHAMAN CHOOZ PRODUCTION — les 8 moteurs thématiques + orchestrateur (version JavaScript).
 * Même algorithme que src/jsMain/kotlin/shaman/moteurs/*.kt ; données dans shaman-lexicon.json (clé « moteurs »).
 * Sert de repli quand le build Kotlin/JS n'est pas actif, et de référence testable (voir test-moteurs.cjs).
 * Usage : ShamanMoteursJS.create(lexique.moteurs, { seed, fetch, now, politesse, ton, numerosUrgence }). */
(function (root) {
  'use strict';
  var ACC = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', PLN = 'aaaaaaceeeeiiiinooooouuuuyyoa';
  var LIMITE = 160, MAX_PARTIES = 3;
  var BLOCS = ['OUVERTURE', 'EMPATHIE', 'INFORMATION', 'CONSEIL', 'ACTION', 'ENCOURAGEMENT', 'QUESTION', 'CLOTURE'];
  var SACRIFICE = ['CLOTURE', 'OUVERTURE', 'ENCOURAGEMENT', 'INFORMATION', 'EMPATHIE', 'ACTION', 'QUESTION'];
  var NEGATIVES = { TRISTE: 1, ANXIEUX: 1, COLERE: 1, DETRESSE: 1 };
  var SEUIL_MIN = 0.35, SEUIL_SECOND = 0.45, MARGE_CHANGEMENT = 0.15, POIDS_DOMAINE = 0.7;
  var OUTILS = ('le la les un une des du de d l au aux et ou mais donc or ni car que qu quoi qui quel quelle quels quelles ce cet cette ces se sa son ses mon ma mes ton ta tes notre nos votre vos leur leurs je j tu il elle on nous vous ils elles me m te t lui y en a ai as avons avez ont suis es est sommes etes sont etait ete etre avoir fait faire pas ne n plus tres trop bien mal tout tous toute toutes si oui non ok sur sous dans par pour avec sans chez vers entre comme alors ainsi aussi encore deja jamais toujours peu beaucoup ca cela ceci voila c s comment pourquoi quand veux voudrais peux pouvez puis dois faut faudrait bonjour bonsoir salut merci svp aide aider besoin question probleme chose choses demain aujourd hui ce cette soir matin semaine').split(' ');

  /* ---------- Texte ---------- */
  function norm(s) {
    s = String(s || '').toLowerCase();
    var o = '';
    for (var i = 0; i < s.length; i++) { var k = ACC.indexOf(s.charAt(i)); o += k >= 0 ? PLN.charAt(k) : s.charAt(i); }
    return o.replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function csv(s) { return String(s || '').split(',').map(norm).filter(function (x) { return x; }); }
  function tokens(msg) {
    var out = [], re = /[A-Za-z0-9\u00C0-\u024F]+/g, m;
    while ((m = re.exec(String(msg || '')))) { var n = norm(m[0]); if (n) out.push({ raw: m[0].toLowerCase(), norm: n, orig: m[0] }); }
    return out;
  }
  function chercher(mots, toks, texte) {
    var t = ' ' + texte, res = [], i, j;
    for (i = 0; i < mots.length; i++) {
      var w = mots[i];
      if (w.indexOf(' ') >= 0) { if (t.indexOf(' ' + w) >= 0) res.push({ kw: w, p: 1.5, tok: null, pos: -1 }); }
      else {
        for (j = 0; j < toks.length; j++) {
          var tn = toks[j].norm;
          if (w.length <= 3 ? tn === w : tn.indexOf(w) === 0) { res.push({ kw: w, p: 1, tok: toks[j], pos: j }); break; }
        }
      }
    }
    return res;
  }
  function elementSignificatif(toks) {
    var best = null;
    toks.forEach(function (t) { if (t.norm.length >= 4 && OUTILS.indexOf(t.norm) < 0 && (!best || t.norm.length > best.norm.length)) best = t; });
    return best ? best.raw : null;
  }
  function minuscule(s) { return (s.length > 1 && /[A-ZÀ-Ý]/.test(s.charAt(0)) && /[a-zà-ÿ]/.test(s.charAt(1))) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function majuscule(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function nettoyerSms(t) {
    return t.replace(/[’‘]/g, "'").replace(/[«»“”]/g, '"').replace(/…/g, '...').replace(/[–—]/g, '-').replace(/[\u00A0\u202F]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function decouper(texte, limite, max) {
    var parts = [], mots = texte.trim().split(' ').filter(function (x) { return x; });
    mots.forEach(function (m) {
      if (m.length > limite) m = m.slice(0, limite);
      var c = parts[parts.length - 1];
      if (c !== undefined && c.length + 1 + m.length <= limite) parts[parts.length - 1] = c + ' ' + m; else parts.push(m);
    });
    return parts.slice(0, max);
  }

  /* ---------- Gabarits : {prenom} {sujet} {element} <tu|vous> [amical|pro|rassurant] ---------- */
  var POL = /<([^<>|]*)\|([^<>|]*)>/g, TON = /\[([^\[\]|]*)\|([^\[\]|]*)\|([^\[\]|]*)\]/g;
  function rendre(modele, prenom, sujet, element, ton, pol, extra, nomaj) {
    var t = modele.split('{sujet}').join(sujet).split('{element}').join(element);
    if (extra) for (var k in extra) t = t.split('{' + k + '}').join(extra[k]);
    if (prenom) t = t.split('{prenom}').join(prenom);
    else {
      if (t.indexOf('{prenom}, ') === 0) t = t.slice(10);
      t = t.split(', {prenom}').join('').split(' {prenom}').join('').split('{prenom}').join('');
    }
    t = t.replace(POL, function (m, a, b) { return pol === 'TUTOIEMENT' ? a : b; });
    var ix = ton === 'AMICAL' ? 1 : ton === 'PROFESSIONNEL' ? 2 : 3;
    t = t.replace(TON, function (m) { return arguments[ix]; });
    t = t.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
    t = nettoyerSms(t);
    return nomaj ? t : majuscule(t);
  }
  function marqueur(t) { return /[{}<>\[\]|]/.test(t); }

  /* ---------- Hasard ---------- */
  function Rng(seed) {
    var s = (seed | 0) || 123456789;
    this.next = function (n) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 1) % n; };
    this.dbl = function () { return this.next(1000000) / 1000000; };
  }

  /* ---------- Un moteur thématique (travail, perso, famille, couple, social, finance, recrutement) ---------- */
  function Moteur(dom, rng) {
    this.id = dom.id; this.de = dom.de; this.court = dom.court; this.rng = rng; this.blocs = dom.blocs;
    this.motsDomaine = csv(dom.mots);
    this.themes = dom.themes.map(function (t) {
      return { id: t.id, libelle: t.libelle, mots: csv(t.mots), conseils: t.conseils || [], actions: t.actions || [] };
    });
  }
  Moteur.prototype.nombreCombinaisons = function () {
    var self = this; return BLOCS.reduce(function (a, b) { return a * self.blocs[b].length; }, 1);
  };
  /* Confiance = 1 - 0,5^points ; mot-clé 1 point, expression 1,5, mot général du domaine 0,7 (x poids). */
  Moteur.prototype.evaluer = function (toks, texte, themeVerrouille) {
    var vus = {}, corr = [], meilleur = null, ms = 0, self = this;
    this.themes.forEach(function (t) {
      var c = chercher(t.mots, toks, texte), sc = 0;
      c.forEach(function (x) { sc += x.p; if (!vus[x.kw]) { vus[x.kw] = 1; corr.push(x); } });
      if (sc > ms) { ms = sc; meilleur = t; }
    });
    chercher(this.motsDomaine, toks, texte).forEach(function (x) {
      if (!vus[x.kw]) { vus[x.kw] = 1; corr.push({ kw: x.kw, p: x.p * POIDS_DOMAINE, tok: x.tok, pos: x.pos }); }
    });
    var pts = 0; corr.forEach(function (x) { pts += x.p; });
    var theme = (meilleur && (!themeVerrouille || ms >= 1)) ? meilleur.id : (themeVerrouille || null);
    var elements = corr.filter(function (x) { return x.tok; }).sort(function (a, b) { return a.pos - b.pos; })
      .map(function (x) { return x.tok.raw; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 3);
    return { domaine: self.id, theme: theme, confiance: 1 - Math.pow(0.5, pts), elements: elements };
  };
  Moteur.prototype.detecter = function (msg, ctx) {
    return this.evaluer(tokens(msg), norm(msg), ctx && ctx.theme);
  };
  Moteur.prototype.themeDe = function (id) {
    for (var i = 0; i < this.themes.length; i++) if (this.themes[i].id === id) return this.themes[i];
    return null;
  };
  Moteur.prototype.recents = function (ctx, bloc, n) {
    var out = {}; (ctx.historique || []).slice(-n).forEach(function (e) { var v = e.variantes && e.variantes[bloc]; if (v) out[v] = 1; });
    return out;
  };
  Moteur.prototype.sujetRendu = function (theme, ctx) {
    return rendre(theme ? theme.libelle : '<ta|votre> situation', null, '', '', ctx.profil.ton, ctx.profil.politesse, null, true);
  };
  Moteur.prototype.elementRendu = function (ctx, sujet) {
    if (ctx.elements && ctx.elements.length) return ctx.elements[0];
    var h = ctx.historique || [];
    for (var i = h.length - 1; i >= 0; i--) if (h[i].elements && h[i].elements.length) return h[i].elements[0];
    return sujet;
  };
  Moteur.prototype.choisir = function (type, theme, ctx, restant, prenom, sujet, element) {
    var self = this, spe = (type === 'CONSEIL' && theme ? theme.conseils : type === 'ACTION' && theme ? theme.actions : []) || [];
    var gen = this.blocs[type];
    function cands(modeles, ecart) {
      var out = [];
      modeles.forEach(function (m) {
        if (ecart[m]) return;
        var t = rendre(m, prenom, sujet, element, ctx.profil.ton, ctx.profil.politesse);
        if (t.length <= restant) out.push({ modele: m, texte: t });
      });
      return out;
    }
    var passes = [this.recents(ctx, type, 3), this.recents(ctx, type, 1)];
    for (var i = 0; i < passes.length; i++) {
      var s = cands(spe, passes[i]), g = cands(gen, passes[i]);
      var pool = (s.length && (!g.length || this.rng.dbl() < 0.5)) ? s : g;
      if (pool.length) return pool[this.rng.next(pool.length)];
    }
    return null;
  };
  Moteur.prototype.planCourt = function (ctx) {
    var p = [];
    if (NEGATIVES[ctx.emotion]) p.push('EMPATHIE');
    if (ctx.forcerReference) p.push('INFORMATION');
    p.push('CONSEIL', 'QUESTION');
    if (!ctx.forcerReference) p.push('INFORMATION');
    p.push('ACTION');
    if (!(ctx.historique || []).length) p.push('OUVERTURE');
    p.push('ENCOURAGEMENT', 'CLOTURE');
    return p;
  };
  Moteur.prototype.empaqueter = function (blocs, prefixe, max) {
    var parts = [];
    blocs.forEach(function (b, i) {
      var t = (i === 0 && prefixe) ? prefixe + ' ' + minuscule(b[1]) : b[1];
      var c = parts[parts.length - 1];
      if (c !== undefined && c.length + 1 + t.length <= LIMITE) parts[parts.length - 1] = c + ' ' + t; else parts.push(t);
    });
    if (!parts.length || parts.length > max) return null;
    for (var i = 0; i < parts.length; i++) if (parts[i].length > LIMITE) return null;
    return parts;
  };
  Moteur.prototype.assembler = function (theme, ctx) {
    var sujet = this.sujetRendu(theme, ctx), element = this.elementRendu(ctx, sujet);
    var max = ctx.maxParties || MAX_PARTIES, prefixe = ctx.prefixe || '';
    var detaille = !ctx.blocsImposes && ctx.mode === 'DETAILLE';
    var plan = ctx.blocsImposes || (detaille ? BLOCS.filter(function (b) { return !(b === 'EMPATHIE' && ctx.emotion === 'POSITIVE'); }) : this.planCourt(ctx));
    var choisis = {}, prenom = ctx.profil.prenom || null, longueur = prefixe.length;
    for (var i = 0; i < plan.length; i++) {
      var restant = detaille ? LIMITE : LIMITE - longueur - (longueur > 0 ? 1 : 0);
      if (restant <= 0) break;
      var c = this.choisir(plan[i], theme, ctx, restant, prenom, sujet, element);
      if (!c) continue;
      choisis[plan[i]] = c;
      if (prenom && c.texte.indexOf(prenom) >= 0) prenom = null;
      longueur += c.texte.length + 1;
    }
    var blocs = BLOCS.filter(function (b) { return choisis[b]; }).map(function (b) { return [b, choisis[b].texte]; });
    var parts = this.empaqueter(blocs, prefixe, detaille ? max : 1);
    while (!parts && blocs.length) {
      var sac = null; for (var k = 0; k < SACRIFICE.length && !sac; k++) if (blocs.some(function (b) { return b[0] === SACRIFICE[k]; })) sac = SACRIFICE[k];
      if (!sac) break;
      blocs = blocs.filter(function (b) { return b[0] !== sac; });
      parts = this.empaqueter(blocs, prefixe, detaille ? max : 1);
    }
    if (!parts) {
      var self = this, plusCourt = this.blocs.CONSEIL.map(function (m) { return rendre(m, prenom, sujet, element, ctx.profil.ton, ctx.profil.politesse); })
        .sort(function (a, b) { return a.length - b.length; })[0] || '';
      parts = decouper((prefixe + ' ' + plusCourt).trim(), LIMITE, max);
    }
    var gardes = {}; blocs.forEach(function (b) { gardes[b[0]] = 1; });
    var variantes = {}; for (var b in choisis) if (gardes[b]) variantes[b] = choisis[b].modele;
    return { parties: parts, domaine: this.id, theme: theme ? theme.id : null, variantes: variantes,
      question: gardes.QUESTION ? choisis.QUESTION.texte : null, elements: ctx.elements || [], blocs: Object.keys(variantes) };
  };
  Moteur.prototype.repondre = function (msg, ctx) {
    var toks = tokens(msg), it = this.evaluer(toks, norm(msg), ctx.theme), theme = this.themeDe(it.theme);
    var els = (ctx.elements && ctx.elements.length) ? ctx.elements : it.elements.length ? it.elements : (elementSignificatif(toks) ? [elementSignificatif(toks)] : []);
    var c = {}; for (var k in ctx) c[k] = ctx[k]; c.elements = els;
    var r = this.assembler(theme, c), last = ctx.historique && ctx.historique.length ? ctx.historique[ctx.historique.length - 1].reponse : null, n = 0;
    while (n++ < 5 && last && r.parties.join(' ') === last) r = this.assembler(theme, c);
    return r;
  };

  /* ---------- Actualité : météo, sport, infos, géopolitique (données en direct + cache) ---------- */
  var WMO = { 0: 'ciel dégagé', 1: 'plutôt dégagé', 2: 'partiellement nuageux', 3: 'ciel couvert', 45: 'brouillard', 48: 'brouillard givrant',
    51: 'bruine légère', 53: 'bruine', 55: 'bruine forte', 61: 'pluie légère', 63: 'pluie', 65: 'forte pluie', 66: 'pluie verglaçante', 67: 'pluie verglaçante',
    71: 'neige légère', 73: 'neige', 75: 'forte neige', 77: 'grains de neige', 80: 'averses', 81: 'averses', 82: 'fortes averses', 85: 'averses de neige',
    86: 'averses de neige', 95: 'orage', 96: 'orage avec grêle', 99: 'orage avec grêle' };
  var NON_VILLE = ('demain aujourd hui ce cet cette soir matin semaine week end maintenant ce soir apres midi la le les un une quel quelle temps meteo').split(' ');

  function Cache(now) { this.m = {}; this.now = now; }
  Cache.prototype.put = function (k, v) { this.m[k] = { t: this.now(), v: v }; };
  /* Renvoie { v, ageMs, frais } si la valeur a moins de perimeMs ; frais = moins de ttlMs. */
  Cache.prototype.get = function (k, ttlMs, perimeMs) {
    var e = this.m[k]; if (!e) return null;
    var age = this.now() - e.t; if (age > perimeMs) return null;
    return { v: e.v, ageMs: age, frais: age <= ttlMs };
  };
  function age(ms) {
    var m = Math.round(ms / 60000);
    return m < 2 ? 'à l\'instant' : m < 60 ? 'il y a ' + m + ' min' : m < 1440 ? 'il y a ' + Math.round(m / 60) + ' h' : 'il y a ' + Math.round(m / 1440) + ' j';
  }
  function tronquer(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; var c = s.slice(0, n - 1), i = c.lastIndexOf(' '); return (i > n * 0.5 ? c.slice(0, i) : c) + '…'; }

  function MoteurActualite(dom, rng, cfg, opts) {
    Moteur.call(this, dom, rng);
    this.cfg = cfg || {}; this.now = opts.now; this.cache = new Cache(opts.now); this.fetchFn = opts.fetch;
    this.proxy = this.cfg.proxy || '';
  }
  MoteurActualite.prototype = Object.create(Moteur.prototype);
  MoteurActualite.prototype.configurer = function (c) { if (c && typeof c.proxy === 'string') this.proxy = c.proxy.replace(/\/+$/, ''); };
  MoteurActualite.prototype.ttl = function (cat) { return ((this.cfg.cacheMin || {})[cat] || 15) * 60000; };
  MoteurActualite.prototype.perime = function (cat) { return ((this.cfg.perimeMaxH || {})[cat] || 6) * 3600000; };
  /* Ville citée après une préposition ("météo à Abidjan"), sinon ville du profil. */
  MoteurActualite.prototype.ville = function (msg, ctx) {
    var toks = tokens(msg), prep = ['a', 'de', 'pour', 'sur', 'dans', 'au', 'en', 'chez'], maj = /^[A-ZÀ-Ý]/;
    for (var i = 0; i < toks.length - 1; i++) {
      if (prep.indexOf(toks[i].norm) < 0) continue;
      var j = i + 1; if (['la', 'le', 'l'].indexOf(toks[j].norm) >= 0) j++;
      var t = toks[j]; if (!t || NON_VILLE.indexOf(t.norm) >= 0 || t.norm.length < 3) continue;
      var nom = [t.orig], k = j + 1;
      if (maj.test(t.orig)) while (k < toks.length && nom.length < 3 && maj.test(toks[k].orig) && NON_VILLE.indexOf(toks[k].norm) < 0) { nom.push(toks[k].orig); k++; }
      return nom.join(' ');
    }
    return (ctx.profil && ctx.profil.ville) || null;
  };
  MoteurActualite.prototype.categorie = function (themeId) { return themeId === 'meteo' ? 'meteo' : themeId; };
  /* Phase asynchrone : remplit le cache avant la réponse (la réponse elle-même reste synchrone). */
  MoteurActualite.prototype.precharger = function (msg, ctx) {
    var self = this, it = this.detecter(msg, ctx), theme = it.theme || 'infos';
    if (theme === 'meteo') {
      var ville = this.ville(msg, ctx); if (!ville) return Promise.resolve();
      var gk = 'geo:' + norm(ville), g = this.cache.get(gk, this.ttl('geo'), this.ttl('geo'));
      var p = g ? Promise.resolve(g.v) : this.lire(this.cfg.geoUrl + '?name=' + encodeURIComponent(ville) + '&count=1&language=fr&format=json').then(function (txt) {
        var r = txt && JSON.parse(txt).results; if (!r || !r.length) return null;
        var v = { nom: r[0].name, lat: r[0].latitude, lon: r[0].longitude }; self.cache.put(gk, v); return v;
      });
      return p.then(function (geo) {
        if (!geo) return;
        var mk = 'meteo:' + geo.lat.toFixed(2) + ',' + geo.lon.toFixed(2), m = self.cache.get(mk, self.ttl('meteo'), self.ttl('meteo'));
        if (m) return;
        var url = self.cfg.meteoUrl + '?latitude=' + geo.lat + '&longitude=' + geo.lon +
          '&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1';
        return self.lire(url).then(function (txt) {
          if (!txt) return; var d = JSON.parse(txt);
          self.cache.put(mk, { t: d.current.temperature_2m, code: d.current.weather_code, vent: d.current.wind_speed_10m,
            min: d.daily.temperature_2m_min[0], max: d.daily.temperature_2m_max[0], pluie: d.daily.precipitation_probability_max[0] });
        });
      });
    }
    if (!this.proxy) return Promise.resolve();
    var ck = 'actu:' + theme; if (this.cache.get(ck, this.ttl(theme), this.ttl(theme))) return Promise.resolve();
    /* shaman-actualite.json est écrit toutes les heures par GitHub (actualite-flux.cjs) : { updated, cats: { sport: { source, updated, items } } } */
    return this.lire(this.proxy).then(function (txt) {
      if (!txt) return;
      var d = JSON.parse(txt), cats = d.cats || {};
      Object.keys(cats).forEach(function (k) {
        var c = cats[k]; if (!c || !c.items || !c.items.length) return;
        self.cache.put('actu:' + k, { source: c.source || '', items: c.items, maj: Date.parse(c.updated || d.updated) || null });
      });
    });
  };
  MoteurActualite.prototype.lire = function (url) {
    var f = this.fetchFn; if (!f) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false, to = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 6000);
      try {
        f(url).then(function (r) { return r.ok ? r.text() : null; }).then(function (t) { if (!done) { done = true; clearTimeout(to); resolve(t); } },
          function () { if (!done) { done = true; clearTimeout(to); resolve(null); } });
      } catch (e) { if (!done) { done = true; clearTimeout(to); resolve(null); } }
    });
  };
  MoteurActualite.prototype.repondre = function (msg, ctx) {
    var it = this.detecter(msg, ctx), themeId = it.theme || 'infos', theme = this.themeDe(themeId), c = {};
    for (var k in ctx) c[k] = ctx[k];
    var sujet = this.sujetRendu(theme, c), ton = c.profil.ton, pol = c.profil.politesse, prenom = null, self = this;
    var rec = function (type, restant) { return self.choisir(type, theme, c, restant, prenom, sujet, sujet); };
    var data = null, texte = null, question = null, variantes = {};
    var ville = themeId === 'meteo' ? this.ville(msg, ctx) : null;
    if (themeId === 'meteo') {
      if (!ville) {
        var q = rec('ACTION', LIMITE);
        return { parties: [q.texte], domaine: this.id, theme: themeId, variantes: { ACTION: q.modele }, question: q.texte, elements: [], blocs: ['ACTION'], donnees: false };
      }
      var g = this.cache.get('geo:' + norm(ville), this.ttl('geo'), this.ttl('geo'));
      var m = g && this.cache.get('meteo:' + g.v.lat.toFixed(2) + ',' + g.v.lon.toFixed(2), this.ttl('meteo'), this.perime('meteo'));
      if (m) {
        var d = m.v, conseil = d.pluie >= 50 ? ' ' + rendre('<Prends|Prenez> un parapluie.', null, '', '', ton, pol) : d.max >= 33 ? ' ' + rendre('<Bois|Buvez> beaucoup d\'eau.', null, '', '', ton, pol) : '';
        texte = 'Météo à ' + g.v.nom + (m.frais ? '' : ' (' + age(m.ageMs) + ')') + ' : ' + (WMO[d.code] || 'temps variable') + ', ' + Math.round(d.t) + '°C (min ' + Math.round(d.min) + ', max ' + Math.round(d.max) + '), pluie ' + Math.round(d.pluie) + ' %.' + conseil;
      }
    } else if (this.proxy) {
      var a = this.cache.get('actu:' + themeId, this.ttl(themeId), this.perime(themeId));
      /* ancienneté = date de mise à jour du fichier ; au-delà de la durée de validité, on dit qu'il n'y a pas d'info récente */
      var ageInfo = a ? (a.v.maj ? this.now() - a.v.maj : a.ageMs) : null;
      if (a && ageInfo <= this.perime(themeId)) {
        var lib = ((this.cfg.libelleCat || {})[themeId]) || 'Actualité', items = a.v.items.slice(0, 3), src = items[0].source || a.v.source || 'sources en ligne';
        var corps = items.map(function (x, i) { return (i + 1) + ') ' + tronquer(x.title, 78); }).join(' ');
        texte = lib + ' (' + src + ', mis à jour ' + age(Math.max(ageInfo, 0)) + ') : ' + corps;
      }
    }
    var parts, blocs = [];
    if (texte) {
      var intro = rec('OUVERTURE', 60);
      parts = decouper(texte, LIMITE, 2);
      if (intro) {
        variantes.OUVERTURE = intro.modele; blocs.push('OUVERTURE');
        var comb = intro.texte + ' ' + parts[0];
        if (comb.length <= LIMITE) parts[0] = comb; else parts.unshift(intro.texte);
        parts = parts.slice(0, MAX_PARTIES);
      }
      var li = parts.length - 1, qf = rec('QUESTION', LIMITE - parts[li].length - 1);
      if (qf) { parts[li] = parts[li] + ' ' + qf.texte; variantes.QUESTION = qf.modele; question = qf.texte; blocs.push('QUESTION'); }
      return { parties: parts, domaine: this.id, theme: themeId, variantes: variantes, question: question, elements: [], blocs: blocs, donnees: true };
    }
    // Pas de donnée récente : on le dit honnêtement (jamais d'invention).
    var e = rec('EMPATHIE', LIMITE), inf = rec('INFORMATION', LIMITE), cs = rec('CONSEIL', LIMITE);
    var out = [];
    [['EMPATHIE', e], ['INFORMATION', inf], ['CONSEIL', cs]].forEach(function (x) { if (x[1]) { out.push(x[1].texte); variantes[x[0]] = x[1].modele; blocs.push(x[0]); } });
    var tout = decouper(out.join(' '), LIMITE, 2);
    return { parties: tout, domaine: this.id, theme: themeId, variantes: variantes, question: null, elements: [], blocs: blocs, donnees: false, sansDonnees: true };
  };

  /* ---------- Orchestrateur ---------- */
  function liste(a, b) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' ou ' + a[a.length - 1]; }
  function Orchestrateur(lm, opts) {
    opts = opts || {};
    this.rng = new Rng(opts.seed || 0);
    this.now = opts.now || function () { return Date.now(); };
    this.opts = opts; this.lm = lm; this.messages = lm.messages; this.moteurs = {}; this.ordre = [];
    var self = this;
    var fetchFn = opts.fetch || (typeof fetch === 'function' ? function (u) { return fetch(u); } : null);
    lm.domaines.forEach(function (d) {
      var m = d.id === 'ACTUALITE' ? new MoteurActualite(d, self.rng, lm.actualite, { now: self.now, fetch: fetchFn }) : new Moteur(d, self.rng);
      self.moteurs[d.id] = m; self.ordre.push(d.id);
    });
    var A = lm.analyse; this.lex = {};
    for (var k in A) this.lex[k] = csv(A[k]);
    this.depot = {}; this.journal = []; this.numero = 0;
    this.politesseMode = opts.politesse || 'VOUVOIEMENT';   // VOUVOIEMENT | TUTOIEMENT | AUTO
    this.tonFixe = opts.ton || null;
  }
  Orchestrateur.prototype.configurerActualite = function (c) { this.moteurs.ACTUALITE.configurer(c); };
  Orchestrateur.prototype.charger = function (p) {
    if (!this.depot[p]) this.depot[p] = { etat: { sujetActif: null, sousSujet: null, dernierMoteur: null, ton: 'AMICAL', politesse: this.politesseMode === 'TUTOIEMENT' ? 'TUTOIEMENT' : 'VOUVOIEMENT',
      emotion: 'NEUTRE', questionEnAttente: null, messageAClarifier: null, domainesProposes: [], elementsRecents: [], tours: 0 }, historique: [], profil: { prenom: null, ville: null } };
    return this.depot[p];
  };
  Orchestrateur.prototype.oublier = function (p) { delete this.depot[p]; };
  /* Libère le sujet verrouillé (un autre moteur du chatbot vient de répondre) sans effacer l'historique. */
  Orchestrateur.prototype.relacher = function (p) {
    var c = this.depot[p]; if (!c) return;
    c.etat.sujetActif = null; c.etat.sousSujet = null; c.etat.questionEnAttente = null; c.etat.messageAClarifier = null; c.etat.domainesProposes = [];
  };
  Orchestrateur.prototype.exporter = function (p) { return JSON.stringify(this.charger(p)); };
  Orchestrateur.prototype.importer = function (p, json) {
    try { var d = JSON.parse(json); if (d && d.etat && d.historique) { d.historique = d.historique.slice(-10); this.depot[p] = d; return true; } } catch (e) { }
    return false;
  };
  Orchestrateur.prototype.enConversation = function (p) { var c = this.depot[p]; return !!(c && c.etat.sujetActif); };

  /* ÉTAPE 3 : analyse du message (domaines, sujet, intention, émotion, urgence). */
  Orchestrateur.prototype.analyser = function (message, texteAnalyse, etat) {
    var toks = tokens(message), n = norm(message), L = this.lex, self = this;
    var tAn = tokens(texteAnalyse), nAn = norm(texteAnalyse);
    var candidats = this.ordre.map(function (id) {
      var ctx = { theme: id === etat.sujetActif ? etat.sousSujet : null };
      return self.moteurs[id].evaluer(tAn, nAn, ctx.theme);
    });
    var f = function (k) { return chercher(L[k], toks, n); };
    var count = function (k) { return f(k).length; };
    var detresse = f('detresse').length > 0;
    var emo = 'NEUTRE';
    if (detresse) emo = 'DETRESSE';
    else {
      var t = count('tristesse'), a = count('anxiete'), c = count('colere'), p = count('positive');
      if (t + a + c > 0) emo = t >= a && t >= c ? 'TRISTE' : a >= c ? 'ANXIEUX' : 'COLERE';
      else if (p > 0) emo = 'POSITIVE';
    }
    var urgence = 'AUCUNE';
    if (detresse) urgence = count('urgence_critique') > 0 ? 'CRITIQUE' : 'ELEVEE';
    else if (count('urgence_elevee') > 0) urgence = 'ELEVEE';
    var suiteMots = f('suite').length > 0 && toks.length <= 8;
    var motsAn = chercher(L.salutation, toks, n).length;
    return { brut: message, norm: n, toks: toks, candidats: candidats, emotion: emo, urgence: urgence, detresse: detresse,
      changement: count('changement') > 0, resteSignificatif: this.resteApresMarqueur(n, f('changement')), horsDomaine: count('hors_domaine') > 0,
      suite: !!etat.questionEnAttente || toks.length <= 5 || suiteMots,
      detail: count('detail') > 0 || message.length > 140 || urgence === 'ELEVEE' || urgence === 'CRITIQUE',
      salutation: motsAn > 0 && toks.length <= 4, merci: count('remerciement') > 0 && toks.length <= 6, auRevoir: count('au_revoir') > 0 && toks.length <= 5,
      medical: count('medical') > 0, juridique: count('juridique') > 0, financier: count('financier') > 0,
      vous: count('vous') > 0, tu: count('tu') > 0 };
  };

  Orchestrateur.prototype.resteApresMarqueur = function (n, marqueurs) {
    var t = ' ' + n + ' '; marqueurs.forEach(function (m) { t = t.split(m.kw).join(' '); });
    return elementSignificatif(tokens(t)) !== null;
  };

  /* ÉTAPES 4-5 : routage (score de confiance, moteur secondaire) et verrouillage du sujet. */
  Orchestrateur.prototype.router = function (an, etat, message) {
    var self = this, scores = {}, c = an.candidats.slice();
    c.forEach(function (x) { scores[x.domaine] = Math.round(x.confiance * 100) / 100; });
    var tri = c.slice().sort(function (a, b) { return b.confiance - a.confiance; });
    var best = tri[0], second = tri[1], actif = etat.sujetActif;
    var dec = { type: 'MOTEUR', principal: null, secondaire: null, theme: null, confiance: 0, sujetChange: false, verrou: false, raison: '', scores: scores, proposes: [] };
    var par = function (id) { return c.filter(function (x) { return x.domaine === id; })[0]; };
    // réponse à une question de clarification : on choisit parmi les domaines proposés
    if (etat.messageAClarifier) {
      var rep = null, rs = 0, nm = norm(message);
      (etat.domainesProposes.length ? etat.domainesProposes : this.ordre).forEach(function (id) {
        var m = self.moteurs[id], s = m.evaluer(tokens(message), nm, null).confiance + (nm.indexOf(norm(m.court)) >= 0 ? 0.6 : 0);
        if (s > rs) { rs = s; rep = id; }
      });
      if (rep) { var x = par(rep); dec.principal = rep; dec.theme = x.theme; dec.confiance = Math.max(x.confiance, SEUIL_MIN); dec.raison = 'réponse à la clarification (' + rep + ')'; dec.sujetChange = rep !== actif; return dec; }
    }
    if (actif && !an.changement) {
      var sa = par(actif).confiance;
      var bascule = best.domaine !== actif && best.confiance >= SEUIL_MIN && best.confiance - sa >= MARGE_CHANGEMENT;
      var horsSujet = best.confiance < SEUIL_MIN && (an.horsDomaine || (message.indexOf('?') >= 0 && an.toks.length > 3 && sa === 0));
      if (!horsSujet && !bascule) {
        dec.principal = actif; dec.theme = par(actif).theme || etat.sousSujet; dec.confiance = Math.max(sa, SEUIL_MIN); dec.verrou = true;
        var autre = tri.filter(function (x) { return x.domaine !== actif && x.confiance >= SEUIL_SECOND; })[0];
        if (autre) dec.secondaire = autre.domaine;
        dec.raison = 'sujet verrouillé sur ' + actif + (dec.theme ? '/' + dec.theme : '') + (autre ? ' ; secondaire ' + autre.domaine : '');
        return dec;
      }
      if (bascule) {
        dec.principal = best.domaine; dec.theme = best.theme; dec.confiance = best.confiance; dec.sujetChange = true;
        if (sa >= SEUIL_SECOND) dec.secondaire = actif;
        dec.raison = 'changement de sujet : ' + actif + ' -> ' + best.domaine; return dec;
      }
    }
    if (best.confiance < SEUIL_MIN && an.changement && !an.resteSignificatif) {
      dec.type = 'CLARIFICATION'; dec.proposes = []; dec.raison = 'changement de sujet demandé, nouveau sujet à préciser'; return dec;
    }
    if (best.confiance < SEUIL_MIN) {
      if (an.horsDomaine || best.confiance === 0) { dec.type = 'HORS_DOMAINE'; dec.raison = 'aucun domaine reconnu (meilleur ' + best.domaine + ' ' + scores[best.domaine] + ')'; return dec; }
      dec.type = 'CLARIFICATION'; dec.proposes = [best.domaine, second.confiance > 0 ? second.domaine : null].filter(function (x) { return x; });
      dec.raison = 'signal trop faible'; return dec;
    }
    if (best.confiance < 0.5 && second.confiance >= SEUIL_MIN && best.confiance - second.confiance < 0.1) {
      dec.type = 'CLARIFICATION'; dec.proposes = [best.domaine, second.domaine]; dec.raison = 'message ambigu entre ' + best.domaine + ' et ' + second.domaine; return dec;
    }
    dec.principal = best.domaine; dec.theme = best.theme; dec.confiance = best.confiance; dec.sujetChange = !!actif && actif !== best.domaine;
    if (second.confiance >= SEUIL_SECOND && second.confiance >= 0.6 * best.confiance) dec.secondaire = second.domaine;
    dec.raison = 'meilleur score ' + best.domaine + (dec.secondaire ? ' ; message mixte, secondaire ' + dec.secondaire : '');
    return dec;
  };

  /* ÉTAPE 7 : contrôle qualité avant envoi. */
  var DIAG = ['vous avez une depression', 'tu as une depression', 'vous souffrez de', 'tu souffres de', 'c est une maladie', 'vous etes malade', 'tu es malade',
    'vous allez gagner votre proces', 'tu vas gagner ton proces', 'c est illegal', 'vous devez porter plainte', 'tu dois porter plainte', 'vous etes coupable', 'tu es coupable'];
  Orchestrateur.prototype.controle = function (rep, an, dec, conv, etat) {
    var motifs = [], texte = rep.parties.join(' '), nt = norm(texte), h = conv.historique;
    if (!rep.parties.length || rep.parties.length > MAX_PARTIES) motifs.push('nombre de SMS invalide (' + rep.parties.length + ')');
    rep.parties.forEach(function (p) { if (!p.trim() || p.length > LIMITE) motifs.push('SMS vide ou trop long (' + p.length + ')'); });
    if (marqueur(texte)) motifs.push('marqueur de gabarit non résolu');
    if (rep.domaine !== 'ACTUALITE') {
      var termes = (rep.elements || []).map(norm);
      (h.length ? h[h.length - 1].elements || [] : []).forEach(function (e) { termes.push(norm(e)); });
      var m = this.moteurs[rep.domaine], th = m.themeDe(rep.theme);
      if (th) norm(rendre(th.libelle, null, '', '', 'AMICAL', 'VOUVOIEMENT')).split(' ').forEach(function (w) { if (w.length >= 5 && w !== 'situation' && w !== 'votre') termes.push(w); });
      termes = termes.filter(function (t) { return t; });
      if (termes.length && !termes.some(function (t) { return nt.indexOf(t) >= 0; })) motifs.push('aucun élément concret du message repris');
    }
    if (dec.verrou && !dec.sujetChange && !an.changement && rep.domaine !== etat.sujetActif) motifs.push('incohérent avec le sujet verrouillé');
    h.slice(-3).forEach(function (e) {
      if (e.reponse && norm(e.reponse) === nt) motifs.push('même texte qu\'un échange récent');
    });
    DIAG.forEach(function (d) { if (nt.indexOf(d) >= 0) motifs.push('formulation de diagnostic/avis définitif'); });
    return { ok: motifs.length === 0, motifs: motifs };
  };

  function choixAlea(rng, liste) { return liste[rng.next(liste.length)]; }
  Orchestrateur.prototype.fixe = function (cle, conv, extra) {
    var p = conv.profil, e = conv.etat, M = this.messages[cle], i = this.rng.next(M.length), k = 0;
    while (k++ < 8 && M.length > 1 && conv.dernierFixe === cle + i) i = this.rng.next(M.length);
    conv.dernierFixe = cle + i;
    return decouper(rendre(M[i], p.prenom, '', '', e.ton, e.politesse, extra), LIMITE, MAX_PARTIES);
  };
  Orchestrateur.prototype.pousser = function (conv, message, rep, domaine, theme, variantes, elements) {
    conv.historique.push({ message: message, reponse: rep, domaine: domaine, theme: theme, variantes: variantes || {}, elements: elements || [] });
    if (conv.historique.length > 10) conv.historique.shift();
  };
  Orchestrateur.prototype.tonPour = function (domaine, emotion) {
    if (NEGATIVES[emotion]) return 'RASSURANT';
    if (this.tonFixe) return this.tonFixe;
    return (domaine === 'PROFESSIONNEL' || domaine === 'FINANCE' || domaine === 'RECRUTEMENT' || domaine === 'ACTUALITE') ? 'PROFESSIONNEL' : 'AMICAL';
  };

  /* Traite un message : 8 étapes, journal de debug, résultat prêt à envoyer.
   * opt.passerHorsDomaine : si le message est hors domaine, ne rien produire (le moteur appelant essaie autre chose). */
  Orchestrateur.prototype.traiter = function (personne, brut, opt) {
    opt = opt || {};
    var J = [], conv = this.charger(personne), etat = conv.etat, n = ++this.numero, self = this;
    var message = String(brut || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    J.push('#' + n + ' ÉTAPE 1 normalisation : "' + norm(message) + '"');
    if (opt.prenom) conv.profil.prenom = opt.prenom;
    if (opt.ville) conv.profil.ville = opt.ville;
    var fin = function (r) { r.journal = J; self.journal = self.journal.concat(J).slice(-200); return r; };
    if (!message) {
      etat.ton = 'AMICAL';
      var pv = this.fixe('vide', conv); J.push('  -> message vide');
      return fin({ type: 'VIDE', parties: pv, texte: pv.join(' '), chips: [] });
    }
    // ÉTAPE 2 : historique et état
    J.push('ÉTAPE 2 état : sujet=' + (etat.sujetActif || '-') + '/' + (etat.sousSujet || '-') + ' question=' + (etat.questionEnAttente ? 'oui' : 'non') + ' historique=' + conv.historique.length + '/10');
    var texteAn = etat.messageAClarifier ? etat.messageAClarifier + ' ' + message : message;
    // ÉTAPE 3 : analyse
    var an = this.analyser(message, texteAn, etat);
    var tri = an.candidats.slice().sort(function (a, b) { return b.confiance - a.confiance; });
    J.push('ÉTAPE 3 analyse : émotion=' + an.emotion + ' urgence=' + an.urgence + ' détail=' + (an.detail ? 'oui' : 'non') + ' | top : ' +
      tri.slice(0, 3).map(function (x) { return x.domaine + ' ' + x.confiance.toFixed(2) + (x.theme ? '/' + x.theme : ''); }).join(', '));
    // politesse (auto = on suit la personne ; sinon valeur fixée)
    if (this.politesseMode === 'AUTO') { if (an.vous && !an.tu) etat.politesse = 'VOUVOIEMENT'; else if (an.tu && !an.vous) etat.politesse = 'TUTOIEMENT'; }
    else etat.politesse = this.politesseMode;
    var profil = { prenom: conv.profil.prenom, ville: conv.profil.ville, ton: etat.ton, politesse: etat.politesse };

    // Détresse grave : soutien et orientation, avant tout le reste.
    if (an.detresse) {
      etat.emotion = 'DETRESSE'; etat.ton = 'RASSURANT'; etat.questionEnAttente = null; etat.messageAClarifier = null;
      var urg = this.opts.numerosUrgence ? ' (' + this.opts.numerosUrgence + ')' : '';
      var ex = { urgences: urg }, ps = this.fixe('detresse1', conv).concat(this.fixe('detresse2', conv));
      if (an.urgence === 'CRITIQUE') ps = ps.concat(this.fixe('detresse3', conv, ex));
      ps = ps.slice(0, MAX_PARTIES);
      J.push('  -> DÉTRESSE détectée : message de soutien (' + ps.length + ' SMS)');
      this.pousser(conv, '[message sensible]', ps.join(' '), etat.sujetActif, etat.sousSujet, {}, []);
      return fin({ type: 'DETRESSE', parties: ps, texte: ps.join(' '), chips: [], detresse: true });
    }
    // Salutation / merci / au revoir sans contenu : réponse courte.
    var best = tri[0];
    if (best.confiance < SEUIL_MIN && !etat.questionEnAttente && (an.salutation || an.merci || an.auRevoir)) {
      var cle = an.salutation ? 'accueil' : an.merci ? 'merci' : 'au_revoir';
      var pf = this.fixe(cle, conv); J.push('  -> message de politesse (' + cle + ')');
      this.pousser(conv, message, pf.join(' '), etat.sujetActif, etat.sousSujet, {}, []);
      return fin({ type: 'FIXE', parties: pf, texte: pf.join(' '), chips: cle === 'accueil' ? this.chipsDomaines() : [] });
    }
    // ÉTAPES 4-5 : routage + verrouillage
    var dec = this.router(an, etat, message);
    J.push('ÉTAPES 4-5 routage : ' + dec.type + (dec.principal ? ' principal=' + dec.principal + ' (' + dec.confiance.toFixed(2) + ')' : '') + (dec.secondaire ? ' secondaire=' + dec.secondaire : '') +
      ' | verrou=' + (dec.verrou ? 'maintenu' : dec.sujetChange ? 'changé' : 'nouveau') + ' | ' + dec.raison);
    if (dec.type === 'HORS_DOMAINE') {
      if (opt.passerHorsDomaine) { J.push('  -> hors domaine : laissé aux autres moteurs du chatbot'); return fin({ type: 'HORS_DOMAINE', passe: true, parties: [], texte: '', chips: [] }); }
      etat.questionEnAttente = null; etat.messageAClarifier = null;
      var pr = this.fixe('recentrage', conv); J.push('  -> hors domaine : recentrage poli');
      this.pousser(conv, message, pr.join(' '), etat.sujetActif, etat.sousSujet, {}, []);
      return fin({ type: 'HORS_DOMAINE', recentrage: true, parties: pr, texte: pr.join(' '), chips: this.chipsDomaines() });
    }
    var elemFallback = elementSignificatif(an.toks) || (conv.historique.length ? (conv.historique[conv.historique.length - 1].elements || [])[0] : null) || 'votre message';
    if (dec.type === 'CLARIFICATION') return fin(this.clarifier(conv, etat, dec, message, elemFallback, J));

    // ÉTAPE 6 : appel du ou des moteurs
    var prim = this.moteurs[dec.principal], cand = an.candidats.filter(function (x) { return x.domaine === dec.principal; })[0];
    var avert = an.medical ? 'avert_medical' : an.juridique ? 'avert_juridique' : (dec.principal === 'FINANCE' && (an.financier || ['epargne', 'dettes', 'compta', 'projet'].indexOf(dec.theme) >= 0)) ? 'avert_financier' : null;
    if (dec.principal === 'FINANCE' && avert === null && an.juridique) avert = 'avert_juridique';
    profil.ton = this.tonPour(dec.principal, an.emotion);
    var detaille = an.detail && !dec.secondaire;
    var ctx = { profil: profil, historique: conv.historique.slice(), theme: dec.verrou || dec.principal === etat.sujetActif ? etat.sousSujet : null,
      emotion: an.emotion, urgence: an.urgence, elements: cand.elements, mode: detaille ? 'DETAILLE' : 'COURT', forcerReference: false,
      blocsImposes: null, prefixe: '', maxParties: avert ? (dec.secondaire ? 1 : 2) : MAX_PARTIES };
    if (dec.theme && dec.principal !== etat.sujetActif) ctx.theme = null;
    var rep = null, qc = null, tent = 0, essais = [];
    while (tent < 8) {
      tent++; ctx.forcerReference = tent >= 2;
      rep = prim.repondre(texteAn, ctx);
      if (dec.secondaire) {
        var sec = this.moteurs[dec.secondaire], sc = {}; for (var k in ctx) sc[k] = ctx[k];
        sc.blocsImposes = ['INFORMATION', 'CONSEIL']; sc.prefixe = 'Côté ' + sec.court + ' :'; sc.theme = null;
        sc.elements = an.candidats.filter(function (x) { return x.domaine === dec.secondaire; })[0].elements;
        var r2 = sec.repondre(texteAn, sc);
        rep = { parties: rep.parties.slice(0, 1).concat(r2.parties.slice(0, 1)), domaine: rep.domaine, theme: rep.theme, variantes: rep.variantes,
          question: rep.question, elements: rep.elements, blocs: rep.blocs, secondaire: dec.secondaire };
      }
      if (avert) rep.parties = rep.parties.concat(this.fixe(avert, conv)).slice(0, MAX_PARTIES);
      // ÉTAPE 7 : contrôle qualité
      qc = this.controle(rep, an, dec, conv, etat);
      essais.push(qc.ok ? 'tentative ' + tent + ' : OK' : 'tentative ' + tent + ' : ' + qc.motifs.join(' / '));
      if (qc.ok) break;
    }
    J.push('ÉTAPE 6 moteur ' + dec.principal + (rep && rep.theme ? '/' + rep.theme : '') + ' blocs=[' + (rep.blocs || []).join(',') + '] mode=' + ctx.mode + (avert ? ' + ' + avert : ''));
    J.push('ÉTAPE 7 contrôle qualité : ' + essais.join(' ; '));
    if (!qc.ok) {
      J.push('  -> contrôle non satisfait : question de clarification courte (jamais de réponse générique)');
      dec.proposes = [dec.principal]; return fin(this.clarifier(conv, etat, dec, message, elemFallback, J));
    }
    // ÉTAPE 8 : mise à jour de l'état (et de l'historique)
    var texte = rep.parties.join(' ');
    var memeDomaine = etat.sujetActif === dec.principal;
    etat.sousSujet = rep.theme || dec.theme || (memeDomaine ? etat.sousSujet : null); etat.sujetActif = dec.principal; etat.dernierMoteur = dec.principal; etat.ton = profil.ton;
    etat.emotion = an.emotion; etat.questionEnAttente = rep.question; etat.messageAClarifier = null; etat.domainesProposes = []; etat.tours++;
    etat.elementsRecents = cand.elements;
    this.pousser(conv, message, texte, dec.principal, etat.sousSujet, rep.variantes, cand.elements.length ? cand.elements : []);
    J.push('ÉTAPE 8 état : sujetActif=' + etat.sujetActif + ' sousSujet=' + (etat.sousSujet || '-') + ' question=' + (etat.questionEnAttente ? 'oui' : 'non') + ' ; ' + rep.parties.length + ' SMS (' + rep.parties.map(function (p) { return p.length; }).join('+') + ')');
    return fin({ type: 'MOTEUR', domaine: dec.principal, theme: rep.theme, secondaire: dec.secondaire || null, confiance: dec.confiance, sujetChange: dec.sujetChange,
      parties: rep.parties, texte: texte, chips: this.chipsSuite(rep), question: rep.question, qc: qc, decision: dec, emotion: an.emotion, donnees: rep.donnees });
  };
  Orchestrateur.prototype.clarifier = function (conv, etat, dec, message, element, J) {
    var P = dec.proposes || [], cle = P.length >= 2 ? 'clarification' : P.length === 1 ? 'clarification1' : 'clarification0', self = this;
    var ex = {}; if (P[0]) ex.a = this.moteurs[P[0]].de; if (P[1]) ex.b = this.moteurs[P[1]].de;
    var M = this.messages[cle], i = this.rng.next(M.length);
    var t = rendre(M[i], conv.profil.prenom, '', element, etat.ton, etat.politesse, ex);
    var parts = [t];
    etat.questionEnAttente = t; etat.messageAClarifier = (etat.messageAClarifier ? etat.messageAClarifier + ' ' : '') + message; etat.domainesProposes = P;
    J.push('  -> CLARIFICATION : une seule question (' + (P.join(' / ') || 'sujet libre') + ')');
    this.pousser(conv, message, t, etat.sujetActif, etat.sousSujet, {}, [element]);
    return { type: 'CLARIFICATION', parties: parts, texte: t, chips: P.length ? P.map(function (id) { return majuscule(self.moteurs[id].court); }).concat(['Autre sujet']) : this.chipsDomaines(), question: t, journal: J };
  };
  Orchestrateur.prototype.chipsDomaines = function () {
    var self = this; return this.ordre.map(function (id) { return majuscule(self.moteurs[id].court); }).slice(0, 7);
  };
  Orchestrateur.prototype.chipsSuite = function (rep) {
    var c = []; if (rep.question) c.push('Oui', 'Non'); c.push('Un autre conseil', 'Changeons de sujet'); return c;
  };
  /* Décision de routage « à blanc » (aucun effet sur l'état) : utilisée par le chatbot pour arbitrer avec ses intentions agence. */
  Orchestrateur.prototype.apercu = function (personne, message) {
    var etat = this.charger(personne).etat, texte = etat.messageAClarifier ? etat.messageAClarifier + ' ' + message : message;
    return this.router(this.analyser(message, texte, etat), etat, message);
  };
  Orchestrateur.prototype.precharger = function (personne, message) {
    var conv = this.charger(personne), etat = conv.etat, m = this.moteurs.ACTUALITE;
    var texte = etat.messageAClarifier ? etat.messageAClarifier + ' ' + message : message;
    var it = m.detecter(texte, { theme: etat.sujetActif === 'ACTUALITE' ? etat.sousSujet : null });
    var an = this.analyser(message, texte, etat), dec = this.router(an, etat, message);
    if (dec.principal !== 'ACTUALITE' && dec.secondaire !== 'ACTUALITE') return Promise.resolve();
    return m.precharger(texte, { profil: { ville: conv.profil.ville }, theme: etat.sousSujet });
  };
  Orchestrateur.prototype.stats = function () {
    var out = { moteurs: {}, total: 0 }, self = this;
    this.ordre.forEach(function (id) { var m = self.moteurs[id]; out.moteurs[id] = { themes: m.themes.length, combinaisons: m.nombreCombinaisons() }; out.total += m.nombreCombinaisons(); });
    return out;
  };

  root.ShamanMoteursJS = { create: function (lm, opts) { return new Orchestrateur(lm, opts); }, _internes: { norm: norm, rendre: rendre, tokens: tokens, chercher: chercher, csv: csv, decouper: decouper } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ShamanMoteursJS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
