#!/usr/bin/env python3
import os, json, time, re
from glob import glob
from urllib.parse import urljoin, urlparse, quote
import requests
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(__file__))
MEMBERS_DIR = os.path.join(ROOT, "members")
OUT = os.path.join(ROOT, "data", "highlights.auto.json")

NOWYEAR = int(time.strftime("%Y"))
PLACEHOLDER = "assets/img/pubs/paper-generic.jpg"
USER_AGENT = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
TIMEOUT = 18
UNPAYWALL_EMAIL = os.environ.get("UNPAYWALL_EMAIL", "").strip()

session = requests.Session()
session.headers.update({"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"})

# ---------- Utilities ----------
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

def is_generic_image(img_url):
    if not img_url:
        return True
    url = img_url.lower()
    host = urlparse(url).netloc
    bad_hosts = ["semanticscholar.org", "twitter.com", "t.co"]
    bad_pat = [r"logo", r"brand", r"favicon", r"apple-touch-icon", r"og-image"]
    if any(h in host for h in bad_hosts):
        return True
    if any(re.search(p, url) for p in bad_pat):
        return True
    if re.search(r"(\b|_)(\d{1,2})x(\d{1,2})(\b|_)", url):
        return True
    return False

def extract_og_image(html, base_url):
    soup = BeautifulSoup(html, "html.parser")
    candidates = []
    for key in ("og:image", "og:image:url", "og:image:secure_url"):
        tag = soup.find("meta", attrs={"property": key}) or soup.find("meta", attrs={"name": key})
        if tag and tag.get("content"):
            candidates.append(tag["content"].strip())
    for key in ("twitter:image", "twitter:image:src"):
        tag = soup.find("meta", attrs={"name": key}) or soup.find("meta", attrs={"property": key})
        if tag and tag.get("content"):
            candidates.append(tag["content"].strip())
    for c in candidates:
        absu = urljoin(base_url, c)
        if not is_generic_image(absu):
            return absu
    if candidates:
        return urljoin(base_url, candidates[0])
    return None

def doi_url(doi): return f"https://doi.org/{doi}"

def unpaywall_best_landing(doi):
    if not UNPAYWALL_EMAIL or not doi:
        return None
    try:
        api = f"https://api.unpaywall.org/v2/{quote(doi)}?email={quote(UNPAYWALL_EMAIL)}"
        r = session.get(api, timeout=TIMEOUT)
        if not r.ok: return None
        j = r.json()
        loc = j.get("best_oa_location") or {}
        return loc.get("url")
    except Exception:
        return None

def arxiv_abs(arxiv_id): return f"https://arxiv.org/abs/{arxiv_id}"

def fetch_og_from(url):
    try:
        r = session.get(url, timeout=TIMEOUT, allow_redirects=True)
        if not r.ok or not r.text:
            return None, r.url if hasattr(r, "url") else url
        img = extract_og_image(r.text, r.url)
        return img, r.url
    except requests.RequestException:
        return None, url

# ---------- Semantic Scholar figures hack ----------
def probe_semantic_scholar_figure(paper_id):
    """
    Try a handful of predictable figure URLs. Return the first that exists (HTTP 200).
    Pattern: https://figures.semanticscholar.org/<paperId>/500px/3-Figure<N>-1.png
    Also try '1-Figure<N>-1.png' as a fallback.
    """
    if not paper_id:
        return None
    bases = [
        f"https://figures.semanticscholar.org/{paper_id}/500px/3-Figure{{n}}-1.png",
        f"https://figures.semanticscholar.org/{paper_id}/500px/1-Figure{{n}}-1.png",
    ]
    for n in range(1, 9):  # try first 8 figures
        for base in bases:
            url = base.format(n=n)
            try:
                r = session.head(url, timeout=10, allow_redirects=True)
                if r.ok and int(r.headers.get("Content-Length", "1")) > 1000:
                    return url
            except requests.RequestException:
                continue
    return None

# ---------- Collect & build ----------
def collect_this_year_pubs():
    items = []
    for pubfile in glob(os.path.join(MEMBERS_DIR, "*", "publications.json")):
        data = read_json(pubfile)
        arr = data if isinstance(data, list) else (data or {}).get("publications") or []
        for p in arr:
            if p.get("year") != NOWYEAR: continue
            items.append(p)
    # de-dupe by DOI or title/url
    seen, uniq = set(), []
    for p in items:
        key = (p.get("doi") or p.get("url") or p.get("title") or "").strip().lower()
        if key and key not in seen:
            seen.add(key); uniq.append(p)
    return uniq

def choose_best_image(pub):
    # 1) landings with OG images
    attempts = []
    if pub.get("doi"): attempts.append(doi_url(pub["doi"]))
    if pub.get("doi"):
        u = unpaywall_best_landing(pub["doi"])
        if u: attempts.append(u)
    if pub.get("arxivId"): attempts.append(arxiv_abs(pub["arxivId"]))
    if pub.get("url"): attempts.append(pub["url"])

    for u in attempts:
        img, _ = fetch_og_from(u)
        if img and not is_generic_image(img):
            return img

    # 2) Semantic Scholar figures via paperId (hack)
    img = probe_semantic_scholar_figure(pub.get("paperId"))
    if img: return img

    # 3) Fallback
    return PLACEHOLDER

def build():
    pubs = collect_this_year_pubs()
    out = []
    for p in pubs:
        img = choose_best_image(p)
        url = (f"https://doi.org/{p['doi']}" if p.get("doi") else (p.get("url") or ""))
        out.append({
            "type": "publication",
            "title": p.get("title") or "",
            "year": p.get("year") or NOWYEAR,
            "url": url,
            "image": img,
            "tags": ["Publication"]
        })
    payload = {
        "source": "auto_from_publications_og_or_s2fig",
        "year": NOWYEAR,
        "updated_at": int(time.time()),
        "items": out
    }
    write_json(OUT, payload)
    print(f"Wrote {os.path.relpath(OUT, ROOT)} with {len(out)} items.")

if __name__ == "__main__":
    build()
