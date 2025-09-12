import json, os, time, sys
from glob import glob

ROOT = os.path.dirname(os.path.dirname(__file__))
MEMBERS_DIR = os.path.join(ROOT, "members")
OUT = os.path.join(ROOT, "data", "highlights.auto.json")

NOWYEAR = time.gmtime().tm_year

FALLBACKS = [
    ("arxiv", "assets/img/pubs/arxiv-thumb.jpg"),
    ("optica", "assets/img/pubs/optics-thumb.jpg"),
    ("osa", "assets/img/pubs/optics-thumb.jpg"),
    ("quantum", "assets/img/pubs/quantum-thumb.jpg"),
    ("prx", "assets/img/pubs/quantum-thumb.jpg"),
    ("prl", "assets/img/pubs/quantum-thumb.jpg"),
]

GENERIC = "assets/img/pubs/paper-generic.jpg"

def pick_image(p):
    # Respect manual thumbnails if present
    if isinstance(p, dict) and p.get("thumbnail"):
        return p["thumbnail"]
    url = (p.get("url") or "").lower()
    venue = (p.get("venue") or "").lower()
    for key, img in FALLBACKS:
        if key in url or key in venue:
            return img
    return GENERIC

def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def main():
    pubs = []
    for pubfile in glob(os.path.join(MEMBERS_DIR, "*", "publications.json")):
        data = read_json(pubfile)
        arr = data if isinstance(data, list) else (data or {}).get("publications") or []
        for p in arr:
            y = p.get("year")
            if y == NOWYEAR:
                pubs.append({
                    "type": "publication",
                    "title": p.get("title") or "",
                    "year": y,
                    "url": p.get("url") or "",
                    "image": pick_image(p),
                    "tags": ["Publication"]
                })

    # De-dupe by DOI or title/url
    seen = set()
    uniq = []
    for x in pubs:
        key = (x.get("url") or x.get("title") or "").lower()
        if key and key not in seen:
            seen.add(key)
            uniq.append(x)

    out = {
        "source": "auto_from_publications",
        "year": NOWYEAR,
        "updated_at": int(time.time()),
        "items": uniq
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"wrote {OUT} with {len(uniq)} items")

if __name__ == "__main__":
    main()
