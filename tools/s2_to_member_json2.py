#!/usr/bin/env python3
import json, os, time, sys
from urllib.parse import quote
import requests

ROOT = os.path.dirname(os.path.dirname(__file__))
MANIFEST = os.path.join(ROOT, "members", "manifest.json")

S2_BASE = "https://api.semanticscholar.org/graph/v1"
# Include paperId + openAccessPdf; author list kept small (names only)
PAPER_FIELDS = "paperId,title,year,venue,url,externalIds,authors,openAccessPdf"
PAGE_SIZE = 100

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

def get_profile(mid):
    p = os.path.join(ROOT, "members", mid, "profile.json")
    return read_json(p) or {}

def ids_from(val):
    if not val: return []
    if isinstance(val, (list, tuple)): return [str(x) for x in val if str(x).strip()]
    return [str(val)]

def fetch_author_papers(aid):
    items, offset = [], 0
    while True:
        url = f"{S2_BASE}/author/{quote(str(aid))}/papers?limit={PAGE_SIZE}&offset={offset}&fields={PAPER_FIELDS}"
        r = requests.get(url, timeout=45)
        r.raise_for_status()
        j = r.json()
        data = j.get("data") or j.get("papers") or []
        if not data: break
        items.extend(data)
        if len(data) < PAGE_SIZE: break
        offset += PAGE_SIZE
    return items

def normalize(p):
    # author/{id}/papers returns flat fields on each item (paperId, title, ...)
    title = p.get("title") or ""
    year  = p.get("year")
    venue = p.get("venue") or ""
    ext   = p.get("externalIds") or {}
    doi   = ext.get("DOI")
    arxiv = ext.get("ArXiv") or ext.get("arXiv") or ext.get("ARXIV")
    oa    = (p.get("openAccessPdf") or {}).get("url")
    url   = f"https://doi.org/{doi}" if doi else (p.get("url") or "")
    authors = [a.get("name") for a in (p.get("authors") or []) if a.get("name")]
    return {
        "paperId": p.get("paperId") or None,   # <— needed for figure URLs
        "title": title,
        "year": year,
        "venue": venue,
        "doi": str(doi) if doi else None,
        "url": url,
        "authors": authors,
        "oa_pdf": oa,
        "arxivId": arxiv
    }

def norm_key(n):
    return (n.get("doi") or (n.get("title") or "").lower()).strip()

def main():
    manifest = read_json(MANIFEST)
    if not isinstance(manifest, list):
        print("ERROR: members/manifest.json must be an array of member ids", file=sys.stderr)
        sys.exit(1)

    for mid in manifest:
        prof = get_profile(mid)
        aids = ids_from(prof.get("semanticScholarId"))
        if not aids:
            print(f"skip {mid}: no semanticScholarId", file=sys.stderr)
            continue

        raw = []
        for aid in aids:
            try:
                raw.extend(fetch_author_papers(aid))
            except Exception as e:
                print(f"ERROR fetch {mid}/{aid}: {e}", file=sys.stderr)

        dedup = {}
        for r in raw:
            n = normalize(r)
            k = norm_key(n)
            if k and k not in dedup:
                dedup[k] = n

        pubs = list(dedup.values())
        pubs.sort(key=lambda x: (x.get("year") or 0, x.get("title") or ""), reverse=True)

        out = os.path.join(ROOT, "members", mid, "publications.json")
        write_json(out, {
            "source": "semantic_scholar",
            "author_ids": aids,
            "updated_at": int(time.time()),
            "publications": pubs
        })
        print(f"- wrote {out} with {len(pubs)} items")

if __name__ == "__main__":
    main()
