#!/usr/bin/env python3
"""
Classify publications into topical categories.

Inputs:
  - members/*/publications.json (various shapes supported)

Outputs:
  - data/publication_categories.json
      { "<KEY>": ["Category A", "Category B"], ... }
  - data/publication_categories_verbose.json
      {
        "<KEY>": {
          "title": "...",
          "categories": ["..."],
          "doi": "10.xxxx/...",
          "url": "https://...",
          "venue": "...",
          "year": 2024
        }, ...
      }
  - (optional) data/categories.overrides.json : manual overrides

Key preference:
  S2:<paperId>  ->  DOI:<normalized-doi>  ->  <url>  ->  TITLE:<title-prefix>
"""

import json, re, glob
from pathlib import Path
from typing import Any, Dict, Iterable

ROOT = Path(__file__).resolve().parents[1]
MEMBERS_DIR = ROOT / "members"
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

OVERRIDES_PATH = DATA_DIR / "categories.overrides.json"
OUT_SIMPLE = DATA_DIR / "publication_categories.json"
OUT_VERBOSE = DATA_DIR / "publication_categories_verbose.json"

# ---------- Helpers ----------

def norm(s): return (s or "").strip()

def norm_doi(s: str) -> str:
    s = norm(s).lower()
    if not s: return s
    if s.startswith("https://doi.org/"): s = s.replace("https://doi.org/", "")
    if s.startswith("doi:"):             s = s.replace("doi:", "")
    return s

def paper_key(p: Dict[str, Any]) -> str:
    pid = norm(p.get("paperId"))
    if pid: return f"S2:{pid}"
    doi = norm_doi(p.get("doi", ""))
    if doi: return f"DOI:{doi}"
    url = norm(p.get("url"))
    if url: return url
    title = norm(p.get("title", "")).lower()
    return f"TITLE:{title[:120]}"

FOS_MAP = {
    "Quantum computing": "Quantum Computing",
    "Quantum information": "Quantum Information",
    "Quantum communication": "Quantum Communication",
    "Optics": "Photonics",
    "Photonics": "Photonics",
    "Machine learning": "Machine Learning",
    "Computer science": "Machine Learning",
    "Electrical engineering": "Photonics",
    "Physics": "Quantum Information",
}

RULES = [
    (r"\bkey distribution|qkd|bb84|decoy|quantum network|satellite\b", "Quantum Communication"),
    (r"\bnonlinear|non-linear|second-harmonic|four[- ]wave|chi\(2\)|chi\(3\)\b", "Quantum Nonlinear Optics"),
    (r"\blight[-– ]?matter|atom(s)?|ion(s)?|cavity|rydberg|emitter\b", "Quantum Light–Matter Interaction"),
    (r"\bquantum simulation|simulator|hubbard|ising|lattice\b", "Quantum Simulation"),
    (r"\bphotonic(s)?|waveguide|ring resonator|integrated optics|optical circuit\b", "Photonic QIP"),
    (r"\bultrafast|femtosecond|picosecond|attosecond|pump[- ]probe\b", "Ultrafast Quantum Photonics"),
    (r"\bkernel|gaussian process|graph neural|neural network|machine learning|reinforcement\b", "Machine Learning"),
]

DEFAULT_CAT = "Other"

def pick_categories(pub: Dict[str, Any]) -> list[str]:
    cats = set()
    for fos in (pub.get("fieldsOfStudy") or []):
        mapped = FOS_MAP.get(fos)
        if mapped: cats.add(mapped)

    title = (pub.get("title") or "").lower()
    venue = (pub.get("venue") or "").lower()
    abstract = (pub.get("abstract") or "").lower()
    hay = " ".join([title, venue, abstract])

    for pat, label in RULES:
        if re.search(pat, hay): cats.add(label)

    if not cats: cats.add(DEFAULT_CAT)
    return sorted(cats)

# --------- Robust parsing of various file shapes ---------

WRAPPED_KEYS = ("publications", "papers", "items", "results")

def iter_publications(obj: Any) -> Iterable[Dict[str, Any]]:
    if obj is None: return
    if isinstance(obj, list):
        for item in obj:
            if isinstance(item, dict): yield item
            elif isinstance(item, str): yield {"url": item}
        return
    if isinstance(obj, dict):
        if any(k in obj for k in ("paperId","doi","url","title")):
            yield obj; return
        for k in WRAPPED_KEYS:
            v = obj.get(k)
            if isinstance(v, list):
                yield from iter_publications(v); return

# ---------- Main ----------

def main():
    # overrides (robust)
    overrides = {}
    if OVERRIDES_PATH.exists():
        try:
            text = OVERRIDES_PATH.read_text(encoding="utf-8").strip()
            overrides = json.loads(text) if text else {}
        except Exception as e:
            print(f"[warn] could not parse {OVERRIDES_PATH}: {e}; using no overrides.")

    simple = {}
    verbose = {}
    bad = 0

    files = glob.glob(str(MEMBERS_DIR / "*" / "publications.json"))
    files.sort()

    for path in files:
        try:
            obj = json.loads(Path(path).read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[warn] skipped {path}: {e}")
            continue

        for p in iter_publications(obj):
            if not isinstance(p, dict):
                bad += 1; continue

            key = paper_key(p)
            if not key:
                bad += 1; continue

            if key in overrides:
                cats = sorted(set(overrides[key]))
            else:
                cats = pick_categories(p)

            simple[key] = cats

            # verbose fields for verification
            verbose[key] = {
                "title": p.get("title") or "(untitled)",
                "categories": cats,
                "doi": norm_doi(p.get("doi","")) or None,
                "url": p.get("url") or None,
                "venue": p.get("venue") or None,
                "year": p.get("year") or None,
            }

    OUT_SIMPLE.write_text(json.dumps(simple, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_VERBOSE.write_text(json.dumps(verbose, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[ok] wrote {OUT_SIMPLE} ({len(simple)} entries)")
    print(f"[ok] wrote {OUT_VERBOSE} ({len(verbose)} entries)")
    if bad: print(f"[warn] skipped {bad} malformed entries overall.")

if __name__ == "__main__":
    main()
