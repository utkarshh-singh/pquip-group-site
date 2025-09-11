(async function(){
  const $ = sel => document.querySelector(sel);
  const resultsEl = $('#pub-results');
  const yearSel = $('#year');
  const memberSel = $('#member');
  const qInput = $('#q');
  const clearBtn = $('#clear');
  const loadMoreBtn = $('#load-more');
  const loadMoreWrap = $('#load-more-wrap');

  // CONFIG
  const PER_MEMBER = 5;                  // how many per member to fetch
  const PAGE_SIZE = 24;                  // render N at a time
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day

  let allPubs = [];   // merged array
  let filtered = [];
  let page = 0;

  // ---------- helpers ----------
  const deburr = s => (s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')     // remove accents
    .toLowerCase()
    .replace(/[\.\,']/g,' ')                             // drop dots/commas/apostrophes
    .replace(/\s+/g,' ')
    .trim();

  function splitName(s){
    const t = deburr(s);
    if(!t) return {first:'', last:'', finit:''};
    const parts = t.split(' ');
    const last = parts.pop() || '';
    const first = parts.join(' ') || '';
    const finit = first ? first[0] : '';
    return {first, last, finit};
  }

  function namesMatch(authorStr, profile){
    // Accept if:
    //  - exact alias match (after deburr)
    //  - OR last names equal AND (first initial equal OR first name startswith)
    const a = splitName(authorStr);
    // alias/explicit names
    for(const alias of profile.aliases){
      const da = deburr(alias);
      if (da === deburr(authorStr)) return true;
      const pa = splitName(da);
      if (pa.last && pa.last === a.last && (pa.finit && pa.finit === a.finit || (pa.first && a.first.startsWith(pa.first)))) {
        return true;
      }
    }
    // primary name
    const pn = splitName(profile.name);
    if (pn.last && pn.last === a.last && (pn.finit && pn.finit === a.finit || (pn.first && a.first.startsWith(pn.first)))) {
      return true;
    }
    return false;
  }

  function normalizeTitle(t){ return deburr(t); }
  function safeKeyFromRaw(p){
    const doi = p?.externalIds?.DOI;
    if (doi) return `doi:${String(doi).toLowerCase()}`;
    const t = normalizeTitle(p?.title || '');
    return t ? `t:${t}` : `u:${(p?.year||'0')}:${Math.random().toString(36).slice(2,8)}`;
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
        key: safeKeyFromRaw(p),
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
      const enriched = { venue, url };
      localStorage.setItem(jCacheKey(doi), JSON.stringify(enriched));
      item.venue = venue || item.venue;
      item.url   = url   || item.url;
    }catch{}
    return item;
  }

  // ---------- aggregate & merge ----------
  async function loadAll(){
    const ids = await loadManifest();
    const profiles = (await Promise.all(ids.map(id => loadProfile(id).catch(()=>null)))).filter(Boolean);

    // member filter options
    memberSel.innerHTML = `<option value="">All members</option>` +
      profiles.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

    // alias table for author matching (include provided aliases, if any)
    const PROFILES = profiles.map(p => ({
      id: p.id,
      name: p.name,
      aliases: [p.name, ...(p.aliases||[])],
    }));

    // fetch pubs in parallel
    const pubsByMember = await Promise.all(
      PROFILES.map(pr => getMemberPubs(pr).then(arr => ({profile: pr, pubs: arr})))
    );

    // merge by key
    const merged = new Map();
    for (const {pubs} of pubsByMember){
      for (const pub of pubs){
        let key = pub.key || `u:${Math.random().toString(36).slice(2,8)}`;
        if (merged.has(key)) {
          const ex = merged.get(key);
          // prefer non-arXiv venue; merge author lists
          if ((!ex.venue || /arxiv/i.test(ex.venue)) && pub.venue) ex.venue = pub.venue;
          if (ex.url?.startsWith('#') && pub.url) ex.url = pub.url;
          ex.authors = Array.from(new Set([...(ex.authors||[]), ...(pub.authors||[])]));
        } else {
          merged.set(key, { ...pub });
        }
      }
    }

    // compute group co-authors
    for (const item of merged.values()){
      const lowers = (item.authors||[]).map(a => deburr(a));
      item.groupAuthors = PROFILES.filter(pr =>
        lowers.some(a => namesMatch(a, pr))
      ).map(pr => ({ id: pr.id, name: pr.name }));
    }

    // to array + sort newest first
    allPubs = Array.from(merged.values())
      .sort((a,b)=> (b.year||0)-(a.year||0) || (a.title||'').localeCompare(b.title||''));

    // year dropdown
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
          ${(p.groupAuthors||[]).map(a=>`<span class="badge">Author: ${a.name}</span>`).join('')}
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
    const m = memberSel.value;
    const y = yearSel.value;

    filtered = allPubs.filter(p=>{
      const okM = !m || (p.groupAuthors||[]).some(g=>g.id===m);
      const okY = !y || String(p.year||'') === y;
      const okQ =
        !q ||
        (p.title||'').toLowerCase().includes(q) ||
        (p.venue||'').toLowerCase().includes(q) ||
        (p.authors||[]).some(a => a.toLowerCase().includes(q)) ||
        (p.groupAuthors||[]).some(g => g.name.toLowerCase().includes(q));
      return okM && okY && okQ;
    });

    // Enrich visible first dozen with Crossref/OpenAlex
    const toEnrich = filtered.slice(0, 12);
    await Promise.all(toEnrich.map(enrichJournalFor));

    render(filtered, !reset && page>0);
  }

  // ---------- events ----------
  qInput.addEventListener('input', ()=>applyFilters(true));
  memberSel.addEventListener('change', ()=>applyFilters(true));
  yearSel.addEventListener('change', ()=>applyFilters(true));
  clearBtn.addEventListener('click', ()=>{
    qInput.value=''; memberSel.value=''; yearSel.value='';
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
