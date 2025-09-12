#!/usr/bin/env python3
"""
Classify publications into topical categories.

Inputs:
  - members/*/publications.json (Semantic Scholar–derived objects)

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
    # normalize common DOI forms
    if s.startswith("https://doi.org/"):
        s = s.replace("https://doi.org/", "")
    if s.startswith("doi:"):
        s = s.replace("doi:", "")
    return s

def paper_key(p: dict) -> str:
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

    # last resort: title prefix
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

def pick_categories(pub: dict) -> list[str]:
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

# ---------- Main ----------

def main():
    # Optional manual overrides
    overrides = {}
    if OVERRIDES_PATH.exists():
        with open(OVERRIDES_PATH, "r", encoding="utf-8") as f:
            overrides = json.load(f)

    out = {}
    files = glob.glob(str(MEMBERS_DIR / "*" / "publications.json"))
    files.sort()

    for path in files:
        try:
            with open(path, "r", encoding="utf-8") as f:
                pubs = json.load(f)
        except Exception as e:
            print(f"[warn] skipped {path}: {e}")
            continue

        for p in pubs:
            key = paper_key(p)
            if not key:
                continue

            if key in overrides:
                out[key] = sorted(set(overrides[key]))
                continue

            out[key] = pick_categories(p)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"[ok] wrote {OUTPUT_PATH} with {len(out)} entries.")

if __name__ == "__main__":
    main()
