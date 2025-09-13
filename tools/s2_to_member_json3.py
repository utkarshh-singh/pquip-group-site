#!/usr/bin/env python3
"""
Fetch member publications from Semantic Scholar and write members/**/publications.json
- Prefer storing S2 'topics' for each paper.
- Only store 'abstract' IF topics are missing (to save space & guide AI fallback).
"""

import json, os, time, requests
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEMBERS_DIR = ROOT / "members"

S2_BASE = "https://api.semanticscholar.org/graph/v1"
# Fields we want from S2 papers
PAPER_FIELDS = ",".join([
    "paperId", "title", "year", "venue", "url", "doi",
    "fieldsOfStudy", "abstract", "topics"    # topics is key
])

# If you have rate limits, adjust this
SLEEP_BETWEEN = 0.25

def fetch_author_papers(author_id: str):
    url = f"{S2_BASE}/author/{author_id}/papers"
    params = {"fields": f"paperId,title,year,venue,url,doi,fieldsOfStudy,abstract,topics", "limit": 1000, "offset": 0}
    papers = []
    while True:
        r = requests.get(url, params=params, timeout=30)
        if r.status_code != 200:
            print(f"[warn] S2 author {author_id} HTTP {r.status_code}")
            break
        data = r.json()
        for it in data.get("data", []):
            p = it.get("paper", {})
            papers.append(p)
        # pagination
        if len(data.get("data", [])) == 0 or data.get("next", 0) == 0:
            break
        params["offset"] = data.get("next")
        time.sleep(SLEEP_BETWEEN)
    return papers

def normalize_topics(topics_obj):
    """
    S2 'topics' can be like [{'topic': 'Quantum communication','topicId':...}, ...]
    Return a simple list of topic names.
    """
    if not topics_obj:
        return []
    names = []
    for t in topics_obj:
        if isinstance(t, dict):
            name = t.get("topic") or t.get("name") or ""
        else:
            name = str(t)
        name = name.strip()
        if name:
            names.append(name)
    # de-dup while preserving order
    seen, out = set(), []
    for n in names:
        if n.lower() in seen: continue
        seen.add(n.lower()); out.append(n)
    return out

def shrink_pub(p):
    """
    Keep a compact paper object.
    - Always: paperId, title, year, venue, url, doi, fieldsOfStudy
    - Prefer: topics (list of strings)
    - Only include 'abstract' if topics are empty
    """
    q = {
        "paperId": p.get("paperId"),
        "title": p.get("title"),
        "year": p.get("year"),
        "venue": p.get("venue"),
        "url": p.get("url"),
        "doi": p.get("doi"),
        "fieldsOfStudy": p.get("fieldsOfStudy") or []
    }
    topics = normalize_topics(p.get("topics"))
    if topics:
        q["topics"] = topics
    else:
        # abstract only if topics are missing
        abstract = (p.get("abstract") or "").strip()
        if abstract:
            # optional: trim to keep file small
            q["abstract"] = abstract[:2000]
    return q

def main():
    # Iterate members/*/profile.json for semanticScholarId(s)
    for member_dir in MEMBERS_DIR.iterdir():
        if not member_dir.is_dir():
            continue
        profile_path = member_dir / "profile.json"
        if not profile_path.exists():
            continue
        try:
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        # Allow single id or array of ids
        s2_ids = profile.get("semanticScholarId")
        if not s2_ids:
            continue
        if isinstance(s2_ids, (str, int)):
            s2_ids = [str(s2_ids)]
        else:
            s2_ids = [str(x) for x in s2_ids if x]

        all_pubs = []
        for aid in s2_ids:
            papers = fetch_author_papers(aid)
            all_pubs.extend(papers)
            time.sleep(SLEEP_BETWEEN)

        # De-duplicate by paperId/doi/url/title (coarse)
        seen = set(); deduped = []
        for p in all_pubs:
            key = p.get("paperId") or p.get("doi") or p.get("url") or (p.get("title") or "").lower()[:120]
            if not key: continue
            if key in seen: continue
            seen.add(key)
            deduped.append(shrink_pub(p))

        out_path = member_dir / "publications.json"
        out_path.write_text(json.dumps(deduped, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[ok] wrote {out_path} ({len(deduped)})")

if __name__ == "__main__":
    main()
