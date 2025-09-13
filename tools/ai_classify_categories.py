#!/usr/bin/env python3
import json, glob
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
MEMBERS_DIR = ROOT / "members"
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

LABELS_PATH     = DATA_DIR / "categories.labels.json"
OVERRIDES_PATH  = DATA_DIR / "categories.overrides.json"
OUT_SIMPLE      = DATA_DIR / "publication_categories.json"
OUT_VERBOSE     = DATA_DIR / "publication_categories_verbose.json"

WRAPPED_KEYS = ("publications", "papers", "items", "results")
HYPOTHESIS = "This paper is about {}."
MODEL_NAME = "MoritzLaurer/deberta-v3-base-zeroshot-v1"  # CPU-friendly, good quality

def norm(s): return (s or "").strip()
def norm_doi(s: str) -> str:
    s = norm(s).lower()
    if not s: return s
    if s.startswith("https://doi.org/"): s = s.replace("https://doi.org/", "")
    if s.startswith("doi:"): s = s.replace("doi:", "")
    return s

def paper_key(p: Dict[str, Any]) -> str:
    pid = norm(p.get("paperId"))
    if pid: return f"S2:{pid}"
    doi = norm_doi(p.get("doi",""))
    if doi: return f"DOI:{doi}"
    url = norm(p.get("url"))
    if url: return url
    title = norm(p.get("title","")).lower()
    return f"TITLE:{title[:120]}"

def iter_publications(obj: Any) -> Iterable[Dict[str, Any]]:
    if obj is None: return
    if isinstance(obj, list):
        for it in obj:
            if isinstance(it, dict): yield it
            elif isinstance(it, str): yield {"url": it}
        return
    if isinstance(obj, dict):
        if any(k in obj for k in ("paperId","doi","url","title")):
            yield obj; return
        for k in WRAPPED_KEYS:
            v = obj.get(k)
            if isinstance(v, list):
                yield from iter_publications(v); return

def load_labels() -> List[str]:
    if LABELS_PATH.exists():
        return json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    return [
        "Quantum Communication","Quantum Nonlinear Optics","Quantum Light–Matter Interaction",
        "Quantum Simulation","Photonic QIP","Ultrafast Quantum Photonics",
        "Quantum Machine Learning","Photonics","Quantum Information","Quantum Computing","Other"
    ]

def load_overrides() -> Dict[str, List[str]]:
    if not OVERRIDES_PATH.exists(): return {}
    try:
        txt = OVERRIDES_PATH.read_text(encoding="utf-8").strip()
        return json.loads(txt) if txt else {}
    except Exception as e:
        print(f"[warn] could not parse overrides: {e}; ignoring.")
        return {}

def build_classifier():
    from transformers import pipeline
    return pipeline("zero-shot-classification", model=MODEL_NAME, device=-1, truncation=True)

def classify_batch(zsc, texts: List[str], candidate_labels: List[str]) -> List[Dict[str, Any]]:
    return zsc(texts, candidate_labels, multi_label=True, hypothesis_template=HYPOTHESIS)

def pick_labels(res: Dict[str, Any], threshold: float = 0.35, top_k: int = 3) -> Tuple[List[str], Dict[str, float]]:
    labels = res["labels"]; scores = res["scores"]
    pairs = list(zip(labels, scores))
    kept = [(l,s) for (l,s) in pairs if s >= threshold]
    if not kept: kept=[pairs[0]]
    kept = sorted(kept, key=lambda x:x[1], reverse=True)[:top_k]
    return [l for l,_ in kept], {l: float(s) for l,s in pairs}

def main():
    labels = load_labels()
    overrides = load_overrides()
    zsc = build_classifier()

    simple, verbose = {}, {}
    bad = 0

    files = glob.glob(str(MEMBERS_DIR / "*" / "publications.json"))
    files.sort()

    payloads = []
    for path in files:
        try:
            obj = json.loads(Path(path).read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[warn] skipped {path}: {e}"); continue
        for p in iter_publications(obj):
            if not isinstance(p, dict): bad += 1; continue
            key = paper_key(p)
            if not key: bad += 1; continue
            t = norm(p.get("title"))
            v = norm(p.get("venue"))
            a = norm(p.get("abstract"))
            text = t
            if v: text += f". Venue: {v}."
            if a: text += f" Abstract: {a[:400]}"
            payloads.append((key, p, text))

    B = 8
    for i in range(0, len(payloads), B):
        batch = payloads[i:i+B]
        texts = [x[2] for x in batch]
        results = classify_batch(zsc, texts, labels)
        if isinstance(results, dict): results = [results]
        for (key, p, _), res in zip(batch, results):
            if key in overrides:
                cats, scores_map = sorted(set(overrides[key])), {}
            else:
                cats, scores_map = pick_labels(res, threshold=0.35, top_k=3)
            simple[key] = cats
            verbose[key] = {
                "title": p.get("title") or "(untitled)",
                "categories": cats,
                "doi": norm_doi(p.get("doi","")) or None,
                "url": p.get("url") or None,
                "venue": p.get("venue") or None,
                "year": p.get("year") or None,
                "scores": scores_map
            }

    DATA_DIR.mkdir(exist_ok=True)
    OUT_SIMPLE.write_text(json.dumps(simple, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_VERBOSE.write_text(json.dumps(verbose, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] wrote {OUT_SIMPLE} ({len(simple)} entries)")
    print(f"[ok] wrote {OUT_VERBOSE} ({len(verbose)} entries)")
    if bad: print(f"[warn] skipped {bad} malformed entries overall.")

if __name__ == "__main__":
    main()
