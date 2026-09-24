"""
Publie automatiquement une actualité dans le fil du site SHAMAN CHOOZ.

Ce script est lancé une fois par jour par GitHub Actions. Il choisit la
prochaine publication dans fil-robot-posts/posts.json (30 publications qui
tournent en boucle, une par jour) et l'ajoute directement, déjà approuvée,
dans la base Firebase du site — donc visible immédiatement dans le fil.
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

with open("fil-robot-posts/posts.json", encoding="utf-8") as f:
    posts = json.load(f)

# Choisit la publication du jour : le jour de l'année (1 à 366) modulo le
# nombre de publications disponibles, pour que ça tourne en boucle sans
# jamais publier deux fois la même chose le même jour.
day_of_year = datetime.date.today().timetuple().tm_yday
index = day_of_year % len(posts)
post = posts[index]

body = {
    "nom": post.get("nom", "SHAMAN CHOOZ"),
    "texte": post["texte"],
    "imageUrl": f"{REPO_RAW_BASE}/{post['image']}",
    "videoEmbedUrl": None,
    "date": int(time.time() * 1000),
    "statut": "approuve",
    "source": "robot",
    "likes": 0,
}

# Authentification via le compte de service Firebase (remplace l'ancien
# "Database secret" qui n'existe plus sur les nouveaux projets).
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

url = f"{FIREBASE_URL}/fil_actualite.json"
headers = {"Authorization": f"Bearer {token}"}

r = requests.post(url, json=body, headers=headers)
print("Publication choisie :", index, "-", post["texte"][:60].replace("\n", " "))
print(r.status_code, r.text)
r.raise_for_status()
