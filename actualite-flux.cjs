// Lit des flux RSS d'actualité (sans clé, sans dépendance) et écrit shaman-actualite.json.
// Lancé toutes les heures par GitHub (.github/workflows/actualite.yml) ; le chatbot lit ce fichier.
// Pour changer de média : modifier la liste FLUX ci-dessous (le premier flux qui répond est utilisé).
// Si aucun flux ne répond, l'ancien contenu est gardé avec sa date : le chatbot dira alors honnêtement
// que l'information n'est plus récente.
const fs = require('fs');
const SORTIE = 'shaman-actualite.json';
const FLUX = {
  sport: [
    ['RFI', 'https://www.rfi.fr/fr/sports/rss'],
    ['France 24', 'https://www.france24.com/fr/sports/rss'],
    ['Le Monde', 'https://www.lemonde.fr/sport/rss_full.xml'],
  ],
  infos: [
    ['RFI', 'https://www.rfi.fr/fr/afrique/rss'],
    ['France 24', 'https://www.france24.com/fr/afrique/rss'],
    ['BBC Afrique', 'https://feeds.bbci.co.uk/afrique/rss.xml'],
    ['Le Monde', 'https://www.lemonde.fr/afrique/rss_full.xml'],
  ],
  geopolitique: [
    ['RFI', 'https://www.rfi.fr/fr/monde/rss'],
    ['France 24', 'https://www.france24.com/fr/monde/rss'],
    ['Le Monde', 'https://www.lemonde.fr/international/rss_full.xml'],
    ['BBC Afrique', 'https://feeds.bbci.co.uk/afrique/rss.xml'],
  ],
};

function decoder(t) {
  return String(t || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
function lireItems(xml) {
  const items = [], re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < 8) {
    const titre = decoder((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(m[0]) || [])[1]);
    const date = decoder((/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(m[0]) || [])[1]);
    if (titre) items.push({ title: titre, date });
  }
  return items;
}
async function lire(url) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'ShamanChooz-Actualite/1.0', accept: 'application/rss+xml, application/xml, text/xml, */*' } });
    return r.ok ? await r.text() : null;
  } catch (e) { return null; } finally { clearTimeout(to); }
}
async function main() {
  let ancien = { cats: {} };
  try { ancien = JSON.parse(fs.readFileSync(SORTIE, 'utf8')); } catch (e) { /* premier passage */ }
  const maintenant = new Date().toISOString(), cats = {};
  for (const cat of Object.keys(FLUX)) {
    let fait = false;
    for (const [nom, url] of FLUX[cat]) {
      const xml = await lire(url), items = xml ? lireItems(xml) : [];
      console.log(`${cat} : ${nom} -> ${items.length} titre(s)${items.length ? '' : ' (flux inutilisable)'}`);
      if (items.length) { cats[cat] = { source: nom, updated: maintenant, items: items.map(x => ({ title: x.title, date: x.date, source: nom })) }; fait = true; break; }
    }
    if (!fait && ancien.cats && ancien.cats[cat]) { cats[cat] = ancien.cats[cat]; console.log(`${cat} : ancien contenu conservé (${ancien.cats[cat].updated})`); }
  }
  fs.writeFileSync(SORTIE, JSON.stringify({ updated: maintenant, cats }, null, 1) + '\n');
  console.log(`${SORTIE} écrit : ${Object.keys(cats).length} catégorie(s)`);
}
if (require.main === module) main(); else module.exports = { lireItems, decoder };
