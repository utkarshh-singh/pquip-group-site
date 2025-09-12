#!/usr/bin/env python3
"""
Classify publications into topical categories.

Inputs:
  - members/*/publications.json (Semantic Scholar–derived objects or mixed)
    Accepted shapes per file:
      * [ {...}, {...} ]                         list of dicts (preferred)
      * { "publications": [ ... ] }              wrapped list
      * { "papers": [ ... ] }                    wrapped list
      * { "items": [ ... ] } / { "results": [...] } wrapped list
      * [ "https://...", "10.1234/doi" ]         list of strings (coerced as url)
      * { ... }                                  single publication dict

Output:
  - data/publication_categories.json : { <key>: [ "Category A", "Category B", ... ], ... }
  - (optional) data/categories.overrides.json : manual overrides

Key order preference:
  paperId -> doi -> url -> normalized title (first 120 chars)
"""

import json
import re
import glob
from pathlib import Path
from typing import Iterable, Dict, Any

ROOT = Path(__file__).resolve().parents[1]
MEMBERS_DIR = ROOT / "members"
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

OVERRIDES_PATH = DATA_DIR / "categories.overrides.json"
OUTPUT_PATH = DATA_DIR / "publication_categories.json"

# ---------- Helpers ----------

def norm(s):
    return (s or "").strip()

def norm_doi(s: str) -> str:
    s = norm(s).lower()
    if not s:
        return s
    if s.startswith("https://doi.org/"):
        s = s.replace("https://doi.org/", "")
    if s.startswith("doi:"):
        s = s.replace("doi:", "")
    return s

def paper_key(p: Dict[str, Any]) -> str:
    """
    Stable key used to join with the website later.
    Preference: paperId -> doi -> url -> normalized title prefix
    """
    pid = norm(p.get("paperId"))
    if pid:
        return f"S2:{pid}"

    doi = norm_doi(p.get("doi", ""))
    if doi:
        return f"DOI:{doi}"

    url = norm(p.get("url"))
    if url:
        return url

    title = norm(p.get("title", "")).lower()
    return f"TITLE:{title[:120]}"

# Map S2 fields-of-study into your site buckets (soft mapping)
FOS_MAP = {
    "Quantum computing": "Quantum Computing",
    "Quantum information": "Quantum Information",
    "Quantum communication": "Quantum Communication",
    "Optics": "Photonics",
    "Photonics": "Photonics",
    "Machine learning": "Machine Learning",
    "Computer science": "Machine Learning",
    "Electrical engineering": "Photonics",
    "Physics": "Quantum Information"
}

# Keyword rules (title/venue/abstract, lowercased)
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

    # fieldsOfStudy from S2 (if present)
    for fos in (pub.get("fieldsOfStudy") or []):
        mapped = FOS_MAP.get(fos, None)
        if mapped:
            cats.add(mapped)

    title = (pub.get("title") or "").lower()
    venue = (pub.get("venue") or "").lower()
    abstract = (pub.get("abstract") or "").lower()
    hay = " ".join([title, venue, abstract])

    for pat, label in RULES:
        if re.search(pat, hay):
            cats.add(label)

    if not cats:
        cats.add(DEFAULT_CAT)

    return sorted(cats)

# --------- Robust parsing of various file shapes ---------

WRAPPED_KEYS = ("publications", "papers", "items", "results")

def iter_publications(obj: Any) -> Iterable[Dict[str, Any]]:
    """
    Yield publication dicts from many possible shapes.
    Coerce strings to {"url": "..."}.
    """
    if obj is None:
        return
    # List case
    if isinstance(obj, list):
        for item in obj:
            if isinstance(item, dict):
                yield item
            elif isinstance(item, str):
                yield {"url": item}
            else:
                # skip unknown item type
                continue
        return
    # Wrapped dict case: look for known list keys
    if isinstance(obj, dict):
        # A single publication dict?
        if any(k in obj for k in ("paperId", "doi", "url", "title")):
            yield obj
            return
        for k in WRAPPED_KEYS:
            v = obj.get(k)
            if isinstance(v, list):
                yield from iter_publications(v)
                return
    # Fallback: nothing
    return

# ---------- Main ----------

def main():
    # Optional manual overrides (robust)
    overrides = {}
    if OVERRIDES_PATH.exists():
        try:
            text = OVERRIDES_PATH.read_text(encoding="utf-8").strip()
            if text:
                overrides = json.loads(text)
            else:
                print(f"[warn] {OVERRIDES_PATH} is empty; using no overrides.")
        except Exception as e:
            print(f"[warn] could not parse {OVERRIDES_PATH}: {e}; using no overrides.")

    out = {}
    bad_items = 0

    files = glob.glob(str(MEMBERS_DIR / "*" / "publications.json"))
    files.sort()

    for path in files:
        try:
            raw = Path(path).read_text(encoding="utf-8")
            obj = json.loads(raw)
        except Exception as e:
            print(f"[warn] skipped {path}: {e}")
            continue

        for p in iter_publications(obj):
            # At this point p should be a dict (strings are coerced)
            if not isinstance(p, dict):
                bad_items += 1
                continue

            key = paper_key(p)
            if not key:
                bad_items += 1
                continue

            if key in overrides:
                out[key] = sorted(set(overrides[key]))
            else:
                out[key] = pick_categories(p)

    OUTPUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] wrote {OUTPUT_PATH} with {len(out)} entries.")
    if bad_items:
        print(f"[warn] skipped {bad_items} malformed entries overall.")

if __name__ == "__main__":
    main()
