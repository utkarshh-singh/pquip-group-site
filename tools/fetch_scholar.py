import json, os, re, sys, time
from urllib.parse import urlencode
import requests

ROOT = os.path.dirname(os.path.dirname(__file__))  # repo root
MANIFEST = os.path.join(ROOT, "members", "manifest.json")
API_KEY = os.environ.get("SERPAPI_KEY")
BASE = "https://serpapi.com/search.json"

def log(*a): print(*a, file=sys.stderr)

def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def get_scholar_user_from_profile(profile_path):
    j = read_json(profile_path) or {}
    return j.get("scholarUser")

def fetch_scholar_author(user, limit=10):
    # SerpAPI docs: engine=google_scholar_author, author_id=user
    params = {
        "engine": "google_scholar_author",
        "author_id": user,
        "api_key": API_KEY,
        "hl": "en",
        "num": limit
    }
    r = requests.get(BASE, params=params, timeout=30)
    r.raise_for_status()
    return r.json()

def map_articles_to_slides_and_pubs(author_json):
    """Return a publications array compatible with our renderer."""
    arts = (author_json or {}).get("articles", []) or []
    pubs = []
    for a in arts:
        title = a.get("title")
        link = (a.get("link") or
                (a.get("resources") or [{}])[0].get("link"))
        year = None
        # SerpAPI may put year in "year" or "publication" string
        if isinstance(a.get("year"), int) or (isinstance(a.get("year"), str) and a.get("year").isdigit()):
            year = int(a.get("year"))
        venue = a.get("publication")
        pubs.append({
            "title": title,
            "year": year,
            "venue": venue,
            "url": link
        })
    return pubs

def main():
    if not API_KEY:
        log("ERROR: SERPAPI_KEY not set")
        sys.exit(1)

    ids = read_json(MANIFEST) or []
    if not isinstance(ids, list):
        log("ERROR: members/manifest.json must be a JSON array of ids")
        sys.exit(1)

    for mid in ids:
        profile_path = os.path.join(ROOT, "members", mid, "profile.json")
        user = get_scholar_user_from_profile(profile_path)
        if not user:
            log(f"skip {mid}: no scholarUser")
            continue

        try:
            data = fetch_scholar_author(user, limit=12)
            pubs = map_articles_to_slides_and_pubs(data)[:10]
            out = {
                "source": "google_scholar",
                "author_id": user,
                "updated_at": int(time.time()),
                "publications": pubs
            }
            out_path = os.path.join(ROOT, "members", mid, "scholar.json")
            write_json(out_path, out)
            log(f"wrote {out_path} ({len(pubs)} pubs)")
        except Exception as e:
            log(f"error for {mid}: {e}")

if __name__ == "__main__":
    main()
