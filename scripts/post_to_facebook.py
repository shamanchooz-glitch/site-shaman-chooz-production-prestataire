import json
import random
import os
import requests

with open('publications-facebook/textes.json') as f:
    posts = json.load(f)

post = random.choice(posts)
token = os.environ['FB_PAGE_TOKEN']
page_id = os.environ['FB_PAGE_ID']
image_url = 'https://raw.githubusercontent.com/shamanchooz-glitch/site-shaman-chooz-production-prestataire/main/' + post['image']

r = requests.post(
    f'https://graph.facebook.com/{page_id}/photos',
    data={'url': image_url, 'caption': post['texte'], 'access_token': token}
)
print(r.status_code, r.text)
