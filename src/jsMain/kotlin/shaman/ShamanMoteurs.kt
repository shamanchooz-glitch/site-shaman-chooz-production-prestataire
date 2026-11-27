package shaman.moteurs

// ============================================================================
// SHAMAN CHOOZ PRODUCTION — les 8 moteurs thématiques et leur orchestrateur.
// Un seul fichier, à déposer à côté de ShamanEngine.kt (src/jsMain/kotlin/shaman/).
// Le « package » est shaman.moteurs ; ShamanEngine.kt l'importe.
//
// Contenu (dans l'ordre) : modèles, interface MoteurSms, outils de texte et de gabarits,
// chargement des données (shaman-lexicon.json, clé « moteurs »), assembleur de réponses,
// moteur de base, les 7 moteurs à blocs (Professionnel, Personnel, Familial, Couple, Social,
// Finance, Recrutement), ActualiteMoteur (données en direct + cache), état de conversation,
// journal de debug, analyse du message, routeur, contrôle qualité, AssistantSmsOrchestrateur.
// ============================================================================

import kotlin.js.Date
import kotlin.math.floor
import kotlin.math.pow
import kotlin.random.Random

// ============================================================================
// Modeles
// ============================================================================
/**
 * Modèles de données partagés par les 8 moteurs, le routeur et l'orchestrateur.
 * Kotlin standard uniquement (compatible Kotlin/JS) : aucune dépendance externe.
 */

/** Taille d'un SMS (règle par défaut) et nombre maximal de SMS par réponse. */
const val LIMITE_SMS = 160
const val MAX_PARTIES = 3

/** Ton de la réponse. */
enum class Ton { AMICAL, PROFESSIONNEL, RASSURANT }

/** Tutoiement ou vouvoiement. */
enum class Politesse { TUTOIEMENT, VOUVOIEMENT }

/** Émotion détectée dans le message. */
enum class Emotion {
    NEUTRE, POSITIVE, TRISTE, ANXIEUX, COLERE, DETRESSE;

    /** Vrai pour les émotions qui appellent de l'empathie. */
    val negative: Boolean get() = this == TRISTE || this == ANXIEUX || this == COLERE || this == DETRESSE
}

/** Niveau d'urgence perçu. */
enum class Urgence { AUCUNE, NORMALE, ELEVEE, CRITIQUE }

/**
 * Les 8 domaines couverts. [libelleDe] sert aux questions de clarification ("du travail ou de la famille ?"),
 * [libelleCourt] aux boutons proposés et aux préfixes ("Côté couple :").
 */
enum class Domaine(val libelleDe: String, val libelleCourt: String) {
    PROFESSIONNEL("du travail", "travail"),
    PERSONNEL("de la vie personnelle", "vie perso"),
    FAMILIAL("de la famille", "famille"),
    COUPLE("du couple", "couple"),
    SOCIAL("de la vie sociale", "vie sociale"),
    FINANCE("de l'argent", "argent"),
    RECRUTEMENT("du recrutement", "recrutement"),
    ACTUALITE("de l'actualité", "actualité"),
    CASTING("du casting et du spectacle", "casting"),
    ETUDES("des études", "études"),
    NUMERIQUE("du numérique", "numérique"),
    DEMARCHES("des démarches administratives", "démarches"),
    BUSINESS("du business", "business"),
    LOGEMENT("du logement", "logement"),
    IMAGE("de l'image et de la prise de parole", "image"),
    MANAGEMENT("du management", "management")
}

/** Les 8 blocs qui composent une réponse. */
enum class BlocType { OUVERTURE, EMPATHIE, INFORMATION, CONSEIL, ACTION, ENCOURAGEMENT, QUESTION, CLOTURE }

/** COURT = 1 SMS (160 caractères). DETAILLE = jusqu'à 3 SMS. */
enum class ModeReponse { COURT, DETAILLE }

/** Variables dynamiques de la conversation. */
data class Profil(
    val prenom: String? = null,
    val ton: Ton = Ton.AMICAL,
    val politesse: Politesse = Politesse.VOUVOIEMENT,
    /** Ville habituelle de la personne (utile pour la météo). */
    val ville: String? = null
)

/**
 * Un échange passé. [variantes] garde les modèles de blocs employés : c'est ce qui permet
 * l'anti-répétition sans état caché.
 */
data class Echange(
    val message: String,
    val reponse: String,
    val domaine: Domaine? = null,
    val theme: String? = null,
    val variantes: Map<BlocType, String> = emptyMap(),
    /** Éléments concrets du message (mots-clés), pour garder le fil. */
    val elements: List<String> = emptyList()
)

/** Contexte transmis à un moteur : profil, historique (10 derniers échanges) et résultat de l'analyse. */
data class Contexte(
    val profil: Profil = Profil(),
    val historique: List<Echange> = emptyList(),
    /** Sous-sujet verrouillé (id de thème) : repli quand le message ne le nomme pas. */
    val theme: String? = null,
    val emotion: Emotion = Emotion.NEUTRE,
    val urgence: Urgence = Urgence.AUCUNE,
    /** Éléments concrets du message courant. */
    val elements: List<String> = emptyList(),
    val mode: ModeReponse = ModeReponse.COURT,
    /** Force un bloc INFORMATION qui reprend l'élément du message (utilisé par le contrôle qualité). */
    val forcerReference: Boolean = false,
    /** Si renseigné, seuls ces blocs sont utilisés (rôle de moteur secondaire). */
    val blocsImposes: List<BlocType>? = null,
    /** Texte placé au début de la réponse (ex. "Côté couple :"). */
    val prefixe: String = "",
    val maxParties: Int = MAX_PARTIES
) {
    /** Modèles de ce bloc déjà utilisés dans les [profondeur] derniers échanges. */
    fun variantesRecentes(bloc: BlocType, profondeur: Int): Set<String> =
        historique.takeLast(profondeur).mapNotNull { it.variantes[bloc] }.toSet()
}

/** Résultat de la détection : domaine, thème (null si inconnu), confiance 0..1 et éléments repérés. */
data class Intention(
    val domaine: Domaine,
    val theme: String?,
    val confiance: Double,
    val elements: List<String> = emptyList()
)

/** Réponse d'un moteur : une liste de SMS (3 maximum) et ce qu'il faut mémoriser. */
data class ReponseSms(
    val parties: List<String>,
    val domaine: Domaine,
    val theme: String?,
    val variantes: Map<BlocType, String> = emptyMap(),
    /** La question posée à la personne, mémorisée dans l'état de conversation. */
    val question: String? = null,
    val elements: List<String> = emptyList(),
    val blocs: List<BlocType> = emptyList(),
    /** Vrai si la réponse repose sur des données en direct (météo, actualité). */
    val donnees: Boolean = false,
    val secondaire: Domaine? = null
) {
    val texte: String get() = parties.joinToString(" ")
}

// ============================================================================
// MoteurSms
// ============================================================================
/**
 * Contrat commun des 8 moteurs.
 * Les appels sont synchrones : les données en direct (ActualiteMoteur) sont préchargées avant
 * l'appel, dans un cache (voir ActualiteMoteur.precharger).
 */
interface MoteurSms {
    /** Domaine géré par ce moteur. */
    val domaine: Domaine

    /** Score de confiance (0..1) que ce message relève de ce moteur, avec le thème détecté. */
    fun detecterIntention(message: String, contexte: Contexte = Contexte()): Intention

    /** Construit la réponse SMS (1 à 3 parties, 160 caractères chacune). */
    fun repondre(message: String, contexte: Contexte = Contexte()): ReponseSms

    /** Nombre de réponses complètes (8 blocs, un modèle par bloc) que ce moteur peut assembler. */
    fun nombreCombinaisons(): Long
}

// ============================================================================
// Texte
// ============================================================================
/** Un mot du message : forme minuscule, forme normalisée (sans accents) et forme d'origine (majuscules gardées). */
data class Jeton(val raw: String, val norm: String, val orig: String)

/** Une correspondance entre un mot-clé et le message. [jeton] est null pour une expression de plusieurs mots. */
class Correspondance(val motCle: String, val poids: Double, val jeton: Jeton?, val position: Int)

/**
 * Outils de traitement du texte, sans dépendance (compatible Kotlin/JS) :
 * normalisation, découpage en mots, recherche de mots-clés, mise en forme SMS.
 */
object Texte {
    private const val ACC = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ"
    private const val PLN = "aaaaaaceeeeiiiinooooouuuuyyoa"
    private val NON_ALNUM = Regex("[^a-z0-9]+")
    private val ESPACES = Regex("\\s+")

    /** Mots-outils ignorés quand on cherche l'élément concret d'un message. */
    private val OUTILS: Set<String> = (
        "le la les un une des du de d l au aux et ou mais donc or ni car que qu quoi qui quel quelle quels quelles " +
            "ce cet cette ces se sa son ses mon ma mes ton ta tes notre nos votre vos leur leurs je j tu il elle on " +
            "nous vous ils elles me m te t lui y en a ai as avons avez ont suis es est sommes etes sont etait ete " +
            "etre avoir fait faire pas ne n plus tres trop bien mal tout tous toute toutes si oui non ok sur sous " +
            "dans par pour avec sans chez vers entre comme alors ainsi aussi encore deja jamais toujours peu beaucoup " +
            "ca cela ceci voila c s comment pourquoi quand veux voudrais peux pouvez puis dois faut faudrait " +
            "bonjour bonsoir salut merci svp aide aider besoin question probleme chose choses demain aujourd hui " +
            "ce cette soir matin semaine"
        ).split(" ").toSet()

    /** Minuscules, sans accents, ponctuation remplacée par des espaces ("L'été" -> "l ete"). */
    fun normaliser(brut: String): String {
        val sb = StringBuilder()
        for (c in brut.lowercase()) {
            val k = ACC.indexOf(c)
            sb.append(if (k >= 0) PLN[k] else c)
        }
        return NON_ALNUM.replace(sb.toString(), " ").trim()
    }

    /** Découpe en mots ; une liste de mots-clés séparés par des virgules devient une liste normalisée. */
    fun liste(csv: String): List<String> =
        csv.split(",").map { normaliser(it) }.filter { it.isNotEmpty() }

    fun jetons(message: String): List<Jeton> {
        val out = ArrayList<Jeton>()
        var debut = -1
        for (i in 0..message.length) {
            val estMot = i < message.length && message[i].isLetterOrDigit()
            if (estMot) {
                if (debut < 0) debut = i
            } else if (debut >= 0) {
                val brut = message.substring(debut, i)
                val n = normaliser(brut)
                if (n.isNotEmpty()) out.add(Jeton(brut.lowercase(), n, brut))
                debut = -1
            }
        }
        return out
    }

    /**
     * Cherche des mots-clés (déjà normalisés) dans un message.
     *  - mot isolé de 4 lettres ou plus : correspond au début d'un mot ("licenci" -> "licenciement") ;
     *  - mot de 3 lettres ou moins : correspondance exacte ;
     *  - expression de plusieurs mots : doit apparaître telle quelle (poids 1,5).
     */
    fun chercher(motsCles: List<String>, jetons: List<Jeton>, texteNorm: String): List<Correspondance> {
        val texte = " $texteNorm"
        val res = ArrayList<Correspondance>()
        for (mot in motsCles) {
            if (mot.contains(' ')) {
                if (texte.contains(" $mot")) res.add(Correspondance(mot, 1.5, null, -1))
            } else {
                var trouve = -1
                for (j in jetons.indices) {
                    val tn = jetons[j].norm
                    val ok = if (mot.length <= 3) tn == mot else tn.startsWith(mot)
                    if (ok) { trouve = j; break }
                }
                if (trouve >= 0) res.add(Correspondance(mot, 1.0, jetons[trouve], trouve))
            }
        }
        return res
    }

    /** Repli : le mot le plus long et le plus parlant du message (pas un mot-outil). */
    fun elementSignificatif(jetons: List<Jeton>): String? {
        var best: Jeton? = null
        for (t in jetons) {
            val b = best
            if (t.norm.length >= 4 && !OUTILS.contains(t.norm) && (b == null || t.norm.length > b.norm.length)) best = t
        }
        return best?.raw
    }

    fun majuscule(s: String): String = if (s.isEmpty()) s else s.substring(0, 1).uppercase() + s.substring(1)

    /** Met la première lettre en minuscule (après un préfixe "Côté couple :"), sauf sigle ou majuscule isolée. */
    fun minuscule(s: String): String {
        if (s.length > 1 && s[0].isUpperCase() && s[1].isLowerCase()) return s.substring(0, 1).lowercase() + s.substring(1)
        return s
    }

    /** Remplace les caractères typographiques qui font basculer un SMS en Unicode, et resserre les espaces. */
    fun nettoyerPourSms(t: String): String {
        val sb = StringBuilder()
        for (c in t) {
            when (c) {
                '’', '‘' -> sb.append('\'')
                '«', '»', '“', '”' -> sb.append('"')
                '…' -> sb.append("...")
                '–', '—' -> sb.append('-')
                '\u00A0', '\u202F' -> sb.append(' ')
                else -> sb.append(c)
            }
        }
        return ESPACES.replace(sb.toString(), " ").trim()
    }

    /** Découpe en SMS de [limite] caractères au plus, à la frontière des mots ; [max] parties au maximum. */
    fun decouper(texte: String, limite: Int, max: Int): List<String> {
        val parts = ArrayList<String>()
        for (mot0 in texte.trim().split(" ")) {
            if (mot0.isEmpty()) continue
            val mot = if (mot0.length > limite) mot0.substring(0, limite) else mot0
            if (parts.isNotEmpty() && parts[parts.size - 1].length + 1 + mot.length <= limite) {
                parts[parts.size - 1] = parts[parts.size - 1] + " " + mot
            } else {
                parts.add(mot)
            }
        }
        return parts.take(max)
    }
}

// ============================================================================
// Gabarit
// ============================================================================
/**
 * Mini-langage de gabarits utilisé par tous les blocs de réponse.
 *
 *  - `{prenom}`   : prénom de la personne (retiré proprement s'il est inconnu) ;
 *  - `{sujet}`    : sous-sujet détecté, toujours de la forme "ton entretien" / "ta situation" ;
 *  - `{element}`  : mot concret repris du message de la personne ;
 *  - `<tu|vous>`  : première forme au tutoiement, seconde au vouvoiement (ex. `<peux|pouvez>`) ;
 *  - `[a|b|c]`    : ton AMICAL | PROFESSIONNEL | RASSURANT (ex. `[Salut|Bonjour|Bonjour]`).
 *
 * Règles d'écriture : pas d'imbrication ; jamais de "de {sujet}" (contraction "du/de la") ;
 * élisions écrites en entier dans les alternatives (`<t'écoute|vous écoute>`).
 */
object Gabarit {
    private val POLITESSE = Regex("<([^<>|]*)\\|([^<>|]*)>")
    private val TON = Regex("\\[([^\\[\\]|]*)\\|([^\\[\\]|]*)\\|([^\\[\\]|]*)\\]")
    private val ESPACES = Regex("\\s+")
    private val AVANT_VIRGULE_POINT = Regex("\\s+([,.])")

    /** Remplace tous les marqueurs d'un [modele] et renvoie un texte prêt pour un SMS. */
    fun rendre(
        modele: String,
        prenom: String?,
        sujet: String,
        element: String,
        ton: Ton,
        politesse: Politesse,
        extra: Map<String, String> = emptyMap(),
        sansMajuscule: Boolean = false
    ): String {
        var t = modele.replace("{sujet}", sujet).replace("{element}", element)
        for ((cle, valeur) in extra) t = t.replace("{" + cle + "}", valeur)
        t = if (prenom == null || prenom.isBlank()) retirerPrenom(t) else t.replace("{prenom}", prenom)
        t = POLITESSE.replace(t) { m -> if (politesse == Politesse.TUTOIEMENT) m.groupValues[1] else m.groupValues[2] }
        val indice = when (ton) {
            Ton.AMICAL -> 1
            Ton.PROFESSIONNEL -> 2
            Ton.RASSURANT -> 3
        }
        t = TON.replace(t) { m -> m.groupValues[indice] }
        t = ESPACES.replace(t, " ")
        t = AVANT_VIRGULE_POINT.replace(t) { m -> m.groupValues[1] }.trim()
        t = Texte.nettoyerPourSms(t)
        return if (sansMajuscule) t else Texte.majuscule(t)
    }

    private fun retirerPrenom(t0: String): String {
        var t = t0
        if (t.startsWith("{prenom}, ")) t = t.substring(10)
        return t.replace(", {prenom}", "").replace(" {prenom}", "").replace("{prenom}", "")
    }

    /** Vrai s'il reste un marqueur non résolu dans [texte] (utilisé par le contrôle qualité). */
    fun contientMarqueur(texte: String): Boolean {
        for (c in texte) if (c == '{' || c == '}' || c == '<' || c == '>' || c == '[' || c == ']' || c == '|') return true
        return false
    }
}

// ============================================================================
// DonneesMoteurs
// ============================================================================
/** Données d'un sous-sujet (lues dans shaman-lexicon.json, clé « moteurs »). */
class DonneesTheme(
    val id: String, val libelle: String, val mots: String,
    val conseils: List<String>, val actions: List<String>
)

/** Données d'un domaine : mots généraux, sous-sujets et 8 blocs de phrases. */
class DonneesDomaine(
    val id: String, val mots: String,
    val themes: List<DonneesTheme>, val blocs: Map<BlocType, List<String>>
)

/** Réglages de l'actualité en direct (URL des services, durée de validité du cache, relais d'actualité). */
class ConfigActualite(
    val meteoUrl: String, val geoUrl: String, var proxy: String,
    val cacheMin: Map<String, Double>, val perimeMaxH: Map<String, Double>, val libelleCat: Map<String, String>
)

class DonneesMoteurs(
    val domaines: List<DonneesDomaine>,
    val analyse: Map<String, String>,
    val messages: Map<String, List<String>>,
    val actualite: ConfigActualite,
    /** « Ponts » : boutons qui renvoient vers les réponses de l'agence (profil, documents, contact…), par domaine. */
    val ponts: Map<String, List<String>> = emptyMap(),
    /** Boutons proposés à l'accueil et quand le sujet est à préciser. */
    val chips: List<String> = emptyList()
)

/** Lit la clé « moteurs » du lexique (objet JSON déjà analysé). */
object ChargeurDonnees {
    private fun chaines(d: dynamic): List<String> {
        val out = ArrayList<String>()
        if (d == null || d == undefined) return out
        val n = d.length as Int
        for (i in 0 until n) out.add(d[i] as String)
        return out
    }

    private fun cles(o: dynamic): List<String> = chaines(js("Object").keys(o))

    private fun texte(d: dynamic, defaut: String): String =
        if (d == null || d == undefined) defaut else d as String

    private fun nombres(o: dynamic): Map<String, Double> {
        val out = HashMap<String, Double>()
        if (o == null || o == undefined) return out
        for (k in cles(o)) out[k] = (o[k] as Number).toDouble()
        return out
    }

    fun depuis(m: dynamic): DonneesMoteurs {
        val domaines = ArrayList<DonneesDomaine>()
        val arr = m.domaines
        for (i in 0 until (arr.length as Int)) {
            val d = arr[i]
            val themes = ArrayList<DonneesTheme>()
            val ta = d.themes
            for (j in 0 until (ta.length as Int)) {
                val t = ta[j]
                themes.add(DonneesTheme(t.id as String, t.libelle as String, t.mots as String, chaines(t.conseils), chaines(t.actions)))
            }
            val blocs = HashMap<BlocType, List<String>>()
            for (b in BlocType.values()) blocs[b] = chaines(d.blocs[b.name])
            domaines.add(DonneesDomaine(d.id as String, d.mots as String, themes, blocs))
        }
        val analyse = HashMap<String, String>()
        for (k in cles(m.analyse)) analyse[k] = m.analyse[k] as String
        val messages = HashMap<String, List<String>>()
        for (k in cles(m.messages)) messages[k] = chaines(m.messages[k])
        val a = m.actualite
        val cat = HashMap<String, String>()
        if (a.libelleCat != undefined) for (k in cles(a.libelleCat)) cat[k] = a.libelleCat[k] as String
        val cfg = ConfigActualite(texte(a.meteoUrl, ""), texte(a.geoUrl, ""), texte(a.proxy, ""), nombres(a.cacheMin), nombres(a.perimeMaxH), cat)
        val ponts = HashMap<String, List<String>>()
        if (m.ponts != undefined && m.ponts != null) for (k in cles(m.ponts)) ponts[k] = chaines(m.ponts[k])
        val chips: List<String> = if (m.chips != undefined && m.chips != null) chaines(m.chips) else emptyList()
        return DonneesMoteurs(domaines, analyse, messages, cfg, ponts, chips)
    }
}

// ============================================================================
// Assembleur
// ============================================================================
/**
 * Un sous-sujet précis d'un domaine (ex. "entretien" pour le travail).
 * @param libelle   gabarit du sujet, toujours à la forme possessive : `<ton|votre> entretien`
 * @param motsCles  mots-clés séparés par des virgules (début de mot si 4 lettres ou plus, exact sinon ; expression = 1,5 point)
 * @param conseils  conseils propres à ce sujet, mêlés aux conseils génériques du moteur
 * @param actions   actions concrètes propres à ce sujet
 */
class ThemeDef(
    val id: String,
    val libelle: String,
    motsCles: String,
    val conseils: List<String>,
    val actions: List<String>
) {
    val motsNorm: List<String> = Texte.liste(motsCles).distinct()
}

/**
 * Les 8 blocs d'un moteur, avec au moins 15 variantes chacun.
 * Le nombre de réponses complètes possibles est le produit des tailles : 15^8 = 2 562 890 625.
 */
class BanqueDeBlocs(private val blocs: Map<BlocType, List<String>>) {
    fun variantes(type: BlocType): List<String> = blocs[type] ?: emptyList()

    /** Nombre de réponses complètes (un modèle par bloc). */
    fun nombreCombinaisons(): Long {
        var total = 1L
        for (type in BlocType.values()) total *= variantes(type).size.toLong()
        return total
    }

    /** Liste des anomalies de données (bloc trop court, doublon) ; vide si tout va bien. */
    fun problemes(): List<String> {
        val out = ArrayList<String>()
        for (type in BlocType.values()) {
            val v = variantes(type)
            if (v.size < 15) out.add("bloc " + type.name + " : " + v.size + " variantes (minimum 15)")
            if (v.toSet().size != v.size) out.add("bloc " + type.name + " : doublons")
        }
        return out
    }
}

/** Un modèle choisi et sa version rendue. */
class Choix(val modele: String, val texte: String)

/**
 * Assemble une réponse SMS à partir des blocs d'un moteur.
 *  - COURT : 1 SMS de 160 caractères, blocs choisis par priorité tant qu'ils tiennent ;
 *  - DETAILLE : les 8 blocs, répartis sur 3 SMS au plus ; les blocs les moins utiles sont sacrifiés si ça déborde ;
 *  - anti-répétition : on évite les modèles employés dans les 3 derniers échanges (au minimum le dernier) ;
 *  - un seul prénom par réponse.
 */
class AssembleurDeReponses(
    private val domaine: Domaine,
    val banque: BanqueDeBlocs,
    private val hasard: Random
) {
    companion object {
        const val SUJET_GENERIQUE = "<ta|votre> situation"

        /** Ordre dans lequel on abandonne des blocs quand une réponse détaillée déborde. */
        private val SACRIFICE = listOf(
            BlocType.CLOTURE, BlocType.OUVERTURE, BlocType.ENCOURAGEMENT,
            BlocType.INFORMATION, BlocType.EMPATHIE, BlocType.ACTION, BlocType.QUESTION
        )
    }

    /** Sujet rendu (ex. "ton entretien d'embauche"), sans majuscule initiale. */
    fun sujetRendu(theme: ThemeDef?, ctx: Contexte): String =
        Gabarit.rendre(theme?.libelle ?: SUJET_GENERIQUE, null, "", "", ctx.profil.ton, ctx.profil.politesse, emptyMap(), true)

    /** Élément concret à reprendre : message courant, sinon message précédent, sinon le sujet. */
    fun elementRendu(ctx: Contexte, sujet: String): String {
        if (ctx.elements.isNotEmpty()) return ctx.elements[0]
        for (e in ctx.historique.asReversed()) if (e.elements.isNotEmpty()) return e.elements[0]
        return sujet
    }

    private fun candidats(
        modeles: List<String>, ecartes: Set<String>, ctx: Contexte, restant: Int,
        prenom: String?, sujet: String, element: String
    ): List<Choix> {
        val out = ArrayList<Choix>()
        for (m in modeles) {
            if (ecartes.contains(m)) continue
            val t = Gabarit.rendre(m, prenom, sujet, element, ctx.profil.ton, ctx.profil.politesse)
            if (t.length <= restant) out.add(Choix(m, t))
        }
        return out
    }

    /**
     * Choisit une variante du bloc [type] qui tient dans [restant] caractères, sans répéter les récentes.
     * Pour CONSEIL et ACTION, on préfère (50 %) les variantes propres au thème.
     */
    fun choisir(
        type: BlocType, theme: ThemeDef?, ctx: Contexte, restant: Int,
        prenom: String?, sujet: String, element: String
    ): Choix? {
        val specifiques: List<String> = when (type) {
            BlocType.CONSEIL -> theme?.conseils ?: emptyList()
            BlocType.ACTION -> theme?.actions ?: emptyList()
            else -> emptyList()
        }
        val generiques = banque.variantes(type)
        // 1er passage : on écarte les 3 derniers échanges ; 2e passage : seulement le dernier.
        val passes = listOf(ctx.variantesRecentes(type, 3), ctx.variantesRecentes(type, 1))
        for (ecartes in passes) {
            val spec = candidats(specifiques, ecartes, ctx, restant, prenom, sujet, element)
            val gene = candidats(generiques, ecartes, ctx, restant, prenom, sujet, element)
            val pool = if (spec.isNotEmpty() && (gene.isEmpty() || hasard.nextDouble() < 0.5)) spec else gene
            if (pool.isNotEmpty()) return pool[hasard.nextInt(pool.size)]
        }
        return null
    }

    /** Ordre de priorité des blocs pour un SMS unique. */
    private fun planCourt(ctx: Contexte): List<BlocType> {
        val p = ArrayList<BlocType>()
        if (ctx.emotion.negative) p.add(BlocType.EMPATHIE)
        if (ctx.forcerReference) p.add(BlocType.INFORMATION)
        p.add(BlocType.CONSEIL)
        p.add(BlocType.QUESTION)
        if (!ctx.forcerReference) p.add(BlocType.INFORMATION)
        p.add(BlocType.ACTION)
        if (ctx.historique.isEmpty()) p.add(BlocType.OUVERTURE)
        p.add(BlocType.ENCOURAGEMENT)
        p.add(BlocType.CLOTURE)
        return p
    }

    private fun planDetaille(ctx: Contexte): List<BlocType> =
        BlocType.values().filter { !(it == BlocType.EMPATHIE && ctx.emotion == Emotion.POSITIVE) }

    /** Répartit les blocs sur des SMS de 160 caractères ; null si ça dépasse [max] SMS. */
    private fun empaqueter(blocs: List<Pair<BlocType, String>>, prefixe: String, max: Int): List<String>? {
        val parts = ArrayList<String>()
        for ((i, b) in blocs.withIndex()) {
            val t = if (i == 0 && prefixe.isNotEmpty()) prefixe + " " + Texte.minuscule(b.second) else b.second
            if (parts.isNotEmpty() && parts[parts.size - 1].length + 1 + t.length <= LIMITE_SMS) {
                parts[parts.size - 1] = parts[parts.size - 1] + " " + t
            } else {
                parts.add(t)
            }
        }
        if (parts.isEmpty() || parts.size > max) return null
        for (p in parts) if (p.length > LIMITE_SMS) return null
        return parts
    }

    /** Assemble la réponse du moteur pour le thème [theme] (null si le domaine est connu mais pas le sujet). */
    fun assembler(theme: ThemeDef?, ctx: Contexte): ReponseSms {
        val sujet = sujetRendu(theme, ctx)
        val element = elementRendu(ctx, sujet)
        val prefixe = ctx.prefixe
        val detaille = ctx.blocsImposes == null && ctx.mode == ModeReponse.DETAILLE
        val plan: List<BlocType> = ctx.blocsImposes ?: (if (detaille) planDetaille(ctx) else planCourt(ctx))

        val choisis = LinkedHashMap<BlocType, Choix>()
        var prenom: String? = ctx.profil.prenom
        var longueur = prefixe.length
        for (type in plan) {
            val restant = if (detaille) LIMITE_SMS else LIMITE_SMS - longueur - (if (longueur > 0) 1 else 0)
            if (restant <= 0) break
            val choix = choisir(type, theme, ctx, restant, prenom, sujet, element) ?: continue
            choisis[type] = choix
            val p = prenom
            if (p != null && choix.texte.contains(p)) prenom = null
            longueur += choix.texte.length + 1
        }

        var blocs: List<Pair<BlocType, String>> = BlocType.values()
            .filter { choisis.containsKey(it) }
            .map { Pair(it, choisis.getValue(it).texte) }
        val maxEffectif = if (detaille) ctx.maxParties else 1
        var parts: List<String>? = empaqueter(blocs, prefixe, maxEffectif)
        while (parts == null && blocs.isNotEmpty()) {
            var sacrifie: BlocType? = null
            for (s in SACRIFICE) {
                if (blocs.any { it.first == s }) { sacrifie = s; break }
            }
            if (sacrifie == null) break
            val aRetirer: BlocType = sacrifie
            blocs = blocs.filter { it.first != aRetirer }
            parts = empaqueter(blocs, prefixe, maxEffectif)
        }
        val finale: List<String> = parts ?: Texte.decouper(
            (prefixe + " " + plusCourtConseil(ctx, prenom, sujet, element)).trim(), LIMITE_SMS, maxEffectif
        )

        val gardes = blocs.map { it.first }.toSet()
        val variantes = HashMap<BlocType, String>()
        for ((type, choix) in choisis) if (gardes.contains(type)) variantes[type] = choix.modele
        val question = if (gardes.contains(BlocType.QUESTION)) choisis[BlocType.QUESTION]?.texte else null
        return ReponseSms(
            finale, domaine, theme?.id, variantes, question, ctx.elements,
            BlocType.values().filter { variantes.containsKey(it) }
        )
    }

    /** Filet de sécurité : si aucun bloc ne tient, on prend le conseil le plus court. */
    private fun plusCourtConseil(ctx: Contexte, prenom: String?, sujet: String, element: String): String {
        var best = ""
        for (m in banque.variantes(BlocType.CONSEIL)) {
            val t = Gabarit.rendre(m, prenom, sujet, element, ctx.profil.ton, ctx.profil.politesse)
            if (best.isEmpty() || t.length < best.length) best = t
        }
        return best
    }
}

// ============================================================================
// MoteurThematique
// ============================================================================
/**
 * Base des moteurs à blocs (travail, perso, famille, couple, social, finance, recrutement) ;
 * l'ActualiteMoteur en hérite pour la détection et remplace la composition de la réponse.
 *
 * Détection : chaque mot-clé trouvé rapporte 1 point (1,5 pour une expression) ; les mots généraux
 * du domaine valent 0,7 de leur poids. Confiance = 1 - 0,5^points :
 *   0,7 point -> 0,39 | 1 point -> 0,50 | 2 points -> 0,75 | 3 points -> 0,88.
 * Le thème retenu est celui qui a le plus de points ; s'il n'y en a pas dans le message, on garde
 * le thème verrouillé de la conversation (continuité).
 */
open class MoteurThematique(
    final override val domaine: Domaine,
    donnees: DonneesDomaine,
    protected val hasard: Random
) : MoteurSms {

    companion object {
        const val POIDS_DOMAINE = 0.7
    }

    val themes: List<ThemeDef> = donnees.themes.map { ThemeDef(it.id, it.libelle, it.mots, it.conseils, it.actions) }
    private val motsDomaine: List<String> = Texte.liste(donnees.mots)
    val banque: BanqueDeBlocs = BanqueDeBlocs(donnees.blocs)
    protected val assembleur = AssembleurDeReponses(domaine, banque, hasard)

    override fun detecterIntention(message: String, contexte: Contexte): Intention =
        evaluer(Texte.jetons(message), Texte.normaliser(message), contexte.theme)

    fun themeDe(id: String?): ThemeDef? {
        if (id == null) return null
        for (t in themes) if (t.id == id) return t
        return null
    }

    /** Calcule domaine/thème/confiance/éléments à partir des mots du message. */
    fun evaluer(jetons: List<Jeton>, norm: String, themeVerrouille: String?): Intention {
        val vus = HashSet<String>()
        val corr = ArrayList<Correspondance>()
        var meilleur: ThemeDef? = null
        var meilleurScore = 0.0
        for (t in themes) {
            var score = 0.0
            for (c in Texte.chercher(t.motsNorm, jetons, norm)) {
                score += c.poids
                if (vus.add(c.motCle)) corr.add(c)
            }
            if (score > meilleurScore) {
                meilleurScore = score
                meilleur = t
            }
        }
        for (c in Texte.chercher(motsDomaine, jetons, norm)) {
            if (vus.add(c.motCle)) corr.add(Correspondance(c.motCle, c.poids * POIDS_DOMAINE, c.jeton, c.position))
        }
        var points = 0.0
        for (c in corr) points += c.poids
        val choisi = meilleur
        val themeId = if (choisi != null && (themeVerrouille == null || meilleurScore >= 1.0)) choisi.id else themeVerrouille
        val elements = corr
            .filter { it.jeton != null }
            .sortedBy { it.position }
            .map { it.jeton!!.raw }
            .distinct()
            .take(3)
        return Intention(domaine, themeId, 1.0 - 0.5.pow(points), elements)
    }

    override fun repondre(message: String, contexte: Contexte): ReponseSms {
        val jetons = Texte.jetons(message)
        val intention = evaluer(jetons, Texte.normaliser(message), contexte.theme)
        val theme = themeDe(intention.theme)
        val repli = Texte.elementSignificatif(jetons)
        val elements: List<String> = when {
            contexte.elements.isNotEmpty() -> contexte.elements
            intention.elements.isNotEmpty() -> intention.elements
            repli != null -> listOf(repli)
            else -> emptyList()
        }
        val ctx = contexte.copy(elements = elements)
        var reponse = assembleur.assembler(theme, ctx)
        val dernier = contexte.historique.lastOrNull()?.reponse
        var essais = 0
        // Jamais deux fois exactement le même texte de suite.
        while (essais < 5 && dernier != null && reponse.texte == dernier) {
            reponse = assembleur.assembler(theme, ctx)
            essais++
        }
        return reponse
    }

    override fun nombreCombinaisons(): Long = banque.nombreCombinaisons()
}

// ============================================================================
// ProfessionnelMoteur
// ============================================================================
/**
 * Moteur n°1 : vie professionnelle.
 * Sous-sujets : carrière, conflits, motivation, entretiens, salaire, organisation, contrat (8 sous-sujets).
 * Les mots-clés, les conseils propres à chaque sous-sujet et les 8 blocs de 15 variantes
 * (ouverture, empathie, information, conseil, action, encouragement, question, clôture)
 * sont dans shaman-lexicon.json, clé « moteurs » -> domaine « PROFESSIONNEL » ;
 * 8 blocs x 15 variantes = 2 562 890 625 réponses complètes possibles.
 */
class ProfessionnelMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.PROFESSIONNEL, donnees, hasard)

// ============================================================================
// PersonnelMoteur
// ============================================================================
/**
 * Moteur n°2 : vie personnelle.
 * Sous-sujets : confiance en soi, habitudes, objectifs, moral, stress, sommeil (6 sous-sujets).
 * Les mots-clés, les conseils propres à chaque sous-sujet et les 8 blocs de 15 variantes
 * (ouverture, empathie, information, conseil, action, encouragement, question, clôture)
 * sont dans shaman-lexicon.json, clé « moteurs » -> domaine « PERSONNEL » ;
 * 8 blocs x 15 variantes = 2 562 890 625 réponses complètes possibles.
 */
class PersonnelMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.PERSONNEL, donnees, hasard)

// ============================================================================
// FamilialMoteur
// ============================================================================
/**
 * Moteur n°3 : vie familiale.
 * Sous-sujets : enfants et éducation, parents, fratrie, tensions, belle-famille, proches âgés, organisation (7 sous-sujets).
 * Les mots-clés, les conseils propres à chaque sous-sujet et les 8 blocs de 15 variantes
 * (ouverture, empathie, information, conseil, action, encouragement, question, clôture)
 * sont dans shaman-lexicon.json, clé « moteurs » -> domaine « FAMILIAL » ;
 * 8 blocs x 15 variantes = 2 562 890 625 réponses complètes possibles.
 */
class FamilialMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.FAMILIAL, donnees, hasard)

// ============================================================================
// CoupleMoteur
// ============================================================================
/**
 * Moteur n°4 : vie de couple et sentimentale.
 * Sous-sujets : relation, disputes, confiance, séparation, sentiments, projet de vie à deux, complicité (7 sous-sujets).
 * Les mots-clés, les conseils propres à chaque sous-sujet et les 8 blocs de 15 variantes
 * (ouverture, empathie, information, conseil, action, encouragement, question, clôture)
 * sont dans shaman-lexicon.json, clé « moteurs » -> domaine « COUPLE » ;
 * 8 blocs x 15 variantes = 2 562 890 625 réponses complètes possibles.
 */
class CoupleMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.COUPLE, donnees, hasard)

// ============================================================================
// SocialMoteur
// ============================================================================
/**
 * Moteur n°5 : vie sociale et communautaire.
 * Sous-sujets : amitié, voisinage, associations, isolement, événements (5 sous-sujets).
 * Les mots-clés, les conseils propres à chaque sous-sujet et les 8 blocs de 15 variantes
 * (ouverture, empathie, information, conseil, action, encouragement, question, clôture)
 * sont dans shaman-lexicon.json, clé « moteurs » -> domaine « SOCIAL » ;
 * 8 blocs x 15 variantes = 2 562 890 625 réponses complètes possibles.
 */
class SocialMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.SOCIAL, donnees, hasard)

// ============================================================================
// FinanceMoteur
// ============================================================================
/**
 * Moteur n°6 : gestion financière, comptabilité, budget.
 * Sous-sujets : budget, épargne, dettes, comptabilité, revenus, projet de financement (6 sous-sujets).
 * Les mots-clés, les conseils propres à chaque sous-sujet et les 8 blocs de 15 variantes
 * (ouverture, empathie, information, conseil, action, encouragement, question, clôture)
 * sont dans shaman-lexicon.json, clé « moteurs » -> domaine « FINANCE » ;
 * 8 blocs x 15 variantes = 2 562 890 625 réponses complètes possibles.
 */
class FinanceMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.FINANCE, donnees, hasard)

// ============================================================================
// RecrutementMoteur
// ============================================================================
/**
 * Moteur n°7 : prestation de services, recrutement, placement de personnel.
 * Sous-sujets : besoin de personnel, recherche d'emploi, profils, tarifs, services, suivi de dossier (6 sous-sujets).
 * Les mots-clés, les conseils propres à chaque sous-sujet et les 8 blocs de 15 variantes
 * (ouverture, empathie, information, conseil, action, encouragement, question, clôture)
 * sont dans shaman-lexicon.json, clé « moteurs » -> domaine « RECRUTEMENT » ;
 * 8 blocs x 15 variantes = 2 562 890 625 réponses complètes possibles.
 */
class RecrutementMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.RECRUTEMENT, donnees, hasard)

// ============================================================================
// ActualiteMoteur
// ============================================================================
/**
 * Moteur n°9 : casting, mannequinat, cinéma, figuration et scène.
 * Sous-sujets : dossier de casting, préparation, mannequinat, cinéma et figuration, scène, contrats et cachets.
 * Données (mots-clés, conseils par sous-sujet, 8 blocs de 15 variantes) : shaman-lexicon.json, clé « moteurs », domaine « CASTING ».
 */
class CastingMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.CASTING, donnees, hasard)

/**
 * Moteur n°10 : études, orientation et formation.
 * Sous-sujets : orientation, examens, méthode de travail, financement, stages, reprise d'études.
 * Données (mots-clés, conseils par sous-sujet, 8 blocs de 15 variantes) : shaman-lexicon.json, clé « moteurs », domaine « ETUDES ».
 */
class EtudesMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.ETUDES, donnees, hasard)

/**
 * Moteur n°11 : réseaux sociaux, image en ligne et sécurité numérique.
 * Sous-sujets : sécurité des comptes, arnaques en ligne, visibilité, image en ligne, téléphone.
 * Données (mots-clés, conseils par sous-sujet, 8 blocs de 15 variantes) : shaman-lexicon.json, clé « moteurs », domaine « NUMERIQUE ».
 */
class NumeriqueMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.NUMERIQUE, donnees, hasard)

/**
 * Moteur n°12 : démarches administratives et papiers.
 * Sous-sujets : papiers d'identité, certificats et casier judiciaire, droits au travail, impôts, état civil, permis.
 * Données (mots-clés, conseils par sous-sujet, 8 blocs de 15 variantes) : shaman-lexicon.json, clé « moteurs », domaine « DEMARCHES ».
 */
class DemarchesMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.DEMARCHES, donnees, hasard)

/**
 * Moteur n°13 : business, ventes et clients.
 * Sous-sujets : recherche de clients, prix, publicité, fidélisation, organisation commerciale, développement.
 * Données (mots-clés, conseils par sous-sujet, 8 blocs de 15 variantes) : shaman-lexicon.json, clé « moteurs », domaine « BUSINESS ».
 */
class BusinessMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.BUSINESS, donnees, hasard)

/**
 * Moteur n°14 : logement et vie pratique.
 * Sous-sujets : recherche de logement, bail et propriétaire, déménagement, colocation, réparations.
 * Données (mots-clés, conseils par sous-sujet, 8 blocs de 15 variantes) : shaman-lexicon.json, clé « moteurs », domaine « LOGEMENT ».
 */
class LogementMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.LOGEMENT, donnees, hasard)

/**
 * Moteur n°15 : image, prise de parole et communication.
 * Sous-sujets : prise de parole, tenue, présence et posture, réseau, messages écrits.
 * Données (mots-clés, conseils par sous-sujet, 8 blocs de 15 variantes) : shaman-lexicon.json, clé « moteurs », domaine « IMAGE ».
 */
class ImageMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.IMAGE, donnees, hasard)

/**
 * Moteur n°16 : management et gestion d'équipe.
 * Sous-sujets : diriger une équipe, nouvel employé, délégation, motivation, conflits et discipline, évaluation.
 * Données (mots-clés, conseils par sous-sujet, 8 blocs de 15 variantes) : shaman-lexicon.json, clé « moteurs », domaine « MANAGEMENT ».
 */
class ManagementMoteur(donnees: DonneesDomaine, hasard: Random = Random.Default) :
    MoteurThematique(Domaine.MANAGEMENT, donnees, hasard)

/** Cache à durée de vie : une valeur est « fraîche » pendant [ttlMs], utilisable (périmée mais datée) jusqu'à [perimeMs]. */
class CacheTtl(private val maintenant: () -> Double) {
    class Lecture(val valeur: Any, val ageMs: Double, val frais: Boolean)
    private class Entree(val t: Double, val v: Any)

    private val m = HashMap<String, Entree>()

    fun mettre(cle: String, valeur: Any) { m[cle] = Entree(maintenant(), valeur) }

    fun lire(cle: String, ttlMs: Double, perimeMs: Double): Lecture? {
        val e = m[cle] ?: return null
        val age = maintenant() - e.t
        if (age > perimeMs) return null
        return Lecture(e.v, age, age <= ttlMs)
    }
}

private class Geo(val nom: String, val lat: Double, val lon: Double)
private class MeteoJour(val t: Double, val code: Int, val min: Double, val max: Double, val pluie: Double)
private class ItemActu(val titre: String, val source: String)
private class Actu(val source: String, val items: List<ItemActu>, val maj: Double)

/**
 * Moteur n°8 : actualité, météo, sports, géopolitique, avec données en direct et cache.
 *  - météo : Open-Meteo (géocodage + prévisions), directement depuis le navigateur ;
 *  - sports / infos / international : fichier shaman-actualite.json, mis à jour toutes les heures par GitHub
 *    (actualite-flux.cjs lit des flux RSS) et servi avec le site : aucune clé, aucun serveur à gérer ;
 *  - jamais de donnée inventée : sans connexion (ou sans relais), on le dit honnêtement.
 *
 * La réponse reste synchrone : [precharger] remplit d'abord le cache (asynchrone), puis [repondre] le lit.
 * Rôle des blocs ici : OUVERTURE = introduction des données ; QUESTION = proposition de suite ;
 * ACTION = « pour quelle ville ? » ; EMPATHIE / INFORMATION / CONSEIL = excuse, constat « pas d'info récente »
 * et suggestion quand les données sont indisponibles ; ENCOURAGEMENT et CLOTURE = fins de message.
 */
class ActualiteMoteur(
    donnees: DonneesDomaine,
    hasard: Random,
    private val cfg: ConfigActualite,
    private val maintenant: () -> Double = { Date.now() }
) : MoteurThematique(Domaine.ACTUALITE, donnees, hasard) {

    private val cache = CacheTtl(maintenant)
    private val wmo: Map<Int, String> = mapOf(
        0 to "ciel dégagé", 1 to "plutôt dégagé", 2 to "partiellement nuageux", 3 to "ciel couvert", 45 to "brouillard", 48 to "brouillard givrant",
        51 to "bruine légère", 53 to "bruine", 55 to "bruine forte", 61 to "pluie légère", 63 to "pluie", 65 to "forte pluie",
        66 to "pluie verglaçante", 67 to "pluie verglaçante", 71 to "neige légère", 73 to "neige", 75 to "forte neige", 77 to "grains de neige",
        80 to "averses", 81 to "averses", 82 to "fortes averses", 85 to "averses de neige", 86 to "averses de neige",
        95 to "orage", 96 to "orage avec grêle", 99 to "orage avec grêle"
    )
    private val nonVille: Set<String> = (
        "demain aujourd hui ce cet cette soir matin semaine week end maintenant apres midi la le les un une quel quelle temps meteo"
        ).split(" ").toSet()

    /** Adresse du fichier shaman-actualite.json ; vide = sports/infos indisponibles. */
    fun configurer(proxy: String) { cfg.proxy = proxy.trim() }

    private fun ttl(cat: String): Double = (cfg.cacheMin[cat] ?: 15.0) * 60000.0
    private fun perime(cat: String): Double = (cfg.perimeMaxH[cat] ?: 6.0) * 3600000.0
    private fun arrondi(x: Double): Int = floor(x + 0.5).toInt()
    private fun fixe2(x: Double): String = x.asDynamic().toFixed(2) as String
    private fun cleGeo(ville: String): String = "geo:" + Texte.normaliser(ville)
    private fun cleMeteo(g: Geo): String = "meteo:" + fixe2(g.lat) + "," + fixe2(g.lon)

    /** Ville citée après une préposition ("météo à Abidjan"), sinon ville du profil. */
    fun ville(message: String, ctx: Contexte): String? {
        val toks = Texte.jetons(message)
        val prep = listOf("a", "de", "pour", "sur", "dans", "au", "en", "chez")
        for (i in 0 until toks.size - 1) {
            if (!prep.contains(toks[i].norm)) continue
            var j = i + 1
            if (toks[j].norm == "la" || toks[j].norm == "le" || toks[j].norm == "l") j++
            if (j >= toks.size) continue
            val t = toks[j]
            if (nonVille.contains(t.norm) || t.norm.length < 3) continue
            val nom = ArrayList<String>()
            nom.add(t.orig)
            var k = j + 1
            if (t.orig[0].isUpperCase()) {
                while (k < toks.size && nom.size < 3 && toks[k].orig[0].isUpperCase() && !nonVille.contains(toks[k].norm)) {
                    nom.add(toks[k].orig)
                    k++
                }
            }
            return nom.joinToString(" ")
        }
        return ctx.profil.ville
    }

    // ---------- Données en direct (asynchrone, avec cache) ----------

    /** Lit une adresse avec fetch (6 s maximum). Appelle [fin] avec le texte, ou null en cas d'échec. */
    private fun lire(url: String, fin: (String?) -> Unit) {
        val g: dynamic = js("globalThis")
        if (g.fetch == undefined) { fin(null); return }
        var termine = false
        fun conclure(v: String?) {
            if (!termine) { termine = true; fin(v) }
        }
        try {
            g.setTimeout({ conclure(null) }, 6000)
            val suite = g.fetch(url).then({ r: dynamic -> if (r.ok == true) r.text() else null })
            suite.then({ t: dynamic -> conclure(if (t == null || t == undefined) null else t as String) }, { _: dynamic -> conclure(null) })
        } catch (e: Throwable) {
            conclure(null)
        }
    }

    private fun encoder(s: String): String {
        val f: dynamic = js("encodeURIComponent")
        return f(s) as String
    }

    private fun nombre(x: dynamic, defaut: Double): Double =
        if (x == null || x == undefined) defaut else (x as Number).toDouble()

    private fun analyserGeo(txt: String): Geo? {
        return try {
            val d: dynamic = JSON.parse<dynamic>(txt)
            val r = d.results
            if (r == null || r == undefined || (r.length as Int) == 0) null
            else Geo(r[0].name as String, nombre(r[0].latitude, 0.0), nombre(r[0].longitude, 0.0))
        } catch (e: Throwable) {
            null
        }
    }

    private fun analyserMeteo(txt: String): MeteoJour? {
        return try {
            val d: dynamic = JSON.parse<dynamic>(txt)
            val cur = d.current
            val jour = d.daily
            MeteoJour(
                nombre(cur.temperature_2m, 0.0), nombre(cur.weather_code, -1.0).toInt(),
                nombre(jour.temperature_2m_min[0], 0.0), nombre(jour.temperature_2m_max[0], 0.0),
                nombre(jour.precipitation_probability_max[0], 0.0)
            )
        } catch (e: Throwable) {
            null
        }
    }

    /** Lit shaman-actualite.json : { updated, cats: { sport: { source, updated, items: [{ title, source }] } } }. */
    private fun analyserActu(txt: String): Map<String, Actu> {
        val out = HashMap<String, Actu>()
        try {
            val d: dynamic = JSON.parse<dynamic>(txt)
            val cats = d.cats
            if (cats == undefined || cats == null) return out
            val cles = js("Object").keys(cats)
            for (i in 0 until (cles.length as Int)) {
                val k = cles[i] as String
                val c = cats[k]
                val arr = c.items
                if (arr == undefined || arr == null) continue
                val src = if (c.source == undefined || c.source == null) "" else c.source as String
                val dateTexte = if (c.updated != undefined && c.updated != null) c.updated as String
                    else if (d.updated != undefined && d.updated != null) d.updated as String else ""
                val analyseurDate: dynamic = js("Date.parse")
                val parse: Double = if (dateTexte.isEmpty()) Double.NaN else (analyseurDate(dateTexte) as Number).toDouble()
                val maj: Double = if (parse.isNaN()) maintenant() else parse
                val items = ArrayList<ItemActu>()
                for (j in 0 until (arr.length as Int)) {
                    val x = arr[j]
                    items.add(ItemActu(x.title as String, if (x.source == undefined || x.source == null) src else x.source as String))
                }
                if (items.isNotEmpty()) out[k] = Actu(src, items, maj)
            }
        } catch (e: Throwable) {
            // fichier illisible : on garde le cache précédent
        }
        return out
    }

    private fun chargerMeteo(g: Geo, fin: () -> Unit) {
        val cle = cleMeteo(g)
        if (cache.lire(cle, ttl("meteo"), ttl("meteo")) != null) { fin(); return }
        val url = cfg.meteoUrl + "?latitude=" + g.lat + "&longitude=" + g.lon +
            "&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1"
        lire(url) { txt ->
            val m = if (txt != null) analyserMeteo(txt) else null
            if (m != null) cache.mettre(cle, m)
            fin()
        }
    }

    /** Phase asynchrone : remplit le cache avant la réponse. [fin] est toujours appelé (succès ou non). */
    fun precharger(message: String, ctx: Contexte, fin: () -> Unit) {
        val theme = detecterIntention(message, ctx).theme ?: "infos"
        if (theme == "meteo") {
            val ville = ville(message, ctx)
            if (ville == null) { fin(); return }
            val g = cache.lire(cleGeo(ville), ttl("geo"), ttl("geo"))
            if (g != null) {
                chargerMeteo(g.valeur as Geo, fin)
            } else {
                lire(cfg.geoUrl + "?name=" + encoder(ville) + "&count=1&language=fr&format=json") { txt ->
                    val geo = if (txt != null) analyserGeo(txt) else null
                    if (geo == null) {
                        fin()
                    } else {
                        cache.mettre(cleGeo(ville), geo)
                        chargerMeteo(geo, fin)
                    }
                }
            }
            return
        }
        if (cfg.proxy.isEmpty()) { fin(); return }
        val cle = "actu:" + theme
        if (cache.lire(cle, ttl(theme), ttl(theme)) != null) { fin(); return }
        lire(cfg.proxy) { txt ->
            if (txt != null) for ((k, a) in analyserActu(txt)) cache.mettre("actu:" + k, a)
            fin()
        }
    }

    // ---------- Composition de la réponse (synchrone, à partir du cache) ----------

    private fun age(ms: Double): String {
        val m = arrondi(ms / 60000.0)
        return when {
            m < 2 -> "à l'instant"
            m < 60 -> "il y a $m min"
            m < 1440 -> "il y a " + arrondi(m / 60.0) + " h"
            else -> "il y a " + arrondi(m / 1440.0) + " j"
        }
    }

    private fun tronquer(s0: String, n: Int): String {
        val s = s0.replace(Regex("\\s+"), " ").trim()
        if (s.length <= n) return s
        val c = s.substring(0, n - 1)
        val i = c.lastIndexOf(' ')
        return (if (i > n / 2) c.substring(0, i) else c) + "…"
    }

    override fun repondre(message: String, contexte: Contexte): ReponseSms {
        val themeId = detecterIntention(message, contexte).theme ?: "infos"
        val theme = themeDe(themeId)
        val ton = contexte.profil.ton
        val pol = contexte.profil.politesse
        val sujet = assembleur.sujetRendu(theme, contexte)
        fun choisir(type: BlocType, restant: Int): Choix? = assembleur.choisir(type, theme, contexte, restant, null, sujet, sujet)

        var texte: String? = null
        if (themeId == "meteo") {
            val ville = ville(message, contexte)
            if (ville == null) {
                val q = choisir(BlocType.ACTION, LIMITE_SMS)
                val qt = q?.texte ?: "Pour quelle ville?"
                return ReponseSms(listOf(qt), domaine, themeId, if (q != null) mapOf(BlocType.ACTION to q.modele) else emptyMap(), qt, emptyList(), listOf(BlocType.ACTION))
            }
            val g = cache.lire(cleGeo(ville), ttl("geo"), ttl("geo"))
            val geo = g?.valeur as Geo?
            val m = if (geo != null) cache.lire(cleMeteo(geo), ttl("meteo"), perime("meteo")) else null
            if (geo != null && m != null) {
                val d = m.valeur as MeteoJour
                val conseil = when {
                    d.pluie >= 50 -> " " + Gabarit.rendre("<Prends|Prenez> un parapluie.", null, "", "", ton, pol)
                    d.max >= 33 -> " " + Gabarit.rendre("<Bois|Buvez> beaucoup d'eau.", null, "", "", ton, pol)
                    else -> ""
                }
                texte = "Météo à " + geo.nom + (if (m.frais) "" else " (" + age(m.ageMs) + ")") + " : " +
                    (wmo[d.code] ?: "temps variable") + ", " + arrondi(d.t) + "°C (min " + arrondi(d.min) + ", max " + arrondi(d.max) +
                    "), pluie " + arrondi(d.pluie) + " %." + conseil
            }
        } else if (cfg.proxy.isNotEmpty()) {
            val a = cache.lire("actu:" + themeId, ttl(themeId), perime(themeId))
            val actu = a?.valeur as Actu?
            // ancienneté = date de mise à jour du fichier ; au-delà de la durée de validité : pas d'info récente
            val ageInfo = if (actu != null) maintenant() - actu.maj else 0.0
            if (actu != null && ageInfo <= perime(themeId)) {
                val lib = cfg.libelleCat[themeId] ?: "Actualité"
                val items = actu.items.take(3)
                val src = if (items[0].source.isNotEmpty()) items[0].source else "sources en ligne"
                val corps = items.withIndex().joinToString(" ") { (i, x) -> "" + (i + 1) + ") " + tronquer(x.titre, 78) }
                texte = lib + " (" + src + ", mis à jour " + age(if (ageInfo < 0.0) 0.0 else ageInfo) + ") : " + corps
            }
        }

        val variantes = HashMap<BlocType, String>()
        val blocs = ArrayList<BlocType>()
        if (texte != null) {
            var parts: MutableList<String> = Texte.decouper(texte, LIMITE_SMS, 2).toMutableList()
            val intro = choisir(BlocType.OUVERTURE, 60)
            if (intro != null) {
                variantes[BlocType.OUVERTURE] = intro.modele
                blocs.add(BlocType.OUVERTURE)
                val comb = intro.texte + " " + parts[0]
                if (comb.length <= LIMITE_SMS) {
                    parts[0] = comb
                } else {
                    parts.add(0, intro.texte)
                }
                parts = parts.take(MAX_PARTIES).toMutableList()
            }
            val dernier = parts.size - 1
            var question: String? = null
            val qf = choisir(BlocType.QUESTION, LIMITE_SMS - parts[dernier].length - 1)
            if (qf != null) {
                parts[dernier] = parts[dernier] + " " + qf.texte
                variantes[BlocType.QUESTION] = qf.modele
                question = qf.texte
                blocs.add(BlocType.QUESTION)
            }
            return ReponseSms(parts, domaine, themeId, variantes, question, emptyList(), blocs, true)
        }

        // Pas de donnée récente : on le dit honnêtement (jamais d'invention).
        val out = ArrayList<String>()
        for (type in listOf(BlocType.EMPATHIE, BlocType.INFORMATION, BlocType.CONSEIL)) {
            val c = choisir(type, LIMITE_SMS)
            if (c != null) {
                out.add(c.texte)
                variantes[type] = c.modele
                blocs.add(type)
            }
        }
        return ReponseSms(Texte.decouper(out.joinToString(" "), LIMITE_SMS, 2), domaine, themeId, variantes, null, emptyList(), blocs, false)
    }
}

// ============================================================================
// Conversation
// ============================================================================
/**
 * État de conversation d'une personne : sujet verrouillé, sous-sujet, dernier moteur, ton, politesse,
 * émotion et question en attente (plus quelques repères pour garder le fil).
 */
class EtatConversation {
    var sujetActif: Domaine? = null
    var sousSujet: String? = null
    var dernierMoteur: Domaine? = null
    var ton: Ton = Ton.AMICAL
    var politesse: Politesse = Politesse.VOUVOIEMENT
    var emotion: Emotion = Emotion.NEUTRE
    var questionEnAttente: String? = null
    /** Message ambigu en attente de précision (fusionné avec la réponse de la personne). */
    var messageAClarifier: String? = null
    var domainesProposes: List<Domaine> = emptyList()
    var elementsRecents: List<String> = emptyList()
    var tours: Int = 0

    /** Libère le sujet verrouillé (un autre moteur du chatbot vient de répondre). */
    fun relacher() {
        sujetActif = null; sousSujet = null; questionEnAttente = null; messageAClarifier = null; domainesProposes = emptyList()
    }
}

/** Tout ce qu'on sait d'une personne : état, 10 derniers échanges, prénom, ville. */
class ConversationPersonne {
    val etat = EtatConversation()
    val historique = ArrayList<Echange>()
    var prenom: String? = null
    var ville: String? = null
    var dernierFixe: String? = null

    fun pousser(e: Echange) {
        historique.add(e)
        while (historique.size > 10) historique.removeAt(0)
    }
}

/** Dépôt des conversations (en mémoire ; l'export JSON permet de les garder dans le navigateur). */
class DepotConversation {
    private val m = HashMap<String, ConversationPersonne>()
    fun charger(personne: String): ConversationPersonne {
        var c = m[personne]
        if (c == null) { c = ConversationPersonne(); m[personne] = c }
        return c
    }
    fun existe(personne: String): ConversationPersonne? = m[personne]
    fun oublier(personne: String) { m.remove(personne) }
}

internal fun jsonChaine(s: String): String {
    val sb = StringBuilder("\"")
    for (c in s) {
        when (c) {
            '"' -> sb.append("\\\"")
            '\\' -> sb.append("\\\\")
            '\n' -> sb.append("\\n")
            '\r' -> sb.append("\\r")
            '\t' -> sb.append("\\t")
            else -> if (c < ' ') sb.append("\\u").append(c.code.toString(16).padStart(4, '0')) else sb.append(c)
        }
    }
    sb.append('"')
    return sb.toString()
}

internal fun jsonChaineOuNull(s: String?): String = if (s == null) "null" else jsonChaine(s)
internal fun jsonListe(l: List<String>): String = l.joinToString(",", "[", "]") { jsonChaine(it) }
internal fun fixe2(x: Double): String = x.asDynamic().toFixed(2) as String

/** Export / import JSON d'une conversation (même format que la version JavaScript). */
object ConversationJson {
    fun exporter(c: ConversationPersonne): String {
        val e = c.etat
        val etat = "{\"sujetActif\":" + jsonChaineOuNull(e.sujetActif?.name) + ",\"sousSujet\":" + jsonChaineOuNull(e.sousSujet) +
            ",\"dernierMoteur\":" + jsonChaineOuNull(e.dernierMoteur?.name) + ",\"ton\":" + jsonChaine(e.ton.name) +
            ",\"politesse\":" + jsonChaine(e.politesse.name) + ",\"emotion\":" + jsonChaine(e.emotion.name) +
            ",\"questionEnAttente\":" + jsonChaineOuNull(e.questionEnAttente) + ",\"messageAClarifier\":" + jsonChaineOuNull(e.messageAClarifier) +
            ",\"domainesProposes\":" + jsonListe(e.domainesProposes.map { it.name }) + ",\"elementsRecents\":" + jsonListe(e.elementsRecents) +
            ",\"tours\":" + e.tours + "}"
        val hist = c.historique.joinToString(",", "[", "]") { h ->
            val v = h.variantes.entries.joinToString(",", "{", "}") { jsonChaine(it.key.name) + ":" + jsonChaine(it.value) }
            "{\"message\":" + jsonChaine(h.message) + ",\"reponse\":" + jsonChaine(h.reponse) + ",\"domaine\":" + jsonChaineOuNull(h.domaine?.name) +
                ",\"theme\":" + jsonChaineOuNull(h.theme) + ",\"variantes\":" + v + ",\"elements\":" + jsonListe(h.elements) + "}"
        }
        return "{\"etat\":" + etat + ",\"historique\":" + hist + ",\"profil\":{\"prenom\":" + jsonChaineOuNull(c.prenom) +
            ",\"ville\":" + jsonChaineOuNull(c.ville) + "},\"dernierFixe\":" + jsonChaineOuNull(c.dernierFixe) + "}"
    }

    private fun chaines(d: dynamic): List<String> {
        val out = ArrayList<String>()
        if (d == null || d == undefined) return out
        for (i in 0 until (d.length as Int)) out.add(d[i] as String)
        return out
    }

    private fun texteOuNull(d: dynamic): String? = if (d == null || d == undefined) null else d as String

    private fun domaineOuNull(d: dynamic): Domaine? {
        val s = texteOuNull(d) ?: return null
        for (x in Domaine.values()) if (x.name == s) return x
        return null
    }

    /** Remplit [c] depuis un objet JSON déjà analysé ; renvoie faux si le format est inattendu. */
    fun importer(c: ConversationPersonne, d: dynamic): Boolean {
        return try {
            if (d.etat == undefined || d.historique == undefined) return false
            val e = c.etat
            val s = d.etat
            e.sujetActif = domaineOuNull(s.sujetActif)
            e.sousSujet = texteOuNull(s.sousSujet)
            e.dernierMoteur = domaineOuNull(s.dernierMoteur)
            e.ton = Ton.values().firstOrNull { it.name == texteOuNull(s.ton) } ?: Ton.AMICAL
            e.politesse = Politesse.values().firstOrNull { it.name == texteOuNull(s.politesse) } ?: Politesse.VOUVOIEMENT
            e.emotion = Emotion.values().firstOrNull { it.name == texteOuNull(s.emotion) } ?: Emotion.NEUTRE
            e.questionEnAttente = texteOuNull(s.questionEnAttente)
            e.messageAClarifier = texteOuNull(s.messageAClarifier)
            e.domainesProposes = chaines(s.domainesProposes).mapNotNull { n -> Domaine.values().firstOrNull { it.name == n } }
            e.elementsRecents = chaines(s.elementsRecents)
            e.tours = if (s.tours == undefined) 0 else (s.tours as Number).toInt()
            c.historique.clear()
            val h = d.historique
            val n = h.length as Int
            for (i in maxOf(0, n - 10) until n) {
                val x = h[i]
                val variantes = HashMap<BlocType, String>()
                if (x.variantes != undefined && x.variantes != null) {
                    for (b in BlocType.values()) { val v = x.variantes[b.name]; if (v != undefined && v != null) variantes[b] = v as String }
                }
                c.historique.add(Echange(x.message as String, x.reponse as String, domaineOuNull(x.domaine), texteOuNull(x.theme), variantes, chaines(x.elements)))
            }
            if (d.profil != undefined && d.profil != null) {
                c.prenom = texteOuNull(d.profil.prenom)
                c.ville = texteOuNull(d.profil.ville)
            }
            c.dernierFixe = texteOuNull(d.dernierFixe)
            true
        } catch (ex: Throwable) {
            false
        }
    }
}

// ============================================================================
// JournalDebug
// ============================================================================
/**
 * Journal de debug : pour chaque message, pourquoi tel moteur a été choisi, le score de confiance,
 * le sujet verrouillé, le contrôle qualité. Les 200 dernières lignes sont conservées.
 */
class JournalDebug {
    private val lignes = ArrayList<String>()

    fun ajouter(nouvelles: List<String>) {
        lignes.addAll(nouvelles)
        while (lignes.size > 200) lignes.removeAt(0)
    }

    fun derniers(n: Int): List<String> = lignes.takeLast(n)
}

// ============================================================================
// Analyse
// ============================================================================
/** Résultat de l'étape 3 : tout ce qu'on sait du message avant de choisir un moteur. */
class AnalyseMessage(
    val brut: String,
    val norm: String,
    val toks: List<Jeton>,
    /** Une intention (domaine, sous-sujet, confiance, éléments) par moteur. */
    val candidats: List<Intention>,
    val emotion: Emotion,
    val urgence: Urgence,
    val detresse: Boolean,
    val changement: Boolean,
    /** Reste-t-il un mot significatif en dehors du marqueur « changeons de sujet » ? */
    val resteSignificatif: Boolean,
    val horsDomaine: Boolean,
    val suite: Boolean,
    val detail: Boolean,
    val salutation: Boolean,
    val merci: Boolean,
    val auRevoir: Boolean,
    val medical: Boolean,
    val juridique: Boolean,
    val financier: Boolean,
    val vous: Boolean,
    val tu: Boolean
)

/** Étape 3 : analyse du message (domaines, sujet, intention, émotion, urgence). */
class AnalyseurDeMessage(
    private val moteurs: Map<Domaine, MoteurThematique>,
    private val ordre: List<Domaine>,
    analyse: Map<String, String>
) {
    private val lex: Map<String, List<String>> = analyse.mapValues { Texte.liste(it.value) }

    private fun trouve(cle: String, toks: List<Jeton>, n: String): List<Correspondance> =
        Texte.chercher(lex[cle] ?: emptyList(), toks, n)

    private fun resteApresMarqueur(n: String, marqueurs: List<Correspondance>): Boolean {
        var t = " $n "
        for (m in marqueurs) t = t.replace(m.motCle, " ")
        return Texte.elementSignificatif(Texte.jetons(t)) != null
    }

    fun analyser(message: String, texteAnalyse: String, etat: EtatConversation): AnalyseMessage {
        val toks = Texte.jetons(message)
        val n = Texte.normaliser(message)
        val tAn = Texte.jetons(texteAnalyse)
        val nAn = Texte.normaliser(texteAnalyse)
        val candidats = ordre.map { id ->
            moteurs.getValue(id).evaluer(tAn, nAn, if (id == etat.sujetActif) etat.sousSujet else null)
        }
        val detresse = trouve("detresse", toks, n).isNotEmpty()
        var emo = Emotion.NEUTRE
        if (detresse) {
            emo = Emotion.DETRESSE
        } else {
            val t = trouve("tristesse", toks, n).size
            val a = trouve("anxiete", toks, n).size
            val c = trouve("colere", toks, n).size
            val p = trouve("positive", toks, n).size
            if (t + a + c > 0) {
                emo = if (t >= a && t >= c) Emotion.TRISTE else if (a >= c) Emotion.ANXIEUX else Emotion.COLERE
            } else if (p > 0) {
                emo = Emotion.POSITIVE
            }
        }
        var urgence = Urgence.AUCUNE
        if (detresse) {
            urgence = if (trouve("urgence_critique", toks, n).isNotEmpty()) Urgence.CRITIQUE else Urgence.ELEVEE
        } else if (trouve("urgence_elevee", toks, n).isNotEmpty()) {
            urgence = Urgence.ELEVEE
        }
        val changements = trouve("changement", toks, n)
        val suiteMots = trouve("suite", toks, n).isNotEmpty() && toks.size <= 8
        return AnalyseMessage(
            brut = message, norm = n, toks = toks, candidats = candidats, emotion = emo, urgence = urgence, detresse = detresse,
            changement = changements.isNotEmpty(), resteSignificatif = resteApresMarqueur(n, changements),
            horsDomaine = trouve("hors_domaine", toks, n).isNotEmpty(),
            suite = etat.questionEnAttente != null || toks.size <= 5 || suiteMots,
            detail = trouve("detail", toks, n).isNotEmpty() || message.length > 140 || urgence == Urgence.ELEVEE || urgence == Urgence.CRITIQUE,
            salutation = trouve("salutation", toks, n).isNotEmpty() && toks.size <= 4,
            merci = trouve("remerciement", toks, n).isNotEmpty() && toks.size <= 6,
            auRevoir = trouve("au_revoir", toks, n).isNotEmpty() && toks.size <= 5,
            medical = trouve("medical", toks, n).isNotEmpty(),
            juridique = trouve("juridique", toks, n).isNotEmpty(),
            financier = trouve("financier", toks, n).isNotEmpty(),
            vous = trouve("vous", toks, n).isNotEmpty(),
            tu = trouve("tu", toks, n).isNotEmpty()
        )
    }
}

// ============================================================================
// Routeur
// ============================================================================
enum class TypeDecision { MOTEUR, CLARIFICATION, HORS_DOMAINE }

/** Décision de routage : moteur principal (+ secondaire), sous-sujet, confiance, et pourquoi. */
class Decision(
    var type: TypeDecision = TypeDecision.MOTEUR,
    var principal: Domaine? = null,
    var secondaire: Domaine? = null,
    var theme: String? = null,
    var confiance: Double = 0.0,
    var sujetChange: Boolean = false,
    var verrou: Boolean = false,
    var raison: String = "",
    val scores: Map<Domaine, Double> = emptyMap(),
    var proposes: List<Domaine> = emptyList()
)

/**
 * Étapes 4 et 5 : choix du bon moteur (mots-clés + score de confiance) et verrouillage du sujet.
 *  - confiance >= 0,35 : un moteur répond ; un second moteur (>= 0,45 et >= 60 % du premier) devient « secondaire » ;
 *  - sujet verrouillé : on reste sur le même domaine et sous-sujet tant que la personne n'en change pas
 *    (un autre domaine doit dépasser l'actif d'au moins 0,15 pour prendre la main) ;
 *  - message ambigu ou signal trop faible : UNE question de clarification ; aucun domaine : hors domaine.
 */
class RouteurDeMoteurs(
    private val moteurs: Map<Domaine, MoteurThematique>,
    private val ordre: List<Domaine>
) {
    companion object {
        const val SEUIL_MIN = 0.35
        const val SEUIL_SECOND = 0.45
        const val MARGE_CHANGEMENT = 0.15
    }

    private fun arrondi2(x: Double): Double = floor(x * 100.0 + 0.5) / 100.0

    fun router(an: AnalyseMessage, etat: EtatConversation, message: String): Decision {
        val scores = HashMap<Domaine, Double>()
        for (x in an.candidats) scores[x.domaine] = arrondi2(x.confiance)
        val dec = Decision(scores = scores)
        val tri = an.candidats.sortedByDescending { it.confiance }
        val best = tri[0]
        val second = tri[1]
        val actif = etat.sujetActif
        fun par(d: Domaine): Intention = an.candidats.first { it.domaine == d }

        // réponse à une question de clarification : on choisit parmi les domaines proposés
        if (etat.messageAClarifier != null) {
            var rep: Domaine? = null
            var rs = 0.0
            val nm = Texte.normaliser(message)
            val jetons = Texte.jetons(message)
            val candidatsReponse = if (etat.domainesProposes.isNotEmpty()) etat.domainesProposes else ordre
            for (id in candidatsReponse) {
                val m = moteurs.getValue(id)
                val s = m.evaluer(jetons, nm, null).confiance + (if (nm.contains(Texte.normaliser(id.libelleCourt))) 0.6 else 0.0)
                if (s > rs) { rs = s; rep = id }
            }
            val choisi = rep
            if (choisi != null) {
                val x = par(choisi)
                dec.principal = choisi
                dec.theme = x.theme
                dec.confiance = maxOf(x.confiance, SEUIL_MIN)
                dec.raison = "réponse à la clarification (" + choisi.name + ")"
                dec.sujetChange = choisi != actif
                return dec
            }
        }

        if (actif != null && !an.changement) {
            val sa = par(actif).confiance
            val bascule = best.domaine != actif && best.confiance >= SEUIL_MIN && best.confiance - sa >= MARGE_CHANGEMENT
            val horsSujet = best.confiance < SEUIL_MIN &&
                (an.horsDomaine || (message.contains("?") && an.toks.size > 3 && sa == 0.0))
            if (!horsSujet && !bascule) {
                dec.principal = actif
                dec.theme = par(actif).theme ?: etat.sousSujet
                dec.confiance = maxOf(sa, SEUIL_MIN)
                dec.verrou = true
                val autre = tri.firstOrNull { it.domaine != actif && it.confiance >= SEUIL_SECOND }
                if (autre != null) dec.secondaire = autre.domaine
                dec.raison = "sujet verrouillé sur " + actif.name + (if (dec.theme != null) "/" + dec.theme else "") +
                    (if (autre != null) " ; secondaire " + autre.domaine.name else "")
                return dec
            }
            if (bascule) {
                dec.principal = best.domaine
                dec.theme = best.theme
                dec.confiance = best.confiance
                dec.sujetChange = true
                if (sa >= SEUIL_SECOND) dec.secondaire = actif
                dec.raison = "changement de sujet : " + actif.name + " -> " + best.domaine.name
                return dec
            }
        }

        if (best.confiance < SEUIL_MIN && an.changement && !an.resteSignificatif) {
            dec.type = TypeDecision.CLARIFICATION
            dec.proposes = emptyList()
            dec.raison = "changement de sujet demandé, nouveau sujet à préciser"
            return dec
        }
        if (best.confiance < SEUIL_MIN) {
            if (an.horsDomaine || best.confiance == 0.0) {
                dec.type = TypeDecision.HORS_DOMAINE
                dec.raison = "aucun domaine reconnu (meilleur " + best.domaine.name + " " + arrondi2(best.confiance) + ")"
                return dec
            }
            dec.type = TypeDecision.CLARIFICATION
            dec.proposes = if (second.confiance > 0.0) listOf(best.domaine, second.domaine) else listOf(best.domaine)
            dec.raison = "signal trop faible"
            return dec
        }
        if (best.confiance < 0.5 && second.confiance >= SEUIL_MIN && best.confiance - second.confiance < 0.1) {
            dec.type = TypeDecision.CLARIFICATION
            dec.proposes = listOf(best.domaine, second.domaine)
            dec.raison = "message ambigu entre " + best.domaine.name + " et " + second.domaine.name
            return dec
        }
        dec.principal = best.domaine
        dec.theme = best.theme
        dec.confiance = best.confiance
        dec.sujetChange = actif != null && actif != best.domaine
        if (second.confiance >= SEUIL_SECOND && second.confiance >= 0.6 * best.confiance) dec.secondaire = second.domaine
        dec.raison = "meilleur score " + best.domaine.name + (if (dec.secondaire != null) " ; message mixte, secondaire " + dec.secondaire!!.name else "")
        return dec
    }
}

// ============================================================================
// ControleQualite
// ============================================================================
class ResultatQualite(val ok: Boolean, val motifs: List<String>)

/**
 * Étape 7 : contrôle qualité avant envoi (zéro hors-sujet).
 *  - 1 à 3 SMS, aucun vide, aucun de plus de 160 caractères, aucun marqueur de gabarit non résolu ;
 *  - la réponse reprend au moins un élément concret du message (sauf actualité, pilotée par les données) ;
 *  - cohérence avec le sujet verrouillé et avec le dernier échange ;
 *  - jamais le même texte qu'un des 3 derniers échanges ;
 *  - aucune formulation de diagnostic ou d'avis juridique définitif.
 */
class ControleQualite(private val moteurs: Map<Domaine, MoteurThematique>) {
    private val diag: List<String> = listOf(
        "vous avez une depression", "tu as une depression", "vous souffrez de", "tu souffres de", "c est une maladie", "vous etes malade",
        "tu es malade", "vous allez gagner votre proces", "tu vas gagner ton proces", "c est illegal", "vous devez porter plainte",
        "tu dois porter plainte", "vous etes coupable", "tu es coupable"
    )

    fun verifier(rep: ReponseSms, an: AnalyseMessage, dec: Decision, conv: ConversationPersonne): ResultatQualite {
        val motifs = ArrayList<String>()
        val texte = rep.parties.joinToString(" ")
        val nt = Texte.normaliser(texte)
        val h = conv.historique
        if (rep.parties.isEmpty() || rep.parties.size > MAX_PARTIES) motifs.add("nombre de SMS invalide (" + rep.parties.size + ")")
        for (p in rep.parties) if (p.isBlank() || p.length > LIMITE_SMS) motifs.add("SMS vide ou trop long (" + p.length + ")")
        if (Gabarit.contientMarqueur(texte)) motifs.add("marqueur de gabarit non résolu")
        if (rep.domaine != Domaine.ACTUALITE) {
            val termes = ArrayList<String>()
            for (e in rep.elements) termes.add(Texte.normaliser(e))
            if (h.isNotEmpty()) for (e in h[h.size - 1].elements) termes.add(Texte.normaliser(e))
            val th = moteurs.getValue(rep.domaine).themeDe(rep.theme)
            if (th != null) {
                val lib = Texte.normaliser(Gabarit.rendre(th.libelle, null, "", "", Ton.AMICAL, Politesse.VOUVOIEMENT))
                for (w in lib.split(" ")) if (w.length >= 5 && w != "situation" && w != "votre") termes.add(w)
            }
            val utiles = termes.filter { it.isNotEmpty() }
            if (utiles.isNotEmpty() && utiles.none { nt.contains(it) }) motifs.add("aucun élément concret du message repris")
        }
        if (dec.verrou && !dec.sujetChange && !an.changement && rep.domaine != conv.etat.sujetActif) motifs.add("incohérent avec le sujet verrouillé")
        for (e in h.takeLast(3)) if (Texte.normaliser(e.reponse) == nt) motifs.add("même texte qu'un échange récent")
        for (d in diag) if (nt.contains(d)) motifs.add("formulation de diagnostic/avis définitif")
        return ResultatQualite(motifs.isEmpty(), motifs)
    }
}

// ============================================================================
// AssistantSmsOrchestrateur
// ============================================================================
enum class TypeResultat { MOTEUR, CLARIFICATION, HORS_DOMAINE, DETRESSE, FIXE, VIDE }

/** Politesse : fixe (par défaut le vouvoiement, règle de l'agence) ou suivre celle de la personne. */
enum class ModePolitesse { VOUVOIEMENT, TUTOIEMENT, AUTO }

class OptionsAssistant(
    var politesse: ModePolitesse = ModePolitesse.VOUVOIEMENT,
    /** Ton imposé ; null = automatique (rassurant si émotion négative, sinon selon le domaine). */
    var tonFixe: Ton? = null,
    /** Numéros d'urgence du pays, cités dans le message de soutien en cas de danger immédiat (ex. "112"). */
    var numerosUrgence: String = ""
)

/** Résultat d'un traitement : les SMS à envoyer, ce qui a été décidé, et le journal de debug. */
class ResultatTraitement(
    val type: TypeResultat,
    val parties: List<String>,
    val domaine: Domaine? = null,
    val theme: String? = null,
    val secondaire: Domaine? = null,
    val confiance: Double = 0.0,
    val sujetChange: Boolean = false,
    val chips: List<String> = emptyList(),
    val question: String? = null,
    /** Vrai si le message est hors domaine et qu'on laisse les autres moteurs du chatbot essayer. */
    val passe: Boolean = false,
    val donnees: Boolean = false,
    var journal: List<String> = emptyList()
) {
    val texte: String get() = parties.joinToString(" ")
}

/**
 * Orchestrateur des 8 moteurs. Pour chaque message reçu, dans l'ordre :
 *  1. normaliser le texte ; 2. charger l'historique (10 échanges) et l'état de la personne ;
 *  3. analyser (domaine, sujet, intention, émotion, urgence) ; 4. router avec un score de confiance (moteur principal + secondaire) ;
 *  5. verrouiller le sujet ; 6. appeler le ou les moteurs ; 7. contrôle qualité (jusqu'à 8 tentatives) ;
 *  8. mettre à jour l'état. Détresse grave : soutien et orientation vers un proche ou un professionnel, avant tout.
 */
class AssistantSmsOrchestrateur(
    donnees: DonneesMoteurs,
    val options: OptionsAssistant = OptionsAssistant(),
    seed: Int = 0,
    maintenant: () -> Double = { Date.now() }
) {
    private val hasard: Random = if (seed != 0) Random(seed) else Random.Default
    private val ordre: List<Domaine> = donnees.domaines.mapNotNull { d -> Domaine.values().firstOrNull { it.name == d.id } }
    private val ponts: Map<String, List<String>> = donnees.ponts
    private val chipsAccueil: List<String> = donnees.chips
    private val moteurs: Map<Domaine, MoteurThematique>
    private val messages: Map<String, List<String>> = donnees.messages
    private val analyseur: AnalyseurDeMessage
    private val routeur: RouteurDeMoteurs
    private val controle: ControleQualite
    private val depot = DepotConversation()
    val journal = JournalDebug()
    private var numero = 0
    private val espaces = Regex("\\s+")

    init {
        val m = LinkedHashMap<Domaine, MoteurThematique>()
        for (d in donnees.domaines) {
            val dom = Domaine.values().firstOrNull { it.name == d.id } ?: continue // domaine inconnu de cette version : ignoré
            m[dom] = when (dom) {
                Domaine.PROFESSIONNEL -> ProfessionnelMoteur(d, hasard)
                Domaine.PERSONNEL -> PersonnelMoteur(d, hasard)
                Domaine.FAMILIAL -> FamilialMoteur(d, hasard)
                Domaine.COUPLE -> CoupleMoteur(d, hasard)
                Domaine.SOCIAL -> SocialMoteur(d, hasard)
                Domaine.FINANCE -> FinanceMoteur(d, hasard)
                Domaine.RECRUTEMENT -> RecrutementMoteur(d, hasard)
                Domaine.ACTUALITE -> ActualiteMoteur(d, hasard, donnees.actualite, maintenant)
                Domaine.CASTING -> CastingMoteur(d, hasard)
                Domaine.ETUDES -> EtudesMoteur(d, hasard)
                Domaine.NUMERIQUE -> NumeriqueMoteur(d, hasard)
                Domaine.DEMARCHES -> DemarchesMoteur(d, hasard)
                Domaine.BUSINESS -> BusinessMoteur(d, hasard)
                Domaine.LOGEMENT -> LogementMoteur(d, hasard)
                Domaine.IMAGE -> ImageMoteur(d, hasard)
                Domaine.MANAGEMENT -> ManagementMoteur(d, hasard)
            }
        }
        moteurs = m
        analyseur = AnalyseurDeMessage(moteurs, ordre, donnees.analyse)
        routeur = RouteurDeMoteurs(moteurs, ordre)
        controle = ControleQualite(moteurs)
    }

    // ---------- gestion des conversations ----------
    fun oublier(personne: String) { depot.oublier(personne) }
    fun relacher(personne: String) { depot.existe(personne)?.etat?.relacher() }
    fun exporter(personne: String): String = ConversationJson.exporter(depot.charger(personne))
    fun importer(personne: String, json: dynamic): Boolean = ConversationJson.importer(depot.charger(personne), json)
    fun enConversation(personne: String): Boolean = depot.existe(personne)?.etat?.sujetActif != null
    fun configurerActualite(proxy: String) { (moteurs.getValue(Domaine.ACTUALITE) as ActualiteMoteur).configurer(proxy) }

    /** Décision de routage « à blanc » (aucun effet sur l'état) : le chatbot s'en sert pour arbitrer avec ses intentions agence. */
    fun apercu(personne: String, message: String): Decision {
        val etat = depot.charger(personne).etat
        val texte = if (etat.messageAClarifier != null) (etat.messageAClarifier ?: "") + " " + message else message
        return routeur.router(analyseur.analyser(message, texte, etat), etat, message)
    }

    /** Phase asynchrone : prépare les données en direct (météo, actualité) avant la réponse. [fin] est toujours appelé. */
    fun precharger(personne: String, message: String, fin: () -> Unit) {
        val conv = depot.charger(personne)
        val etat = conv.etat
        val texte = if (etat.messageAClarifier != null) (etat.messageAClarifier ?: "") + " " + message else message
        val dec = routeur.router(analyseur.analyser(message, texte, etat), etat, message)
        if (dec.principal != Domaine.ACTUALITE && dec.secondaire != Domaine.ACTUALITE) { fin(); return }
        val ctx = Contexte(profil = Profil(ville = conv.ville), theme = if (etat.sujetActif == Domaine.ACTUALITE) etat.sousSujet else null)
        (moteurs.getValue(Domaine.ACTUALITE) as ActualiteMoteur).precharger(texte, ctx, fin)
    }

    /** Statistiques : nombre de sous-sujets et de combinaisons par moteur (JSON). */
    fun statsJson(): String {
        val sb = StringBuilder("{\"moteurs\":{")
        var total = 0.0
        var premier = true
        for (d in ordre) {
            val m = moteurs.getValue(d)
            val c = m.nombreCombinaisons().toDouble()
            total += c
            if (!premier) sb.append(",")
            premier = false
            sb.append(jsonChaine(d.name)).append(":{\"themes\":").append(m.themes.size).append(",\"combinaisons\":").append(c.toLong()).append("}")
        }
        sb.append("},\"total\":").append(total.toLong()).append("}")
        return sb.toString()
    }

    // ---------- helpers ----------
    private fun fixe(cle: String, conv: ConversationPersonne, extra: Map<String, String> = emptyMap()): List<String> {
        val m = messages[cle] ?: emptyList()
        if (m.isEmpty()) return emptyList()
        var i = hasard.nextInt(m.size)
        var k = 0
        while (k < 8 && m.size > 1 && conv.dernierFixe == cle + i) { i = hasard.nextInt(m.size); k++ }
        conv.dernierFixe = cle + i
        val e = conv.etat
        return Texte.decouper(Gabarit.rendre(m[i], conv.prenom, "", "", e.ton, e.politesse, extra), LIMITE_SMS, MAX_PARTIES)
    }

    private fun tonPour(d: Domaine, emo: Emotion): Ton {
        if (emo.negative) return Ton.RASSURANT
        val fixe = options.tonFixe
        if (fixe != null) return fixe
        return if (d == Domaine.PROFESSIONNEL || d == Domaine.FINANCE || d == Domaine.RECRUTEMENT || d == Domaine.ACTUALITE) Ton.PROFESSIONNEL else Ton.AMICAL
    }

    private fun chipsDomaines(): List<String> =
        if (chipsAccueil.isNotEmpty()) chipsAccueil else ordre.map { Texte.majuscule(it.libelleCourt) }.take(7)

    /** Boutons de suite : jusqu'à 2 « ponts » vers les réponses de l'agence, puis Oui/Non et changement de sujet. */
    private fun chipsSuite(rep: ReponseSms): List<String> {
        val c = ArrayList<String>()
        for (p in ponts[rep.domaine.name] ?: emptyList<String>()) if (c.size < 2) c.add(p)
        if (rep.question != null) { c.add("Oui"); c.add("Non") }
        c.add("Un autre conseil")
        c.add("Changeons de sujet")
        return c.take(6)
    }

    private fun clarifier(conv: ConversationPersonne, dec: Decision, message: String, element: String, j: MutableList<String>): ResultatTraitement {
        val etat = conv.etat
        val p = dec.proposes
        val cle = if (p.size >= 2) "clarification" else if (p.size == 1) "clarification1" else "clarification0"
        val extra = HashMap<String, String>()
        if (p.isNotEmpty()) extra["a"] = p[0].libelleDe
        if (p.size > 1) extra["b"] = p[1].libelleDe
        val m = messages[cle] ?: listOf("De quoi voulez-vous parler?")
        val t = Gabarit.rendre(m[hasard.nextInt(m.size)], conv.prenom, "", element, etat.ton, etat.politesse, extra)
        etat.questionEnAttente = t
        etat.messageAClarifier = (if (etat.messageAClarifier != null) (etat.messageAClarifier ?: "") + " " else "") + message
        etat.domainesProposes = p
        j.add("  -> CLARIFICATION : une seule question (" + (if (p.isEmpty()) "sujet libre" else p.joinToString(" / ") { it.name }) + ")")
        conv.pousser(Echange(message, t, etat.sujetActif, etat.sousSujet, emptyMap(), listOf(element)))
        val chips = if (p.isNotEmpty()) p.map { Texte.majuscule(it.libelleCourt) } + "Autre sujet" else chipsDomaines()
        return ResultatTraitement(TypeResultat.CLARIFICATION, listOf(t), chips = chips, question = t)
    }

    // ---------- traitement d'un message ----------
    /**
     * Traite un message de [personne] et renvoie les SMS à envoyer, avec le journal de debug.
     * @param passerHorsDomaine si le message est hors des 8 domaines, ne rien produire (le chatbot essaie ses autres moteurs).
     */
    fun traiter(
        personne: String, brut: String, prenom: String? = null, ville: String? = null, passerHorsDomaine: Boolean = false
    ): ResultatTraitement {
        val j = ArrayList<String>()
        val conv = depot.charger(personne)
        val etat = conv.etat
        numero++
        val message = espaces.replace(brut, " ").trim().take(600)
        j.add("#" + numero + " ÉTAPE 1 normalisation : \"" + Texte.normaliser(message) + "\"")
        if (prenom != null) conv.prenom = prenom
        if (ville != null) conv.ville = ville
        fun fin(r: ResultatTraitement): ResultatTraitement {
            r.journal = j
            journal.ajouter(j)
            return r
        }
        if (message.isEmpty()) {
            etat.ton = Ton.AMICAL
            j.add("  -> message vide")
            return fin(ResultatTraitement(TypeResultat.VIDE, fixe("vide", conv)))
        }

        // ÉTAPE 2 : historique et état
        j.add("ÉTAPE 2 état : sujet=" + (etat.sujetActif?.name ?: "-") + "/" + (etat.sousSujet ?: "-") + " question=" +
            (if (etat.questionEnAttente != null) "oui" else "non") + " historique=" + conv.historique.size + "/10")
        val texteAn = if (etat.messageAClarifier != null) (etat.messageAClarifier ?: "") + " " + message else message

        // ÉTAPE 3 : analyse
        val an = analyseur.analyser(message, texteAn, etat)
        val tri = an.candidats.sortedByDescending { it.confiance }
        j.add("ÉTAPE 3 analyse : émotion=" + an.emotion.name + " urgence=" + an.urgence.name + " détail=" + (if (an.detail) "oui" else "non") +
            " | top : " + tri.take(3).joinToString(", ") { it.domaine.name + " " + fixe2(it.confiance) + (if (it.theme != null) "/" + it.theme else "") })
        when (options.politesse) {
            ModePolitesse.AUTO -> {
                if (an.vous && !an.tu) {
                    etat.politesse = Politesse.VOUVOIEMENT
                } else if (an.tu && !an.vous) {
                    etat.politesse = Politesse.TUTOIEMENT
                }
            }
            ModePolitesse.TUTOIEMENT -> { etat.politesse = Politesse.TUTOIEMENT }
            ModePolitesse.VOUVOIEMENT -> { etat.politesse = Politesse.VOUVOIEMENT }
        }

        // Détresse grave : soutien et orientation, avant tout le reste.
        if (an.detresse) {
            etat.emotion = Emotion.DETRESSE
            etat.ton = Ton.RASSURANT
            etat.questionEnAttente = null
            etat.messageAClarifier = null
            val urg = if (options.numerosUrgence.isNotEmpty()) " (" + options.numerosUrgence + ")" else ""
            var ps = fixe("detresse1", conv) + fixe("detresse2", conv)
            if (an.urgence == Urgence.CRITIQUE) ps = ps + fixe("detresse3", conv, mapOf("urgences" to urg))
            ps = ps.take(MAX_PARTIES)
            j.add("  -> DÉTRESSE détectée : message de soutien (" + ps.size + " SMS)")
            conv.pousser(Echange("[message sensible]", ps.joinToString(" "), etat.sujetActif, etat.sousSujet))
            return fin(ResultatTraitement(TypeResultat.DETRESSE, ps))
        }

        // Salutation / merci / au revoir sans contenu : réponse courte.
        val best = tri[0]
        if (best.confiance < RouteurDeMoteurs.SEUIL_MIN && etat.questionEnAttente == null && (an.salutation || an.merci || an.auRevoir)) {
            val cle = if (an.salutation) "accueil" else if (an.merci) "merci" else "au_revoir"
            val pf = fixe(cle, conv)
            j.add("  -> message de politesse (" + cle + ")")
            conv.pousser(Echange(message, pf.joinToString(" "), etat.sujetActif, etat.sousSujet))
            return fin(ResultatTraitement(TypeResultat.FIXE, pf, chips = if (cle == "accueil") chipsDomaines() else emptyList()))
        }

        // ÉTAPES 4-5 : routage et verrouillage du sujet
        val dec = routeur.router(an, etat, message)
        j.add("ÉTAPES 4-5 routage : " + dec.type.name + (if (dec.principal != null) " principal=" + dec.principal!!.name + " (" + fixe2(dec.confiance) + ")" else "") +
            (if (dec.secondaire != null) " secondaire=" + dec.secondaire!!.name else "") + " | verrou=" +
            (if (dec.verrou) "maintenu" else if (dec.sujetChange) "changé" else "nouveau") + " | " + dec.raison)
        if (dec.type == TypeDecision.HORS_DOMAINE) {
            if (passerHorsDomaine) {
                j.add("  -> hors domaine : laissé aux autres moteurs du chatbot")
                return fin(ResultatTraitement(TypeResultat.HORS_DOMAINE, emptyList(), passe = true))
            }
            etat.questionEnAttente = null
            etat.messageAClarifier = null
            val pr = fixe("recentrage", conv)
            j.add("  -> hors domaine : recentrage poli")
            conv.pousser(Echange(message, pr.joinToString(" "), etat.sujetActif, etat.sousSujet))
            return fin(ResultatTraitement(TypeResultat.HORS_DOMAINE, pr, chips = chipsDomaines()))
        }
        val elemRepli = Texte.elementSignificatif(an.toks) ?: conv.historique.lastOrNull()?.elements?.firstOrNull() ?: "votre message"
        if (dec.type == TypeDecision.CLARIFICATION) return fin(clarifier(conv, dec, message, elemRepli, j))

        // ÉTAPE 6 : appel du ou des moteurs
        val principal: Domaine = dec.principal!!
        val prim = moteurs.getValue(principal)
        val cand = an.candidats.first { it.domaine == principal }
        val avert: String? = when {
            an.medical -> "avert_medical"
            an.juridique -> "avert_juridique"
            principal == Domaine.FINANCE && (an.financier || listOf("epargne", "dettes", "compta", "projet").contains(dec.theme)) -> "avert_financier"
            else -> null
        }
        val tonChoisi = tonPour(principal, an.emotion)
        val detaille = an.detail && dec.secondaire == null
        val profil = Profil(conv.prenom, tonChoisi, etat.politesse, conv.ville)
        var ctx = Contexte(
            profil = profil, historique = conv.historique.toList(),
            theme = if (dec.verrou || principal == etat.sujetActif) etat.sousSujet else null,
            emotion = an.emotion, urgence = an.urgence, elements = cand.elements,
            mode = if (detaille) ModeReponse.DETAILLE else ModeReponse.COURT,
            maxParties = if (avert != null) (if (dec.secondaire != null) 1 else 2) else MAX_PARTIES
        )
        if (dec.theme != null && principal != etat.sujetActif) ctx = ctx.copy(theme = null)

        var rep: ReponseSms? = null
        var qc: ResultatQualite? = null
        var tent = 0
        val essais = ArrayList<String>()
        while (tent < 8) {
            tent++
            val c = ctx.copy(forcerReference = tent >= 2)
            var r = prim.repondre(texteAn, c)
            val sd = dec.secondaire
            if (sd != null) {
                val sc = c.copy(
                    blocsImposes = listOf(BlocType.INFORMATION, BlocType.CONSEIL), prefixe = "Côté " + sd.libelleCourt + " :", theme = null,
                    elements = an.candidats.first { it.domaine == sd }.elements
                )
                val r2 = moteurs.getValue(sd).repondre(texteAn, sc)
                r = ReponseSms(r.parties.take(1) + r2.parties.take(1), r.domaine, r.theme, r.variantes, r.question, r.elements, r.blocs, r.donnees, sd)
            }
            if (avert != null) r = r.copy(parties = (r.parties + fixe(avert, conv)).take(MAX_PARTIES))
            // ÉTAPE 7 : contrôle qualité
            val q = controle.verifier(r, an, dec, conv)
            essais.add(if (q.ok) "tentative " + tent + " : OK" else "tentative " + tent + " : " + q.motifs.joinToString(" / "))
            rep = r
            qc = q
            if (q.ok) break
        }
        val repF: ReponseSms = rep!!
        j.add("ÉTAPE 6 moteur " + principal.name + (if (repF.theme != null) "/" + repF.theme else "") + " blocs=[" +
            repF.blocs.joinToString(",") { it.name } + "] mode=" + (if (detaille) "DETAILLE" else "COURT") + (if (avert != null) " + " + avert else ""))
        j.add("ÉTAPE 7 contrôle qualité : " + essais.joinToString(" ; "))
        if (qc == null || !qc.ok) {
            j.add("  -> contrôle non satisfait : question de clarification courte (jamais de réponse générique)")
            dec.proposes = listOf(principal)
            return fin(clarifier(conv, dec, message, elemRepli, j))
        }

        // ÉTAPE 8 : mise à jour de l'état et de l'historique
        val texte = repF.parties.joinToString(" ")
        val memeDomaine = etat.sujetActif == principal
        etat.sousSujet = repF.theme ?: dec.theme ?: (if (memeDomaine) etat.sousSujet else null)
        etat.sujetActif = principal
        etat.dernierMoteur = principal
        etat.ton = tonChoisi
        etat.emotion = an.emotion
        etat.questionEnAttente = repF.question
        etat.messageAClarifier = null
        etat.domainesProposes = emptyList()
        etat.tours++
        etat.elementsRecents = cand.elements
        conv.pousser(Echange(message, texte, principal, etat.sousSujet, repF.variantes, cand.elements))
        j.add("ÉTAPE 8 état : sujetActif=" + principal.name + " sousSujet=" + (etat.sousSujet ?: "-") + " question=" +
            (if (etat.questionEnAttente != null) "oui" else "non") + " ; " + repF.parties.size + " SMS (" + repF.parties.joinToString("+") { it.length.toString() } + ")")
        return fin(
            ResultatTraitement(
                TypeResultat.MOTEUR, repF.parties, principal, repF.theme, dec.secondaire, dec.confiance, dec.sujetChange,
                chipsSuite(repF), repF.question, false, repF.donnees
            )
        )
    }
}
