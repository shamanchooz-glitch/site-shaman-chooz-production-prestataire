"""
Publie automatiquement des actualites dans le fil du site SHAMAN CHOOZ,
selon la programmation definie dans l'espace administrateur du site
(Firebase: config_robot).

Ce script est lance CHAQUE HEURE par GitHub Actions (et pas seulement une
fois par jour), pour pouvoir respecter des heures de publication precises
choisies dans l'admin. A chaque execution, il verifie si l'heure et le jour
actuels (heure de la Cote d'Ivoire = UTC, pas de decalage) correspondent a
une plage programmee ; si oui, il publie le nombre de publications prevu
pour cette plage. Sinon, il ne fait rien.

Modele de configuration (Firebase, chemin config_robot) :
{
  "mode": "defaut" | "personnalise",
  "defaut": { "nombre": 10 },                     # tous les jours a 08h00
  "personnalise": {
    "programmations": [
      {"jours": ["lun","mar",...], "heure": 8, "nombre": 10},
      ...
    ]
  },
  "curseur": 0   # position courante dans la banque de publications,
                 # avance automatiquement par ce script, ne pas modifier
                 # a la main (un bouton "Recommencer le cycle" dans l'admin
                 # permet de le remettre a 0 si besoin)
}

Le curseur avance a chaque publication et reboucle automatiquement une fois
que toute la banque de contenus (fil-robot-posts/posts.json) a ete parcourue,
donc on peut ajouter de nouvelles publications a tout moment sans rien casser.
"""
import json
import os
import time
import datetime
import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

FIREBASE_URL = "https://shaman-chooz-production-prest-default-rtdb.firebaseio.com"
REPO_RAW_BASE = "https://raw.githubusercontent.com/shamanchooz-glitch/site-shaman-chooz-production-prestataire/main"

JOURS_CODES = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]  # index = date.weekday()

with open("fil-robot-posts/posts.json", encoding="utf-8") as f:
    posts = json.load(f)
total = len(posts)

# --- Authentification via le compte de service Firebase ---
service_account_info = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])
credentials = service_account.Credentials.from_service_account_info(
    service_account_info,
    scopes=[
        "https://www.googleapis.com/auth/firebase.database",
        "https://www.googleapis.com/auth/userinfo.email",
    ],
)
credentials.refresh(Request())
token = credentials.token
headers = {"Authorization": f"Bearer {token}"}


def fb_get(path):
    r = requests.get(f"{FIREBASE_URL}/{path}.json", headers=headers)
    r.raise_for_status()
    return r.json()


def fb_patch(path, data):
    r = requests.patch(f"{FIREBASE_URL}/{path}.json", json=data, headers=headers)
    r.raise_for_status()


# --- Lecture de la configuration ---
config = fb_get("config_robot") or {}
mode = config.get("mode", "defaut")

now = datetime.datetime.utcnow()  # UTC == heure de la Cote d'Ivoire (pas de decalage)
jour_actuel = JOURS_CODES[now.weekday()]
heure_actuelle = now.hour

nombre_a_publier = 0

if mode == "personnalise":
    programmations = (config.get("personnalise") or {}).get("programmations") or []
    for p in programmations:
        if jour_actuel in (p.get("jours") or []) and int(p.get("heure", -1)) == heure_actuelle:
            nombre_a_publier += int(p.get("nombre", 0))
else:
    # Mode par defaut : tous les jours a 08h00.
    if heure_actuelle == 8:
        nombre_a_publier = int((config.get("defaut") or {}).get("nombre", 10))

if nombre_a_publier <= 0:
    print(f"Rien a publier a {heure_actuelle}h ({jour_actuel}) avec la programmation actuelle.")
    raise SystemExit(0)

# --- Publication, a partir du curseur enregistre ---
curseur = int(config.get("curseur", 0)) % total
url = f"{FIREBASE_URL}/fil_actualite.json"

for i in range(nombre_a_publier):
    index = (curseur + i) % total
    post = posts[index]

    body = {
        "nom": post.get("nom", "SHAMAN CHOOZ"),
        "texte": post["texte"],
        "imageUrl": f"{REPO_RAW_BASE}/{post['image']}",
        "videoEmbedUrl": None,
        "date": int(time.time() * 1000) + i,  # +i pour garder l'ordre d'affichage
        "statut": "approuve",
        "source": "robot",
        "likes": 0,
    }

    r = requests.post(url, json=body, headers=headers)
    print(f"[{i+1}/{nombre_a_publier}] Publication {index} -",
          post["texte"][:60].replace("\n", " "))
    print(r.status_code, r.text)
    r.raise_for_status()

# --- Mise a jour du curseur pour la prochaine fois ---
nouveau_curseur = (curseur + nombre_a_publier) % total
fb_patch("config_robot", {"curseur": nouveau_curseur})
print(f"Curseur mis a jour : {nouveau_curseur}/{total}")
