(async function(){
  const $ = sel => document.querySelector(sel);
  const resultsEl = $('#pub-results');
  const qInput = $('#q');
  const memberSel = $('#member');
  const authorSel = $('#author');
  const yearSel = $('#year');
  const clearBtn = $('#clear');
  const loadMoreBtn = $('#load-more');
  const loadMoreWrap = $('#load-more-wrap');

  // CONFIG
  const PER_MEMBER = 5;                   // fetch this many latest papers per member
  const PAGE_SIZE = 24;                   // show N per page
  const CACHE_TTL = 24 * 60 * 60 * 1000;  // 1 day
  const MAX_AUTHOR_OPTIONS = 400;         // cap author dropdown size

  let allPubs = [];   // merged array of {title, year, venue, url, authors[], groupAuthors[]}
  let filtered = [];
  let page = 0;

  // ---------- string helpers ----------
  const deburr = s => (s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[\.\,\(\)\[\]\:;'"`]/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  const normTitle = t => deburr(t).replace(/\barxiv\s*:\s*\S+/g,'').trim();

  // Key strategies (for dedupe):
  // 1) DOI, else
  // 2) normalized title, else
  // 3) normalized title + first 3 normalized authors + year
  function keyFromRaw(p){
    const doi = p?.externalIds?.DOI;
    if (doi) return `doi:${String(doi).toLowerCase()}`;
    const t = normTitle(p?.title || '');
    if (t) return `t:${t}`;
    // ultra fallback (rare)
    const authors = (p.authors||[]).slice(0,3).map(a=>deburr(a.name||'')).join('|');
    return `mix:${t}|${authors}|${p.year||''}`;
  }

  // soft equality: titles equal OR Jaccard(author set) ≥ 0.5 and year diff ≤ 1
  function looksSame(a, b){
    if (deburr(a.title) === deburr(b.title)) return true;
    const setA = new Set((a.authors||[]).map(deburr));
    const setB = new Set((b.authors||[]).map(deburr));
    const inter = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size || 1;
    const j = inter/union;
    const yd = Math.abs((a.year||0)-(b.year||0));
    return j >= 0.5 && yd <= 1;
  }

  function cacheKey(id){ return `pubs:${id}`; }
  function getCache(id){
    try{
      const raw = localStorage.getItem(cacheKey(id));
      if(!raw) return null;
      const {ts,data} = JSON.parse(raw);
      return (Date.now()-ts > CACHE_TTL) ? null : data;
    }catch{ return null; }
  }
  function setCache(id, data){
    try{ localStorage.setItem(cacheKey(id), JSON.stringify({ts:Date.now(), data})); }catch{}
  }

  async function loadManifest(){
    const r = await fetch('members/manifest.json', {cache:'no-store'});
    if(!r.ok) throw new Error('members/manifest.json missing');
    return r.json();
  }
  async function loadProfile(id){
    const r = await fetch(`members/${encodeURIComponent(id)}/profile.json`, {cache:'no-store'});
    if(!r.ok) throw new Error(`profile missing for ${id}`);
    return r.json();
  }

  // ---- Semantic Scholar fetch (includes AUTHORS) ----
  async function fetchSemScholar(authorId, count=PER_MEMBER){
    const fields = 'papers.title,papers.year,papers.venue,papers.url,papers.externalIds,papers.authors';
    const url = `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}?fields=${fields}`;
    const r = await fetch(url);
    if(!r.ok) throw new Error(`Semantic Scholar ${r.status}`);
    const j = await r.json();
    return (j.papers||[])
      .filter(Boolean)
      .sort((a,b)=>(b.year||0)-(a.year||0))
      .slice(0, count);
  }

  async function getMemberPubs(profile){
    const cached = getCache(profile.id);
    if(cached) return cached;
    if(!profile.semanticScholarId) return [];
    try{
      const raw = await fetchSemScholar(profile.semanticScholarId, PER_MEMBER);
      const pubs = raw.map(p => ({
        key: keyFromRaw(p),
        title: p.title || '',
        year: p.year ?? null,
        venue: p.venue || '',
        url: (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : p.url || '#'),
        authors: (p.authors || []).map(a => a.name || '').filter(Boolean),
      }));
      setCache(profile.id, pubs);
      return pubs;
    }catch(e){
      console.warn('[pubs] fetch failed for', profile.name, e);
      return [];
    }
  }

  // ---- Journal enrichment (Crossref / OpenAlex) with cache ----
  function jCacheKey(doi){ return `jrnl:${(doi||'').toLowerCase()}`; }
  async function enrichJournalFor(item){
    const doi = (item.url||'').startsWith('https://doi.org/') ? item.url.replace('https://doi.org/','') : null;
    if(!doi) return item;
    try{
      const cached = JSON.parse(localStorage.getItem(jCacheKey(doi)) || 'null');
      if(cached){
        item.venue = cached.venue || item.venue;
        item.url   = cached.url   || item.url;
        return item;
      }
      let venue = '', url = item.url;

      const cr = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
      if(cr.ok){
        const j = await cr.json();
        venue = (j.message['container-title'] && j.message['container-title'][0]) || venue;
        url = j.message.URL || url;
      } else {
        const oa = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`);
        if(oa.ok){
          const k = await oa.json();
          venue = k.host_venue?.display_name || venue;
          url = k.primary_location?.source?.landing_page_url || url;
        }
      }
      localStorage.setItem(jCacheKey(doi), JSON.stringify({venue,url}));
      item.venue = venue || item.venue;
      item.url   = url   || item.url;
    }catch{}
    return item;
  }

  // ---------- aggregate & merge (with name-based dedupe) ----------
  async function loadAll(){
    const ids = await loadManifest();
    const profiles = (await Promise.all(ids.map(id => loadProfile(id).catch(()=>null)))).filter(Boolean);

    // member filter
    memberSel.innerHTML = `<option value="">All members</option>` +
      profiles.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

    // build alias table for group author matching (optional future use)
    const PROFILES = profiles.map(p => ({
      id: p.id,
      name: p.name,
      aliases: [p.name, ...(p.aliases||[])],
    }));

    // fetch pubs per member
    const perMember = await Promise.all(
      PROFILES.map(pr => getMemberPubs(pr).then(arr => ({profile: pr, pubs: arr})))
    );

    // merge by key, and also do secondary name-based dedupe
    const byKey = new Map();
    for (const {pubs} of perMember){
      for (const pub of pubs){
        const candidate = { ...pub }; // shallow copy
        const k = candidate.key || `mix:${normTitle(candidate.title)}`;
        if (!byKey.has(k)) {
          byKey.set(k, candidate);
        } else {
          const ex = byKey.get(k);
          // Merge if same; else, if very different titles, keep both (will catch by name-based step next)
          if (looksSame(ex, candidate)) {
            // prefer better venue/url and merge authors
            if ((!ex.venue || /arxiv/i.test(ex.venue)) && candidate.venue) ex.venue = candidate.venue;
            if (ex.url?.startsWith('#') && candidate.url) ex.url = candidate.url;
            ex.authors = Array.from(new Set([...(ex.authors||[]), ...(candidate.authors||[])]));
          } else {
            // create a slightly different synthetic key to keep both temporarily
            byKey.set(`${k}:${Math.random().toString(36).slice(2,6)}`, candidate);
          }
        }
      }
    }

    // SECOND PASS: name-based dedupe across different keys
    const deduped = [];
    for (const cand of byKey.values()){
      const dup = deduped.find(x => looksSame(x, cand));
      if (dup){
        // merge into existing
        if ((!dup.venue || /arxiv/i.test(dup.venue)) && cand.venue) dup.venue = cand.venue;
        if (dup.url?.startsWith('#') && cand.url) dup.url = cand.url;
        dup.authors = Array.from(new Set([...(dup.authors||[]), ...(cand.authors||[])]));
      } else {
        deduped.push(cand);
      }
    }

    // final array + sort newest first
    allPubs = deduped
      .sort((a,b)=> (b.year||0)-(a.year||0) || (a.title||'').localeCompare(b.title||''));

    // build Author dropdown from all authors (cap to avoid huge lists)
    const authorSet = new Set();
    allPubs.forEach(p => (p.authors||[]).forEach(a => authorSet.add(a)));
    const authors = [...authorSet].sort((a,b)=>a.localeCompare(b)).slice(0, MAX_AUTHOR_OPTIONS);
    authorSel.innerHTML = `<option value="">All authors</option>` + authors.map(a=>`<option value="${a}">${a}</option>`).join('');

    // build Year dropdown
    const years = [...new Set(allPubs.map(p=>p.year).filter(Boolean))].sort((a,b)=>b-a);
    yearSel.innerHTML = `<option value="">All years</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');

    await applyFilters(true);
  }

  // ---------- render ----------
  function render(items, append=false){
    if(!append){ resultsEl.innerHTML=''; page = 0; }
    const start = page * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    const html = slice.map(p => `
      <article class="pub-card">
        <h3 class="pub-title"><a href="${p.url||'#'}" target="_blank" rel="noopener">${p.title}</a></h3>
        ${ (p.authors && p.authors.length) ? `<div class="authors-line">${p.authors.join(', ')}</div>` : '' }
        <div class="pub-meta">
          ${p.venue ? `<em>${p.venue}</em>` : ''}${p.venue && p.year ? ' • ' : ''}${p.year || ''}
        </div>
        <div class="badges">
          ${p.url && p.url.startsWith('https://doi.org/') ? `<span class="badge"><a href="${p.url}" target="_blank" rel="noopener">DOI</a></span>` : ''}
        </div>
      </article>
    `).join('');

    resultsEl.insertAdjacentHTML('beforeend', html);
    page++;

    if(items.length > page * PAGE_SIZE){
      loadMoreWrap.classList.remove('hidden');
    } else {
      loadMoreWrap.classList.add('hidden');
    }
  }

  // ---------- filtering + enrichment ----------
  async function applyFilters(reset=false){
    const q = (qInput.value||'').toLowerCase();
    const m = memberSel.value;        // group member id (optional)
    const a = authorSel.value;        // any author display name (optional)
    const y = yearSel.value;

    filtered = allPubs.filter(p=>{
      const okY = !y || String(p.year||'') === y;
      const okA = !a || (p.authors||[]).includes(a);
      const okM = !m || (p.authors||[]).some(name => name.toLowerCase().includes(m.toLowerCase())); // if you want memberId-based, we’d need name mapping; this keeps it simple
      const okQ =
        !q ||
        (p.title||'').toLowerCase().includes(q) ||
        (p.venue||'').toLowerCase().includes(q) ||
        (p.authors||[]).some(n => n.toLowerCase().includes(q));
      return okY && okA && okM && okQ;
    });

    // Enrich visible first dozen with Crossref/OpenAlex
    const toEnrich = filtered.slice(0, 12);
    await Promise.all(toEnrich.map(enrichJournalFor));

    render(filtered, !reset && page>0);
  }

  // ---------- events ----------
  qInput.addEventListener('input', ()=>applyFilters(true));
  memberSel.addEventListener('change', ()=>applyFilters(true));
  authorSel.addEventListener('change', ()=>applyFilters(true));
  yearSel.addEventListener('change', ()=>applyFilters(true));
  clearBtn.addEventListener('click', ()=>{
    qInput.value=''; memberSel.value=''; authorSel.value=''; yearSel.value='';
    applyFilters(true);
  });
  loadMoreBtn.addEventListener('click', ()=> render(filtered, true));

  // ---------- go ----------
  try{ await loadAll(); }
  catch(e){
    resultsEl.innerHTML = `<p>Failed to load publications.</p>`;
    console.error(e);
  }
})();
