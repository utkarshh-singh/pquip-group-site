import json, os, time, sys
from urllib.parse import quote
import requests

ROOT = os.path.dirname(os.path.dirname(__file__))
MANIFEST = os.path.join(ROOT, "members", "manifest.json")
API = "https://api.semanticscholar.org/graph/v1/author/"
FIELDS = "papers.title,papers.year,papers.venue,papers.url,papers.externalIds,papers.authors"
PER_MEMBER = int(os.environ.get("S2_PER_MEMBER", "12"))

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

def get_profile(member_id):
    p = os.path.join(ROOT, "members", member_id, "profile.json")
    return read_json(p) or {}

def fetch_author(author_id):
    url = f"{API}{quote(str(author_id))}?fields={FIELDS}"
    r = requests.get(url, timeout=45)
    r.raise_for_status()
    return r.json()

def normalize_pubs(j):
    papers = (j or {}).get("papers") or []
    # sort newest first, limit
    papers = sorted(papers, key=lambda p: (p.get("year") or 0), reverse=True)[:PER_MEMBER]
    out = []
    for p in papers:
        title = p.get("title") or ""
        year  = p.get("year")
        venue = p.get("venue") or ""
        doi   = None
        ext   = p.get("externalIds") or {}
        if isinstance(ext, dict) and ext.get("DOI"):
            doi = str(ext["DOI"])
        url = f"https://doi.org/{doi}" if doi else (p.get("url") or "")
        authors = [a.get("name") for a in (p.get("authors") or []) if a.get("name")]
        out.append({
            "title": title,
            "year": year,
            "venue": venue,
            "doi": doi,
            "url": url,
            "authors": authors
        })
    return out

def main():
    ids = read_json(MANIFEST) or []
    if not isinstance(ids, list):
        print("ERROR: members/manifest.json must be a JSON array", file=sys.stderr)
        sys.exit(1)

    for mid in ids:
        prof = get_profile(mid)
        aid = prof.get("semanticScholarId")
        if not aid:
            print(f"skip {mid}: no semanticScholarId", file=sys.stderr)
            continue
        try:
            data = fetch_author(aid)
            pubs = normalize_pubs(data)
            payload = {
                "source": "semantic_scholar",
                "author_id": str(aid),
                "updated_at": int(time.time()),
                "publications": pubs
            }
            out = os.path.join(ROOT, "members", mid, "publications.json")
            write_json(out, payload)
            print(f"- wrote {out} with {len(pubs)} items")
        except Exception as e:
            print(f"ERROR for {mid}: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
