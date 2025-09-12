#!/usr/bin/env python3
import os, json, time, re, sys
from glob import glob
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

# ---- Paths ----
ROOT = os.path.dirname(os.path.dirname(__file__))          # repo root
MEMBERS_DIR = os.path.join(ROOT, "members")
OUT = os.path.join(ROOT, "data", "highlights.auto.json")

# ---- Settings ----
NOWYEAR = int(time.strftime("%Y"))
PLACEHOLDER = "assets/img/pubs/paper-generic.jpg"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
TIMEOUT = 18  # seconds
MAX_PER_MEMBER = None  # None means unlimited; set e.g. 30 if you want to cap

session = requests.Session()
session.headers.update({"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"})

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

def extract_og_image(html, base_url):
    """
    Return absolute image URL from og:image or twitter:image tags if present.
    """
    soup = BeautifulSoup(html, "html.parser")

    # 1) og:image
    tag = soup.find("meta", attrs={"property": "og:image"}) or soup.find("meta", attrs={"name": "og:image"})
    if tag and tag.get("content"):
        return urljoin(base_url, tag["content"].strip())

    # 2) twitter:image (fallback)
    tag = soup.find("meta", attrs={"name": "twitter:image"}) or soup.find("meta", attrs={"property": "twitter:image"})
    if tag and tag.get("content"):
        return urljoin(base_url, tag["content"].strip())

    # 3) Some sites use og:image:url
    tag = soup.find("meta", attrs={"property": "og:image:url"})
    if tag and tag.get("content"):
        return urljoin(base_url, tag["content"].strip())

    return None

def best_url(pub):
    """
    Prefer DOI landing if present; else use whatever URL we have.
    """
    doi = pub.get("doi")
    if doi:
        return f"https://doi.org/{doi}"
    return pub.get("url") or ""

def collect_this_year_pubs():
    """
    Aggregate all current-year publications from each member.
    Returns list of dicts: {title, year, url}
    """
    all_items = []
    for pubfile in glob(os.path.join(MEMBERS_DIR, "*", "publications.json")):
        data = read_json(pubfile)
        arr = data if isinstance(data, list) else (data or {}).get("publications") or []
        count = 0
        for p in arr:
            year = p.get("year")
            if year != NOWYEAR:
                continue
            url = best_url(p)
            if not url:
                continue
            title = p.get("title") or ""
            all_items.append({
                "title": title,
                "year": year,
                "url": url
            })
            count += 1
            if MAX_PER_MEMBER and count >= MAX_PER_MEMBER:
                break
    # de-dupe by URL or title (URL first)
    seen = set()
    uniq = []
    for x in all_items:
        key = (x["url"] or x["title"]).strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        uniq.append(x)
    return uniq

def fetch_image_for_url(url):
    """
    Get og/twitter image from page HTML; return absolute URL or None.
    """
    try:
        r = session.get(url, timeout=TIMEOUT, allow_redirects=True)
        if not r.ok or not r.text:
            return None
        return extract_og_image(r.text, r.url)  # use final URL after redirects as base
    except requests.RequestException:
        return None

def build_highlights():
    items = collect_this_year_pubs()
    out_items = []
    for item in items:
        img = fetch_image_for_url(item["url"]) or PLACEHOLDER
        out_items.append({
            "type": "publication",
            "title": item["title"],
            "year": item["year"],
            "url": item["url"],
            "image": img,
            "tags": ["Publication"]
        })
    payload = {
        "source": "auto_from_publications_og",
        "year": NOWYEAR,
        "updated_at": int(time.time()),
        "items": out_items
    }
    write_json(OUT, payload)
    print(f"Wrote {os.path.relpath(OUT, ROOT)} with {len(out_items)} items")

if __name__ == "__main__":
    build_highlights()
