#!/usr/bin/env python3
import json, glob, re
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
MODEL_NAME = "MoritzLaurer/deberta-v3-base-zeroshot-v1"  # CPU-friendly

# --------- Utilities ----------
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

# --------- Labels & mapping ----------
def load_labels() -> List[str]:
    if LABELS_PATH.exists():
        data = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
        if data and isinstance(data[0], dict):
            return [d["name"] for d in data]
        return data
    return [
        "Quantum Communication","Quantum Nonlinear Optics","Quantum Light–Matter Interaction",
        "Quantum Simulation","Photonic QIP","Ultrafast Quantum Photonics",
        "Machine Learning","Photonics","Quantum Information","Quantum Computing","Other"
    ]

def load_overrides() -> Dict[str, List[str]]:
    if not OVERRIDES_PATH.exists(): return {}
    try:
        txt = OVERRIDES_PATH.read_text(encoding="utf-8").strip()
        return json.loads(txt) if txt else {}
    except Exception as e:
        print(f"[warn] could not parse overrides: {e}; ignoring.")
        return {}

# Map common S2 topic names → your site categories
TOPIC_MAP = {
    # Communication
    "Quantum communication": "Quantum Communication",
    "Quantum cryptography": "Quantum Communication",
    "Quantum key distribution": "Quantum Communication",
    "Quantum networks": "Quantum Communication",
    # Nonlinear optics
    "Nonlinear optics": "Quantum Nonlinear Optics",
    "Parametric down-conversion": "Quantum Nonlinear Optics",
    "Squeezed light": "Quantum Nonlinear Optics",
    # Light–matter
    "Cavity quantum electrodynamics": "Quantum Light–Matter Interaction",
    "Cavity QED": "Quantum Light–Matter Interaction",
    "Rydberg atom": "Quantum Light–Matter Interaction",
    "Trapped ions": "Quantum Light–Matter Interaction",
    "Quantum emitter": "Quantum Light–Matter Interaction",
    # Simulation
    "Quantum simulation": "Quantum Simulation",
    "Many-body physics": "Quantum Simulation",
    # Photonic QIP
    "Integrated photonics": "Photonic QIP",
    "Photonic circuits": "Photonic QIP",
    "Boson sampling": "Photonic QIP",
    # Ultrafast
    "Ultrafast optics": "Ultrafast Quantum Photonics",
    "Femtosecond laser": "Ultrafast Quantum Photonics",
    # ML
    "Machine learning": "Machine Learning",
    "Deep learning": "Machine Learning",
    # Broad buckets
    "Photonics": "Photonics",
    "Optics": "Photonics",
    "Quantum information": "Quantum Information",
    "Quantum computing": "Quantum Computing",
}

def map_topics_to_categories(topics: List[str]) -> List[str]:
    out = []
    seen = set()
    for t in topics or []:
        name = t.strip()
        cat = TOPIC_MAP.get(name) or TOPIC_MAP.get(name.title())
        if cat and cat not in seen:
            seen.add(cat); out.append(cat)
    return out

# --------- Zero-shot model ----------
def build_classifier():
    from transformers import pipeline
    return pipeline("zero-shot-classification", model=MODEL_NAME, device=-1, truncation=True)

def zs(texts: List[str], labels: List[str]):
    from transformers import pipeline
    zsc = build_classifier()
    return zsc(texts, labels, multi_label=True, hypothesis_template="This paper is about {}.")

def pick_labels(res: Dict[str, Any], threshold=0.5, top_k=2) -> Tuple[List[str], Dict[str, float]]:
    labels = res["labels"]; scores = res["scores"]
    pairs = list(zip(labels, scores))
    # Penalize generic buckets slightly
    PENALTY = {"Photonics": 0.07, "Quantum Information": 0.07}
    adjusted = [(lab, float(sc) - PENALTY.get(lab, 0.0)) for lab, sc in pairs]
    kept = [(l,s) for (l,s) in adjusted if s >= threshold]
    if not kept:
        kept = [max(adjusted, key=lambda x: x[1])]
    kept = sorted(kept, key=lambda x: x[1], reverse=True)[:top_k]
    return [l for l,_ in kept], {l: float(s) for l, s in adjusted}

# --------- Main ----------
def main():
    labels = load_labels()
    overrides = load_overrides()

    simple, verbose = {}, {}
    files = glob.glob(str(MEMBERS_DIR / "*" / "publications.json"))
    files.sort()

    need_ai_payloads = []  # (key, pub, text)

    # First pass: map topics; collect AI fallbacks
    for path in files:
        try:
            obj = json.loads(Path(path).read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[warn] skipped {path}: {e}"); continue

        for p in iter_publications(obj):
            if not isinstance(p, dict): continue
            key = paper_key(p)
            if not key: continue

            # Manual override beats everything
            if key in overrides:
                cats = sorted(set(overrides[key]))
                simple[key] = cats
                verbose[key] = {
                    "title": p.get("title") or "(untitled)",
                    "categories": cats,
                    "doi": norm_doi(p.get("doi","")) or None,
                    "url": p.get("url") or None,
                    "venue": p.get("venue") or None,
                    "year": p.get("year") or None,
                    "source": "override",
                    "scores": {}
                }
                continue

            topics = p.get("topics") or []
            mapped = map_topics_to_categories(topics)

            if mapped:
                simple[key] = mapped
                verbose[key] = {
                    "title": p.get("title") or "(untitled)",
                    "categories": mapped,
                    "doi": norm_doi(p.get("doi","")) or None,
                    "url": p.get("url") or None,
                    "venue": p.get("venue") or None,
                    "year": p.get("year") or None,
                    "source": "topics",
                    "scores": {}
                }
            else:
                # Build text for AI: prefer abstract when present
                t = norm(p.get("title"))
                v = norm(p.get("venue"))
                a = norm(p.get("abstract"))  # present only if topics were missing
                text = t
                if v: text += f". Venue: {v}."
                if a: text += f" Abstract: {a[:600]}"
                need_ai_payloads.append((key, p, text))

    # Second pass: run AI only for those without topics/overrides
    if need_ai_payloads:
        B = 8
        from transformers import pipeline
        zsc = pipeline("zero-shot-classification", model=MODEL_NAME, device=-1, truncation=True)
        for i in range(0, len(need_ai_payloads), B):
            batch = need_ai_payloads[i:i+B]
            texts = [x[2] for x in batch]
            results = zsc(texts, labels, multi_label=True, hypothesis_template="This paper is about {}.")
            if isinstance(results, dict): results = [results]
            for (key, p, _), res in zip(batch, results):
                cats, scores_map = pick_labels(res, threshold=0.5, top_k=2)
                simple[key] = cats
                verbose[key] = {
                    "title": p.get("title") or "(untitled)",
                    "categories": cats,
                    "doi": norm_doi(p.get("doi","")) or None,
                    "url": p.get("url") or None,
                    "venue": p.get("venue") or None,
                    "year": p.get("year") or None,
                    "source": "ai",
                    "scores": scores_map
                }

    # Write outputs
    OUT_SIMPLE.write_text(json.dumps(simple, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_VERBOSE.write_text(json.dumps(verbose, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] wrote {OUT_SIMPLE} ({len(simple)} entries)")
    print(f"[ok] wrote {OUT_VERBOSE} ({len(verbose)} entries)")

if __name__ == "__main__":
    main()
