#!/usr/bin/env python3
import json, os, time, sys
from urllib.parse import quote
import requests

ROOT = os.path.dirname(os.path.dirname(__file__))
MANIFEST = os.path.join(ROOT, "members", "manifest.json")

S2_BASE = "https://api.semanticscholar.org/graph/v1"
# ⬇️ Same as before + add fieldsOfStudy, abstract, topics
PAPER_FIELDS = "paperId,title,year,venue,url,externalIds,authors,openAccessPdf,fieldsOfStudy,abstract,topics"
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

def _normalize_topics(topics_obj):
  """Return a simple de-duped list of topic names."""
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
  seen, out = set(), []
  for n in names:
    key = n.lower()
    if key in seen: continue
    seen.add(key); out.append(n)
  return out

def normalize(p):
  # ✅ Keep old behavior, but safely handle nested {"paper": {...}} too
  base = p.get("paper") if isinstance(p, dict) and "paper" in p else p

  title = base.get("title") or ""
  year  = base.get("year")
  venue = base.get("venue") or ""
  ext   = base.get("externalIds") or {}
  doi   = ext.get("DOI")
  arxiv = ext.get("ArXiv") or ext.get("arXiv") or ext.get("ARXIV")
  oa    = (base.get("openAccessPdf") or {}).get("url")
  url   = f"https://doi.org/{doi}" if doi else (base.get("url") or "")
  authors = [a.get("name") for a in (base.get("authors") or []) if isinstance(a, dict) and a.get("name")]

  out = {
    "paperId": base.get("paperId") or None,   # (unchanged) used elsewhere
    "title": title,
    "year": year,
    "venue": venue,
    "doi": str(doi) if doi else None,
    "url": url,
    "authors": authors,
    "oa_pdf": oa,
    "arxivId": arxiv
  }

  # NEW (safe additions)
  fos = base.get("fieldsOfStudy") or []
  if fos:
    out["fieldsOfStudy"] = fos

  topics = _normalize_topics(base.get("topics"))
  if topics:
    out["topics"] = topics
  else:
    # Only store abstract if topics missing (keeps files small)
    abstract = (base.get("abstract") or "").strip()
    if abstract:
      out["abstract"] = abstract[:2000]

  return out

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
