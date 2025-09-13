#!/usr/bin/env python3
import json, os, time, sys
from urllib.parse import quote
import requests
from typing import Dict, Any, List

ROOT = os.path.dirname(os.path.dirname(__file__))
MANIFEST = os.path.join(ROOT, "members", "manifest.json")

S2_BASE = "https://api.semanticscholar.org/graph/v1"
# Keep your original fields AND add abstract + topics + fieldsOfStudy
PAPER_FIELDS = ",".join([
    "paperId","title","year","venue","url",
    "externalIds","authors","openAccessPdf",
    "fieldsOfStudy","abstract","topics"
])
PAGE_SIZE = 100
SLEEP_BETWEEN = 0.25
RETRIES = 3
TIMEOUT = 45

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "pquip-site-sync/1.0 (+https://example.org)",
    "Accept": "application/json"
})

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

def get_json(url, params) -> Dict[str, Any]:
    last_err = None
    for attempt in range(1, RETRIES + 1):
        try:
            r = SESSION.get(url, params=params, timeout=TIMEOUT)
            if r.status_code == 429:
                # rate limited; backoff a bit longer
                wait = 2.0 * attempt
                print(f"[warn] 429 rate limited; sleeping {wait}s")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_err = e
            wait = 1.0 * attempt
            print(f"[warn] HTTP error (attempt {attempt}/{RETRIES}) on {url}: {e}; sleeping {wait}s")
            time.sleep(wait)
    raise RuntimeError(last_err or Exception("request failed"))

def fetch_author_papers(aid: str) -> List[Dict[str, Any]]:
    items, offset = [], 0
    while True:
        url = f"{S2_BASE}/author/{quote(str(aid))}/papers"
        params = {"limit": PAGE_SIZE, "offset": offset, "fields": PAPER_FIELDS}
        j = get_json(url, params)
        data = j.get("data") or j.get("papers") or []
        if not data:
            break
        items.extend(data)
        if len(data) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(SLEEP_BETWEEN)
    return items

def normalize_topics(topics_obj) -> List[str]:
    """
    S2 'topics' can be like [{'topic': 'Quantum communication','topicId':...}, ...]
    Return a simple list of strings.
    """
    if not topics_obj:
        return []
    names = []
    for t in topics_obj:
        if isinstance(t, dict):
            name = (t.get("topic") or t.get("name") or "").strip()
        else:
            name = str(t).strip()
        if name:
            names.append(name)
    # de-dup preserving order
    seen, out = set(), []
    for n in names:
        key = n.lower()
        if key in seen: continue
        seen.add(key); out.append(n)
    return out

def normalize(p: Dict[str, Any]) -> Dict[str, Any]:
    # author/{id}/papers returns flat fields: paperId, title, ...
    title = p.get("title") or ""
    year  = p.get("year")
    venue = p.get("venue") or ""
    ext   = p.get("externalIds") or {}
    doi   = ext.get("DOI")
    arxiv = ext.get("ArXiv") or ext.get("arXiv") or ext.get("ARXIV")
    oa    = (p.get("openAccessPdf") or {}).get("url")
    url   = f"https://doi.org/{doi}" if doi else (p.get("url") or "")
    authors = [a.get("name") for a in (p.get("authors") or []) if a.get("name")]

    out = {
        "paperId": p.get("paperId") or None,   # needed for figure URLs
        "title": title,
        "year": year,
        "venue": venue,
        "doi": str(doi) if doi else None,
        "url": url,
        "authors": authors,
        "oa_pdf": oa,
        "arxivId": arxiv,
        "fieldsOfStudy": p.get("fieldsOfStudy") or []
    }

    topics = normalize_topics(p.get("topics"))
    if topics:
        out["topics"] = topics
    else:
        abstract = (p.get("abstract") or "").strip()
        if abstract:
            # store only if topics missing; trim to keep files light
            out["abstract"] = abstract[:2000]

    return out

def norm_key(n: Dict[str, Any]) -> str:
    # prefer DOI for dedup; fall back to lower-cased title prefix
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
                got = fetch_author_papers(aid)
            except Exception as e:
                print(f"ERROR fetch {mid}/{aid}: {e}", file=sys.stderr)
                got = []
            raw.extend(got)
            time.sleep(SLEEP_BETWEEN)

        dedup = {}
        for r in raw:
            n = normalize(r)
            k = norm_key(n)
            if k and k not in dedup:
                dedup[k] = n

        pubs = list(dedup.values())
        pubs.sort(key=lambda x: (x.get("year") or 0, x.get("title") or ""), reverse=True)

        out_path = os.path.join(ROOT, "members", mid, "publications.json")
        # Keep your original wrapper shape so the site keeps working
        payload = {
            "source": "semantic_scholar",
            "author_ids": aids,
            "updated_at": int(time.time()),
            "publications": pubs
        }
        write_json(out_path, payload)
        print(f"- wrote {out_path} with {len(pubs)} items")
        if len(pubs) == 0:
            print(f"[warn] {mid}: 0 publications (check author id(s) or API response)")

if __name__ == "__main__":
    main()
