package shaman

import kotlin.js.Date

/*
 * SHAMAN CHOOZ PRODUCTION — moteur de conversation Kotlin.
 * Données (phrases, intentions, secteurs, cours) : shaman-lexicon.json + shaman-cours.json.
 * Le moteur combine des blocs de phrases (ouverture, cœur, liaison, détail, conseil, clôture, emoji)
 * pour produire des millions de réponses distinctes, toujours dans le contexte du site.
 */

private const val ACC = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ"
private const val PLN = "aaaaaaceeeeiiiinooooouuuuyyoa"
private val STOP: List<String> = ("le la les un une des de du et ou en au aux a ce ces cet cette ca que qui quoi dans pour par sur avec sans est es suis " +
    "sommes etes sont etre avoir ai as avons avez ont je tu il elle on nous vous ils elles mon ma mes ton ta tes son sa ses notre " +
    "votre vos leur leurs me te se moi toi lui y ne pas plus comment quel quelle quels quelles qu s l d j m t n c").split(" ")
private val NON_ALNUM = Regex("[^a-z0-9]+")
private val PAREN = Regex("\\([^)]*\\)")

internal fun norm(s0: String): String {
    val s = s0.lowercase()
    val sb = StringBuilder()
    for (ch in s) {
        val k = ACC.indexOf(ch)
        sb.append(if (k >= 0) PLN[k] else ch)
    }
    return NON_ALNUM.replace(sb.toString(), " ").trim()
}

internal fun sig(n: String, min: Int): List<String> = n.split(" ").filter { it.length >= min && !STOP.contains(it) }
internal fun cap(s: String): String = if (s.isEmpty()) s else s.substring(0, 1).uppercase() + s.substring(1)
internal fun lowerFirst(s: String): String =
    if (s.length > 1 && s[0].isUpperCase() && s[1].isLowerCase()) s.substring(0, 1).lowercase() + s.substring(1) else s
internal fun has(pad: String, w: String): Boolean = pad.contains(" $w ")
internal fun anyPhrase(pad: String, list: List<String>): Boolean = list.any { has(pad, norm(it)) }
internal fun firstWord(s: String): String = norm(s).split(" ")[0]

internal fun lev(a: String, b: String): Int {
    val p = IntArray(b.length + 1) { it }
    for (i in 1..a.length) {
        var prev = p[0]
        p[0] = i
        for (j in 1..b.length) {
            val t = p[j]
            val cost = if (a[i - 1] == b[j - 1]) 0 else 1
            p[j] = minOf(p[j] + 1, p[j - 1] + 1, prev + cost)
            prev = t
        }
    }
    return p[b.length]
}

internal fun splitSentences(t: String): List<String> {
    val out = ArrayList<String>()
    val cur = StringBuilder()
    for (i in t.indices) {
        val ch = t[i]
        cur.append(ch)
        if ((ch == '.' || ch == '!' || ch == '?') && (i + 1 >= t.length || t[i + 1] == ' ')) {
            val nx: Char? = if (i + 2 < t.length) t[i + 2] else null
            if (i + 1 >= t.length || (nx != null && nx.isUpperCase())) {
                val s = cur.toString().trim()
                if (s.isNotEmpty()) out.add(s)
                cur.clear()
            }
        }
    }
    val rest = cur.toString().trim()
    if (rest.isNotEmpty()) out.add(rest)
    return out
}

private fun esc(s: String): String {
    val sb = StringBuilder("\"")
    for (c in s) {
        when (c) {
            '"' -> sb.append("\\\"")
            '\\' -> sb.append("\\\\")
            '\n' -> sb.append("\\n")
            '\r' -> sb.append("\\r")
            '\t' -> sb.append("\\t")
            else -> if (c < ' ') sb.append("\\u" + c.code.toString(16).padStart(4, '0')) else sb.append(c)
        }
    }
    sb.append('"')
    return sb.toString()
}

private fun strs(d: dynamic): List<String> {
    val out = ArrayList<String>()
    val n = d.length as Int
    for (i in 0 until n) out.add(d[i] as String)
    return out
}

private fun keysOf(o: dynamic): List<String> {
    val k = js("Object").keys(o)
    return strs(k)
}

internal class Rng(seed: Int) {
    private var s: Int = if (seed == 0) 123456789 else seed
    fun next(n: Int): Int {
        s = s xor (s shl 13)
        s = s xor (s ushr 17)
        s = s xor (s shl 5)
        return (s ushr 1) % n
    }
}

internal class Intent(
    val id: String, val kw: List<String>, val core: List<String>, val detail: List<String>,
    val tip: List<String>, val chips: List<String>, val light: Boolean
)
internal class Entry(val subject: String, val chapter: String, val text: String, val sT: List<String>, val cT: List<String>)
internal class Metier(val m: String, val s: String, val t: List<String>)
internal class Rule(val kws: List<String>, val answer: String)
internal class Fact(val txt: String, val t: List<String>)
internal class Learned(val a: String, val t: List<String>)
internal class UserCourse(val s: String, val c: String, val t: String)
internal class QuizQ(val q: String, val a: String, val raw: String)
internal class Section(val t: String, val x: String, val quiz: List<QuizQ>?)
internal class CourseState(val entry: Entry, val sections: List<Section>, var i: Int)
internal class QuizState(val qs: List<QuizQ>, var i: Int, var score: Int)
internal class Scored(val def: Intent, val score: Double)
internal class LifeTopic(
    val id: String, val kw: List<String>, val core: List<String>, val detail: List<String>, val tip: List<String>,
    val ask: List<String>, val chips: List<String>, val note: String, val light: Boolean
)
internal class LScored(val t: LifeTopic, val score: Double)
internal class Instr {
    var name = ""
    var tone = ""
    var signature = ""
    val forbidden = ArrayList<String>()
    val rules = ArrayList<Rule>()
    val facts = ArrayList<Fact>()
}
internal class State {
    var last: String? = null
    var lastLife: String? = null
    var name = ""
    var course: CourseState? = null
    var quiz: QuizState? = null
    var menu = ""
    val recent = HashMap<String, MutableList<Int>>()
    val used = HashMap<String, MutableList<Int>>()
}

@JsExport
class ShamanEngine(lexJson: String, coursesJson: String, seed: Int) {
    // ----- lexique -----
    private val openers: List<String>
    private val bridges: List<String>
    private val closers: List<String>
    private val emojis: List<String>
    private val intents = ArrayList<Intent>()
    private val intentKw = ArrayList<List<String>>()
    private val cIntro: List<String>
    private val cObj: List<String>
    private val cPit: List<String>
    private val cEx: List<String>
    private val cSyn: List<String>
    private val cPlus: List<String>
    private val disclaimers = ArrayList<Pair<List<String>, String>>()
    private val sectorMap = LinkedHashMap<String, List<String>>()
    private val sectors: List<String>
    private val metiers = ArrayList<Metier>()
    private val fallback: List<String>
    private val fallbackChips: List<String>
    private val refuse: List<String>
    private val yes: List<String>
    private val no: List<String>
    private val courseWords: List<String>
    private val softWords: List<String>
    private val nextWords: List<String>
    private val quizWords: List<String>
    private val sectorTpl: List<String>
    private val sectorTail: List<String>
    private val metierTpl: List<String>
    private val sectorChips: List<String>
    private val accentsRaw: String
    private val lifeOpeners: List<String>
    private val lifeBridges: List<String>
    private val lifeClosers: List<String>
    private val lifeAcks: List<String>
    private val lifeFallback: List<String>
    private val lifeDays: List<String>
    private val lifeMonths: List<String>
    private val lifeTopics = ArrayList<LifeTopic>()
    private val lifeKw = ArrayList<List<String>>()
    private val crisisKw: List<String>
    private val violenceKw: List<String>
    private val emergencyKw: List<String>
    private val crisisTxt: String
    private val violenceTxt: String
    private val emergencyTxt: String
    private val base = LinkedHashMap<String, String>()

    // ----- état -----
    private val rng = Rng(if (seed != 0) seed else (Date.now().toInt() and 0x7fffffff))
    private var instr = Instr()
    private var learned = ArrayList<Learned>()
    private var userCourses = ArrayList<UserCourse>()
    private var st = State()
    private var entries = ArrayList<Entry>()
    private var subjects = ArrayList<String>()
    private var acc = HashMap<String, String>()

    init {
        val L: dynamic = JSON.parse<dynamic>(lexJson)
        openers = strs(L.banks.openers); bridges = strs(L.banks.bridges)
        closers = strs(L.banks.closers); emojis = strs(L.banks.emojis)
        val arr = L.intents
        val n = arr.length as Int
        for (i in 0 until n) {
            val o = arr[i]
            val it = Intent(o.id as String, strs(o.kw), strs(o.core), strs(o.detail), strs(o.tip), strs(o.chips), o.light as Boolean)
            intents.add(it)
            intentKw.add(it.kw.map { k -> norm(k) })
        }
        val C = L.course
        cIntro = strs(C.intro); cObj = strs(C.objectifs); cPit = strs(C.pitfalls)
        cEx = strs(C.exercice); cSyn = strs(C.synthese); cPlus = strs(C.plus_loin)
        val dis = C.disclaimers
        for (i in 0 until (dis.length as Int)) disclaimers.add(Pair(strs(dis[i].re), dis[i].txt as String))
        val sec = L.sectors
        for (k in keysOf(sec)) sectorMap[k] = strs(sec[k])
        sectors = sectorMap.keys.toList()
        for ((s, list) in sectorMap) for (m in list) if (norm(m) != "autre") metiers.add(Metier(m, s, sig(norm(PAREN.replace(m, " ")), 4)))
        fallback = strs(L.fallback); fallbackChips = strs(L.fallback_chips); refuse = strs(L.refuse)
        yes = strs(L.yes); no = strs(L.no)
        courseWords = strs(L.course_words); softWords = strs(L.soft_words)
        nextWords = strs(L.next_words); quizWords = strs(L.quiz_words)
        sectorTpl = strs(L.sector_tpl); sectorTail = strs(L.sector_tail)
        metierTpl = strs(L.metier_tpl); sectorChips = strs(L.sector_chips)
        accentsRaw = L.accents as String
        val LF = L.life
        lifeOpeners = strs(LF.openers); lifeBridges = strs(LF.bridges); lifeClosers = strs(LF.closers)
        lifeAcks = strs(LF.acks); lifeFallback = strs(LF.fallback); lifeDays = strs(LF.days); lifeMonths = strs(LF.months)
        val lt = LF.topics
        for (i in 0 until (lt.length as Int)) {
            val o = lt[i]
            val t = LifeTopic(o.id as String, strs(o.kw), strs(o.core), strs(o.detail), strs(o.tip), strs(o.ask), strs(o.chips), o.note as String, o.light as Boolean)
            lifeTopics.add(t)
            lifeKw.add(t.kw.map { w -> norm(w) })
        }
        val SF = LF.safety
        crisisKw = strs(SF.crisis_kw).map { norm(it) }; violenceKw = strs(SF.violence_kw).map { norm(it) }
        emergencyKw = strs(SF.emergency_kw).map { norm(it) }
        crisisTxt = SF.crisis_txt as String; violenceTxt = SF.violence_txt as String; emergencyTxt = SF.emergency_txt as String
        val cj: dynamic = JSON.parse<dynamic>(if (coursesJson.isEmpty()) "{}" else coursesJson)
        for (k in keysOf(cj)) base[k] = cj[k] as String
        rebuild()
    }

    // ===== API exportée (chaînes JSON) =====
    fun reply(input: String): String = doReply(input)
    fun setInstructions(text: String): String = doSetInstructions(text)
    fun setLearned(json: String): String = doSetLearned(json)
    fun stats(): String =
        "{\"engine\":\"kotlin\",\"combinations\":" + combinations() + ",\"lifeCombinations\":" + lifeCombinations() + ",\"lifeTopics\":" + lifeTopics.size + ",\"intents\":" + intents.size + ",\"chapters\":" + entries.size +
            ",\"subjects\":" + subjects.size + ",\"learnedQa\":" + learned.size + ",\"learnedCourses\":" + userCourses.size + "}"
    fun reset(): String { st = State(); return "{\"ok\":true}" }

    // ===== utilitaires =====
    private fun rebuild() {
        val map = LinkedHashMap<String, String>()
        for ((k, v) in base) map[k] = v
        for (u in userCourses) map[norm(u.s) + "|" + norm(u.c)] = u.t
        entries = ArrayList()
        for ((k, v) in map) {
            val p = k.split("|")
            if (p.size < 2) continue
            entries.add(Entry(p[0], p[1], v, sig(norm(p[0]), 4), sig(norm(p[1]), 3)))
        }
        acc = HashMap()
        for (pair in accentsRaw.split(" ")) {
            val kv = pair.split(":")
            if (kv.size == 2) acc[kv[0]] = kv[1]
        }
        val src = entries.joinToString(" ") { it.text }
        for (m in Regex("[A-Za-zÀ-ÿœ'’-]+").findAll(src)) {
            val lw = m.value.lowercase()
            val nw = norm(lw)
            if (nw != lw && nw.length >= 5 && !nw.contains(" ") && !acc.containsKey(nw)) acc[nw] = lw
        }
        val subs = LinkedHashSet<String>()
        for (e in entries) subs.add(e.subject)
        subjects = ArrayList(subs)
    }

    private fun pick(key: String, list: List<String>): String {
        val rec = st.recent.getOrPut(key) { ArrayList() }
        var idx = 0
        var tries = 0
        do {
            idx = rng.next(list.size)
            tries++
        } while (list.size > 4 && rec.contains(idx) && tries < 12)
        rec.add(idx)
        if (rec.size > 3) rec.removeAt(0)
        return list[idx]
    }

    private fun chance(pct: Int): Boolean = rng.next(100) < pct

    private fun distinct(list: List<String>, n: Int): List<String> {
        val out = ArrayList<String>()
        var g = 0
        while (out.size < n && g++ < 40) {
            val v = list[rng.next(list.size)]
            if (!out.contains(v)) out.add(v)
        }
        return out
    }

    private fun fill(s: String): String {
        if (!s.contains("{")) return s
        val sc = distinct(sectors, 3)
        val me = distinct(metiers.map { it.m }, 2)
        fun clean(x: String) = PAREN.replace(x, "")
        return s.replace("{secteur}", sc[0]).replace("{secteur2}", if (sc.size > 1) sc[1] else sc[0])
            .replace("{secteur3}", if (sc.size > 2) sc[2] else sc[0])
            .replace("{metier}", clean(me[0])).replace("{metier2}", clean(if (me.size > 1) me[1] else me[0]))
    }

    private fun out(text0: String, chips: List<String>, kind: String, intent: String): String {
        var text = text0
        if (instr.signature.isNotEmpty() && kind != "course" && kind != "quiz" && kind != "safety") text += "\n" + instr.signature
        return "{\"text\":" + esc(text) + ",\"chips\":[" + chips.joinToString(",") { esc(it) } + "],\"kind\":" + esc(kind) + ",\"intent\":" + esc(intent) + "}"
    }

    private fun disp(s: String): String = cap(s.split(" ").joinToString(" ") { acc[it] ?: it })

    private fun emojiChance(): Int = when (instr.tone) {
        "cool" -> 100
        "chaleureux" -> 70
        "pro", "formel" -> 15
        else -> 55
    }

    private fun combinations(): Double {
        val e = emojis.size + 1
        var tot = 0.0
        for (it in intents) {
            val c = it.core.size.toDouble(); val d = it.detail.size.toDouble(); val t = it.tip.size.toDouble()
            tot += if (it.light) c * d * t * e
            else openers.size * c * bridges.size * d * t * closers.size * e
        }
        return tot
    }

    private fun lifeCombinations(): Double {
        val e = (emojis.size + 1).toDouble()
        var tot = 0.0
        for (t in lifeTopics) {
            val c = t.core.size.toDouble(); val d = t.detail.size.toDouble(); val tp = t.tip.size.toDouble(); val a = t.ask.size.toDouble()
            tot += if (t.light) c * d * tp * e
            else lifeOpeners.size * c * lifeBridges.size * d * tp * a * lifeClosers.size * e
        }
        return tot
    }

    // ===== instructions =====
    private fun doSetInstructions(text: String): String {
        val ins = Instr()
        var ok = 0
        val ignored = ArrayList<String>()
        val kvRe = Regex("^(nom|ton|signature|interdit|info)\\s*[:=]\\s*(.+)$", RegexOption.IGNORE_CASE)
        val ruleRe = Regex("^si\\s+(.+?)\\s+alors\\s+(.+)$", RegexOption.IGNORE_CASE)
        val splitRe = Regex(",|;|\\sou\\s", RegexOption.IGNORE_CASE)
        for (line in text.split("\n")) {
            val t = line.trim()
            if (t.isEmpty() || t.startsWith("#")) continue
            val m = kvRe.find(t)
            if (m != null) {
                val key = norm(m.groupValues[1])
                val v = m.groupValues[2].trim()
                when (key) {
                    "nom" -> ins.name = v
                    "ton" -> ins.tone = norm(v)
                    "signature" -> ins.signature = v
                    "interdit" -> for (w in v.split(Regex("[,;]"))) { val f = norm(w); if (f.isNotEmpty()) ins.forbidden.add(f) }
                    "info" -> ins.facts.add(Fact(v, sig(norm(v), 3)))
                }
                ok++
                continue
            }
            val r = ruleRe.find(t)
            if (r != null) {
                val kws = r.groupValues[1].split(splitRe).map { norm(it) }.filter { it.isNotEmpty() }
                if (kws.isNotEmpty()) { ins.rules.add(Rule(kws, r.groupValues[2].trim())); ok++; continue }
            }
            ignored.add(t)
        }
        instr = ins
        return "{\"applied\":" + ok + ",\"ignored\":[" + ignored.joinToString(",") { esc(it) } + "]}"
    }

    // ===== apprentissage =====
    private fun doSetLearned(json: String): String {
        val d: dynamic = JSON.parse<dynamic>(if (json.isEmpty()) "{}" else json)
        val qa = ArrayList<Learned>()
        val uc = ArrayList<UserCourse>()
        if (d.qa != undefined) {
            for (i in 0 until (d.qa.length as Int)) {
                val x = d.qa[i]
                val t = sig(norm((x.q ?: "") as String), 3)
                val a = (x.a ?: "") as String
                if (t.isNotEmpty() && a.isNotEmpty()) qa.add(Learned(a, t))
            }
        }
        if (d.courses != undefined) {
            for (i in 0 until (d.courses.length as Int)) {
                val x = d.courses[i]
                val s = (x.s ?: "") as String; val c = (x.c ?: "") as String; val t = (x.t ?: "") as String
                if (s.isNotEmpty() && c.isNotEmpty() && t.isNotEmpty()) uc.add(UserCourse(s, c, t))
            }
        }
        learned = qa; userCourses = uc
        rebuild()
        return "{\"qa\":" + qa.size + ",\"courses\":" + uc.size + "}"
    }

    private fun matchLearned(n: String): Learned? {
        val mt = sig(n, 3)
        var best: Learned? = null
        var bs = 0.0
        for (q in learned) {
            val inter = q.t.count { mt.contains(it) }
            val sc = inter.toDouble() / q.t.size
            if (sc >= 0.75 && (q.t.size > 1 || mt.size <= 3)) {
                val b = best
                if (sc > bs || (sc == bs && b != null && q.t.size > b.t.size)) { best = q; bs = sc }
            }
        }
        return best
    }

    private fun matchFact(n: String): Fact? {
        val mt = sig(n, 3)
        if (mt.isEmpty()) return null
        for (f in instr.facts) {
            val inter = mt.count { f.t.contains(it) }
            if (inter >= 2 && inter.toDouble() / mt.size >= 0.34) return f
        }
        return null
    }

    // ===== réponse principale =====
    private fun doReply(input: String): String {
        var raw = input.trim()
        if (raw.length > 600) raw = raw.substring(0, 600)
        if (raw.isEmpty()) return out("Je vous écoute. Posez votre question sur l'emploi, le recrutement, ou demandez un cours.", fallbackChips, "fallback", "")
        val n = norm(raw)
        val pad = " $n "
        val toks = n.split(" ")
        val sfr = safety(pad)
        if (sfr != null) return sfr

        val nm = Regex("(?:je m['’ ]appelle|mon nom est|moi c['’]est|mon pr[ée]nom est)\\s+([A-Za-zÀ-ÿ-]{2,20})", RegexOption.IGNORE_CASE).find(raw)
        if (nm != null) {
            st.name = cap(nm.groupValues[1].lowercase())
            if (toks.size <= 6) return out("Enchanté, " + st.name + " ! Êtes-vous candidat(e) ou recruteur ? Je vous guide selon votre besoin.", intents[0].chips, "intent", "greeting")
        }
        if (st.quiz != null) {
            if (toks.size <= 4 && !raw.contains("?")) { val q = quizStep(n, toks); if (q != null) return q } else st.quiz = null
        }
        for (f in instr.forbidden) if (has(pad, f)) return out(pick("refuse", refuse), fallbackChips, "refuse", "")
        for (r in instr.rules) for (k in r.kws) if (has(pad, k)) return out(r.answer, ArrayList(), "rule", "")
        val lq = matchLearned(n)
        if (lq != null) return out(lq.a, ArrayList(), "learned", "")
        val fc = matchFact(n)
        if (fc != null) return out("Voici l'information de l'agence : " + fc.txt, ArrayList(), "rule", "")
        val cr = courseTurn(n, pad, toks)
        if (cr != null) return cr
        val fu = followUp(n, toks)
        if (fu != null) return fu

        val best = score(pad, toks)
        if (best == null || best.score < 4.0) { val sr = sectorTurn(n, toks); if (sr != null) return sr }
        val lb = lifeScore(pad, toks)
        val cs = if (best != null) best.score else 0.0
        val ls = if (lb != null) lb.score else 0.0
        if (lb != null && ls >= 2.0 && ls > cs && cs < 4.0) return composeLife(lb.t)
        if (best != null && cs >= 2.0) return compose(best.def)
        if (lb != null && ls >= 2.0) return composeLife(lb.t)
        val ll = st.lastLife
        if (ll != null && toks.size <= 12) { val lc = lifeMore(ll, true); if (lc != null) return lc }
        return out(pick("lfb", lifeFallback), fallbackChips, "fallback", "")
    }

    // ===== sécurité (urgences, détresse) : prioritaire sur tout =====
    private fun safety(pad: String): String? {
        for (k in crisisKw) if (has(pad, k)) return out(crisisTxt, ArrayList(), "safety", "crisis")
        for (k in violenceKw) if (has(pad, k)) return out(violenceTxt, ArrayList(), "safety", "violence")
        for (k in emergencyKw) if (has(pad, k)) return out(emergencyTxt, ArrayList(), "safety", "emergency")
        return null
    }

    // ===== moteur « vie courante » =====
    private fun lifeScore(pad: String, toks: List<String>): LScored? {
        var best: LScored? = null
        for (i in lifeTopics.indices) {
            val sc = kwScore(lifeKw[i], pad, toks)
            val b = best
            if (sc > 0 && (b == null || sc > b.score)) best = LScored(lifeTopics[i], sc)
        }
        return best
    }

    private fun composeLife(t: LifeTopic): String {
        if (t.id == "datetime") return dateTime(t)
        val core = pick("lc" + t.id, t.core)
        val detail = pick("ld" + t.id, t.detail)
        val tip = pick("lt" + t.id, t.tip)
        val emo = if (chance(emojiChance())) " " + pick("emo", emojis) else ""
        var text: String
        if (t.light) text = core + " " + detail + "\n\n" + tip + emo
        else {
            var op = pick("lop", lifeOpeners)
            if (st.name.isNotEmpty() && chance(30)) op = st.name + ", " + lowerFirst(op)
            text = op + " " + core + "\n\n" + pick("lbr", lifeBridges) + " " + detail + " " + tip + "\n\n" + pick("la" + t.id, t.ask) + " " + pick("lcl", lifeClosers) + emo
        }
        if (t.note.isNotEmpty()) text += "\n\nℹ️ " + t.note
        st.last = t.id
        st.lastLife = t.id
        st.used[t.id] = ArrayList()
        return out(text, t.chips, "life", t.id)
    }

    private fun lifeMore(id: String, ack: Boolean): String? {
        val t = lifeTopics.firstOrNull { it.id == id } ?: return null
        if (t.light || t.id == "datetime") return null
        val used = st.used.getOrPut(id) { ArrayList() }
        var idx = 0
        var g = 0
        do { idx = rng.next(t.detail.size); g++ } while (used.contains(idx) && used.size < t.detail.size && g < 20)
        used.add(idx)
        st.lastLife = id
        st.last = id
        if (ack) return out(pick("lak", lifeAcks) + " " + pick("la" + id, t.ask) + " " + pick("lcl", lifeClosers), t.chips, "life", id)
        return out(pick("lbr", lifeBridges) + " " + t.detail[idx] + " " + pick("lt" + id, t.tip) + "\n\n" + pick("la" + id, t.ask) + " " + pick("lcl", lifeClosers), t.chips, "life", id)
    }

    private fun dateTime(t: LifeTopic): String {
        val d = Date()
        val h = d.getHours()
        val m = d.getMinutes()
        val day = d.getDate()
        val txt = "Il est " + h + " h " + (if (m < 10) "0" else "") + m + ", d'après l'horloge de votre appareil.\nNous sommes le " +
            lifeDays[d.getDay()] + " " + (if (day == 1) "1er" else day.toString()) + " " + lifeMonths[d.getMonth()] + " " + d.getFullYear() + "."
        st.last = t.id
        return out(txt, t.chips, "life", t.id)
    }

    private fun kwScore(kws: List<String>, pad: String, toks: List<String>): Double {
        var sc = 0.0
        for (kw in kws) {
            if (kw.contains(" ")) { if (has(pad, kw)) sc += 2.0 * kw.split(" ").size }
            else if (toks.contains(kw)) sc += 2.0
            else if (kw.length >= 5 && toks.any { it.length > kw.length && it.startsWith(kw) }) sc += 1.5
        }
        return sc
    }

    private fun score(pad: String, toks: List<String>): Scored? {
        var best: Scored? = null
        for (i in intents.indices) {
            val sc = kwScore(intentKw[i], pad, toks)
            val b = best
            if (sc > 0 && (b == null || sc > b.score)) best = Scored(intents[i], sc)
        }
        return best
    }

    private fun compose(it: Intent): String {
        val id = it.id
        var core = fill(pick("c$id", it.core))
        val detail = fill(pick("d$id", it.detail))
        val tip = fill(pick("t$id", it.tip))
        val emo = if (chance(emojiChance())) " " + pick("emo", emojis) else ""
        val text: String
        if (it.light) text = "$core $detail\n\n$tip$emo"
        else {
            var op = pick("op", openers)
            if (st.name.isNotEmpty() && chance(40)) op = st.name + ", " + lowerFirst(op)
            if (id == "identity" && instr.name.isNotEmpty()) core = "Je m'appelle " + instr.name + ". " + core
            text = op + " " + core + "\n\n" + pick("br", bridges) + " " + detail + " " + tip + "\n\n" + pick("cl", closers) + emo
        }
        st.last = id
        st.lastLife = null
        st.used[id] = ArrayList()
        return out(text, it.chips, "intent", id)
    }

    private fun startsWithAnyWord(toks: List<String>, list: List<String>): Boolean =
        toks.size <= 3 && list.any { toks[0] == firstWord(it) }

    private fun followUp(n: String, toks: List<String>): String? {
        val pad = " $n "
        if (toks.size <= 3 && anyPhrase(pad, no) && startsWithAnyWord(toks, no))
            return out("Très bien. Je reste disponible : posez-moi une question sur l'emploi, le recrutement ou demandez un cours.", fallbackChips, "intent", "")
        if (startsWithAnyWord(toks, yes)) {
            val ll = st.lastLife
            if (ll != null) { val lm = lifeMore(ll, false); if (lm != null) return lm }
            val it = intents.firstOrNull { x -> x.id == st.last }
            if (it == null || it.light) return out("Avec plaisir. Sur quel sujet souhaitez-vous des détails : l'inscription, les offres, les frais, un conseil ou un cours ?", fallbackChips, "intent", "")
            val used = st.used.getOrPut(it.id) { ArrayList() }
            var idx = 0
            var g = 0
            do { idx = rng.next(it.detail.size); g++ } while (used.contains(idx) && used.size < it.detail.size && g < 20)
            used.add(idx)
            val tp = pick("t" + it.id, it.tip)
            return out(pick("br", bridges) + " " + fill(it.detail[idx]) + " " + fill(tp) + "\n\n" + pick("cl", closers), it.chips, "intent", it.id)
        }
        return null
    }

    // ===== secteurs & métiers =====
    private fun sectorTurn(n: String, toks: List<String>): String? {
        val cue = listOf("metier", "metiers", "secteur", "secteurs", "poste", "postes", "emploi", "emplois", "travail", "travailler", "job", "domaine", "cherche", "liste", "exemple", "exemples", "quels")
        val hasCue = toks.any { cue.contains(it) }
        for (s in sectors) {
            val st2 = sig(norm(s), 4)
            var hit = 0
            var big = false
            for (w in st2) if (toks.contains(w)) { hit++; if (w.length >= 5) big = true }
            if (hit == 0 || !big) continue
            val ratio = hit.toDouble() / st2.size
            if ((ratio == 1.0 && toks.size <= st2.size + 3) || (ratio >= 0.5 && hasCue)) {
                val list = sectorMap[s] ?: continue
                val shown = distinct(list, minOf(6, list.size)).map { PAREN.replace(it, "") }
                val txt = pick("sct", sectorTpl).replace("{secteur}", s).replace("{n}", list.size.toString())
                    .replace("{liste}", shown.joinToString(", ")) + " " + pick("scl", sectorTail)
                st.last = "sectors"
                st.lastLife = null
                return out(txt, sectorChips, "intent", "sectors")
            }
        }
        var bm: Metier? = null
        for (m in metiers) {
            if (m.t.isEmpty()) continue
            val all = m.t.all { toks.contains(it) }
            val b = bm
            if (all && (toks.size <= m.t.size + 3 || hasCue) && (b == null || m.t.size > b.t.size)) bm = m
        }
        if (bm != null) {
            st.last = "sectors"
            st.lastLife = null
            return out(pick("mtp", metierTpl).replace("{metier}", PAREN.replace(bm.m, "")).replace("{secteur}", bm.s) + " " + pick("scl", sectorTail), sectorChips, "intent", "sectors")
        }
        return null
    }

    // ===== cours universitaires =====
    private class Cand(val e: Entry, val sM: Boolean, val cM: Boolean)
    private class Found(val kind: String, val entry: Entry?, val subject: String, val list: List<Entry>)

    private fun findCourse(toks: List<String>, cue: Boolean): Found? {
        fun inT(w: String): Boolean = toks.any { t -> t == w || (w.length >= 5 && t.length >= 5 && (t.startsWith(w) || w.startsWith(t))) }
        var cands = ArrayList<Cand>()
        for (e in entries) {
            val sM = e.sT.isNotEmpty() && e.sT.all { inT(it) }
            val cM = e.cT.isNotEmpty() && e.cT.all { inT(it) }
            if (sM || cM) cands.add(Cand(e, sM, cM))
        }
        if (cands.isEmpty()) return null
        val both = cands.filter { it.sM && it.cM }.sortedByDescending { it.e.sT.size + it.e.cT.size }.firstOrNull()
        if (both != null) return Found("chapter", both.e, "", emptyList())
        var bS = 0
        var bC = 0
        for (c in cands) {
            if (c.sM && c.e.sT.size > bS) bS = c.e.sT.size
            if (c.cM && c.e.cT.size > bC) bC = c.e.cT.size
        }
        if (bS > bC) cands = ArrayList(cands.filter { it.sM })
        val chap = cands.filter { it.cM }
        if (chap.isNotEmpty() && cue) {
            val c0 = st.course
            val ctx = if (st.menu.isNotEmpty()) st.menu else (c0?.entry?.subject ?: "")
            val inCtx = chap.firstOrNull { it.e.subject == ctx }
            if (inCtx != null) return Found("chapter", inCtx.e, "", emptyList())
            if (chap.size == 1) return Found("chapter", chap[0].e, "", emptyList())
            return Found("ambiguous", null, "", chap.map { it.e })
        }
        val subs = cands.filter { it.sM }.sortedByDescending { it.e.sT.size }
        if (subs.isNotEmpty()) {
            val sub = subs[0].e.subject
            val sl = sig(norm(sub), 4).size
            if (cue || toks.size <= sl + 1) return Found("subject", null, sub, emptyList())
        }
        return null
    }

    private fun courseTurn(n: String, pad: String, toks: List<String>): String? {
        val strong = anyPhrase(pad, courseWords)
        val soft = anyPhrase(pad, softWords)
        val cue = strong || soft
        val cs = st.course
        if (cs != null) {
            if (startsWithAnyWord(toks, yes) || (toks.size <= 3 && anyPhrase(pad, nextWords))) return nextSection()
            if (anyPhrase(pad, quizWords)) return gotoSection("quiz")
            if (has(pad, "exercice") || has(pad, "exercices")) return gotoSection("exercice")
            if (has(pad, "resume") || has(pad, "synthese") || has(pad, "bilan")) return gotoSection("synthese")
            if (has(pad, "complet") || pad.contains(" en entier ")) return fullCourse()
            if (has(pad, "stop") || has(pad, "arrete") || has(pad, "quitter") || has(pad, "terminer")) {
                st.course = null
                return out("Très bien, nous arrêtons le cours ici. Vous pouvez en reprendre un autre quand vous voulez.", listOf("Un cours", "Comment ça marche ?"), "course", "")
            }
            if (pad.contains(" chapitres ") && (has(pad, "autres") || has(pad, "autre"))) return subjectMenu(cs.entry.subject)
        }
        val m = findCourse(toks, cue)
        if (m != null) {
            if (m.kind == "chapter") return startChapter(m.entry!!)
            if (m.kind == "subject") return subjectMenu(m.subject)
            return out("Plusieurs matières proposent ce chapitre. Laquelle choisissez-vous ?",
                m.list.take(6).map { "Cours " + disp(it.subject) + " " + disp(it.chapter) }, "course", "")
        }
        if (strong) return coursesMenu()
        return null
    }

    private fun coursesMenu(): String {
        val ch = distinct(subjects, 6).map { "Cours " + disp(it) }
        st.menu = ""
        return out("📚 Je peux vous donner des cours détaillés : " + entries.size + " chapitres dans " + subjects.size +
            " matières (droit, gestion, médecine, ingénierie, lettres, sciences, arts, agriculture…).\n\nDites par exemple « cours de comptabilité » ou « cours droit du travail dérivation ». Voici quelques idées :", ch, "course", "")
    }

    private fun subjectMenu(subject: String): String {
        val list = entries.filter { it.subject == subject }
        st.menu = subject
        st.course = null
        val lines = list.mapIndexed { i, e -> (i + 1).toString() + ". " + disp(e.chapter) }.joinToString("\n")
        return out("📚 " + disp(subject) + " — chapitres disponibles :\n" + lines + "\n\nChoisissez un chapitre pour démarrer le cours.",
            list.map { "Cours : " + disp(it.chapter) }, "course", "")
    }

    private fun buildSections(e: Entry): List<Section> {
        val mat = disp(e.subject)
        val chap = disp(e.chapter)
        fun f(s: String) = s.replace("{matiere}", mat).replace("{chap}", chap)
        val ss = splitSentences(e.text)
        val def = if (ss.isNotEmpty()) ss[0] else e.text
        val exRe = Regex("^exemple", RegexOption.IGNORE_CASE)
        val toolRe = Regex("^(outils|m[ée]thode|principe)", RegexOption.IGNORE_CASE)
        val ex = ss.filter { exRe.containsMatchIn(it) }
        val tools = ss.filter { toolRe.containsMatchIn(it) }
        val others = ss.filter { it != def && !ex.contains(it) && !tools.contains(it) }
        var disc = ""
        val ns = norm(e.subject)
        for (d in disclaimers) if (disc.isEmpty() && d.first.any { ns.contains(it) }) disc = "\n\n" + d.second
        val secs = ArrayList<Section>()
        secs.add(Section("Introduction", "📘 $mat — $chap\n" + f(pick("ci", cIntro)) + "\n\n🎯 " + f(pick("co", cObj)) + disc, null))
        secs.add(Section("Notions clés", "📖 Notions clés\n• Définition : " + def + others.take(6).joinToString("") { "\n• $it" }, null))
        secs.add(Section("Exemple",
            if (ex.isNotEmpty()) "💡 Exemple concret\n" + ex[0] + "\n\nÀ vous : refaites cet exemple avec vos propres données, puis modifiez une valeur et observez ce qui change."
            else "💡 À illustrer\nCe chapitre ne contient pas d'exemple chiffré. Imaginez une situation réelle de votre quotidien ou de votre métier où cette notion s'applique, puis décrivez-la en deux phrases.\n\nNotion à illustrer : $def", null))
        secs.add(Section("Méthode", "🛠️ Méthode et outils\n" +
            (if (tools.isNotEmpty()) tools.joinToString(" ") else "Méthode générale : 1) définir précisément le problème, 2) choisir l'outil adapté, 3) appliquer pas à pas, 4) vérifier le résultat."), null))
        secs.add(Section("Pièges", "⚠️ Pièges à éviter\n" + f(pick("cp", cPit)) + "\n" + f(pick("cp", cPit)), null))
        secs.add(Section("Exercice", "✍️ Exercice\n" + f(pick("ce", cEx)), null))
        val qs = makeQuiz(e.text)
        if (qs.isNotEmpty()) secs.add(Section("Quiz", "", qs))
        secs.add(Section("Synthèse", "🧾 Synthèse\n" + f(pick("cs", cSyn)) + "\n\n" + f(pick("cg", cPlus)), null))
        return secs
    }

    private fun makeQuiz(text: String): List<QuizQ> {
        val qs = ArrayList<QuizQ>()
        val bad = listOf("quelque", "plusieurs", "souvent", "toujours", "pendant", "chaque", "depuis", "ensemble", "quelques", "exemple", "outils", "lorsque", "comme", "entre")
        val wordRe = Regex("^[A-Za-zÀ-ÿ-]+$")
        val sepRe = Regex("[\\s,;:()«»]+")
        for (s in splitSentences(text)) {
            if (qs.size >= 3) break
            if (s.length < 50 || s.lowercase().startsWith("exemple")) continue
            var tgt = ""
            for (w in s.split(sepRe)) {
                val wn = norm(w)
                if (wordRe.matches(w) && wn.length >= 7 && !bad.contains(wn) && wn.length > norm(tgt).length) tgt = w
            }
            if (tgt.isEmpty()) continue
            qs.add(QuizQ(s.replace(tgt, "_____"), norm(tgt), tgt))
        }
        return qs
    }

    private fun secOut(c: CourseState, i: Int): String {
        val s = c.sections[i]
        var txt = s.x
        var chips: List<String> = listOf("Suite ▶", "Quiz", "Autres chapitres")
        val qz = s.quiz
        if (qz != null) {
            st.quiz = QuizState(qz, 0, 0)
            txt = "🧠 Quiz — 1/" + qz.size + "\nComplétez le mot manquant :\n" + qz[0].q
            chips = listOf("Passer le quiz")
        }
        return out("[" + (i + 1) + "/" + c.sections.size + "] " + txt, chips, "course", "")
    }

    private fun startChapter(e: Entry): String {
        val c = CourseState(e, buildSections(e), 0)
        st.course = c; st.menu = e.subject; st.last = "course"; st.lastLife = null
        return secOut(c, 0)
    }

    private fun nextSection(): String {
        val c = st.course ?: return coursesMenu()
        if (c.i + 1 < c.sections.size) { c.i++; return secOut(c, c.i) }
        val list = entries.filter { it.subject == c.entry.subject }
        val pos = list.indexOf(c.entry)
        val chips = ArrayList<String>()
        if (pos >= 0 && pos + 1 < list.size) chips.add("Cours : " + disp(list[pos + 1].chapter))
        chips.add("Autres chapitres"); chips.add("Un cours")
        st.course = null
        return out("🎓 Chapitre « " + disp(c.entry.chapter) + " » terminé. Bravo ! Pour fixer les acquis, refaites l'exercice demain sans notes." +
            (if (chips[0].startsWith("Cours :")) "\n\nSouhaitez-vous poursuivre avec le chapitre suivant ?" else ""), chips, "course", "")
    }

    private fun gotoSection(name: String): String? {
        val c = st.course ?: return null
        for (i in c.sections.indices) {
            val s = c.sections[i]
            if (norm(s.t) == name || (name == "quiz" && s.quiz != null) || (name == "synthese" && s.t == "Synthèse")) { c.i = i; return secOut(c, i) }
        }
        return out("Il n'y a pas de quiz pour ce chapitre. Tapez « suite » pour continuer.", listOf("Suite ▶"), "course", "")
    }

    private fun fullCourse(): String? {
        val c = st.course ?: return null
        val txt = c.sections.filter { it.quiz == null }.joinToString("\n\n") { it.x }
        c.i = c.sections.size - 1
        return out(txt, listOf("Quiz", "Autres chapitres", "Un cours"), "course", "")
    }

    private fun quizStep(n: String, toks: List<String>): String? {
        val qz = st.quiz ?: return null
        if (toks.size <= 3 && (n == "passer le quiz" || n == "passer" || n == "stop" || n == "arrete" || n == "suite")) { st.quiz = null; return nextSection() }
        val cur = qz.qs[qz.i]
        val ans = cur.a
        val ok = n == ans || toks.contains(ans) || (ans.length >= 6 && toks.any { lev(it, ans) <= 1 })
        if (ok) qz.score++
        val fb = if (ok) "✅ Exact !" else "❌ Pas tout à fait. Réponse attendue : « " + cur.raw + " »."
        qz.i++
        if (qz.i < qz.qs.size)
            return out(fb + "\n\n🧠 Quiz — " + (qz.i + 1) + "/" + qz.qs.size + "\nComplétez le mot manquant :\n" + qz.qs[qz.i].q, listOf("Passer le quiz"), "quiz", "")
        st.quiz = null
        return out(fb + "\n\n🏁 Score : " + qz.score + "/" + qz.qs.size +
            (if (qz.score == qz.qs.size) " — parfait !" else " — relisez la section « Notions clés » puis retentez le quiz."), listOf("Suite ▶", "Quiz", "Autres chapitres"), "quiz", "")
    }
}

private fun createShamanEngine(lexicon: String, courses: String, seed: Int): ShamanEngine = ShamanEngine(lexicon, courses, seed)

/** Point d'entrée : expose la fabrique au navigateur (window.createShamanEngine). */
fun main() {
    val g: dynamic = js("globalThis")
    val factory: dynamic = { l: String, c: String, s: Int -> createShamanEngine(l, c, s) }
    g.createShamanEngine = factory
}
