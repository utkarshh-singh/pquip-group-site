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
  const PER_MEMBER = 5;                 // how many per member to fetch
  const PAGE_SIZE = 24;                 // render N at a time
  const CACHE_TTL = 24 * 60 * 60 * 1000;// 1 day

  let allPubs = [];   // merged array
  let filtered = [];
  let page = 0;

  // ---------- helpers ----------
  function normalizeTitle(t){ return (t||'').toLowerCase().replace(/\s+/g,' ').trim(); }
  function safeKeyFromRaw(p){
    const doi = p?.externalIds?.DOI;
    if (doi) return `doi:${String(doi).toLowerCase()}`;
    const t = normalizeTitle(p?.title || '');
    // guard: if title is empty, synthesize a unique key using year+random
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
    return r.json(); // ["khabat","aaron",...]
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
        _raw: p
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

      // Crossref first
      const cr = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
      if(cr.ok){
        const j = await cr.json();
        venue = (j.message['container-title'] && j.message['container-title'][0]) || venue;
        url = j.message.URL || url;
      } else {
        // OpenAlex fallback
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
    }catch{/* ignore */}
    return item;
  }

  // ---------- aggregate & merge ----------
  async function loadAll(){
    // load ids + profiles in parallel
    const ids = await loadManifest();
    const profilePromises = ids.map(id => loadProfile(id).catch(e => (console.warn('[pubs] profile load failed', id, e), null)));
    const profiles = (await Promise.all(profilePromises)).filter(Boolean);

    if (!profiles.length){
      resultsEl.innerHTML = `<p>No member profiles found.</p>`;
      console.warn('[pubs] No profiles loaded. Check members/manifest.json and profile.json files.');
      return;
    }

    // member filter
    memberSel.innerHTML = `<option value="">All members</option>` +
      profiles.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

    // alias table for author matching
    const PROFILES = profiles.map(p => ({
      id: p.id,
      name: p.name,
      aliases: [p.name.toLowerCase(), ...(p.aliases||[]).map(a=>a.toLowerCase())]
    }));

    // fetch pubs for all members in parallel
    const pubsByMember = await Promise.all(
      profiles.map(p => getMemberPubs(p).then(arr => ({profile: p, pubs: arr})))
    );

    // merge by key; if collision on same key but different title, make a unique fallback key
    const merged = new Map(); // key -> item
    for (const {profile, pubs} of pubsByMember){
      for (const pub of pubs){
        let key = pub.key || `u:${Math.random().toString(36).slice(2,8)}`;
        if (merged.has(key)) {
          const existing = merged.get(key);
          const titlesDifferent = normalizeTitle(existing.title) !== normalizeTitle(pub.title);
          if (titlesDifferent) {
            // synthesize new key to avoid accidental merge
            key = `t:${normalizeTitle(pub.title)}:${Math.random().toString(36).slice(2,6)}`;
          }
        }
        if (!merged.has(key)) {
          merged.set(key, {
            title: pub.title,
            year: pub.year || null,
            venue: pub.venue || '',
            url: pub.url || '#',
            rawAuthors: pub.authors || [],
            groupAuthors: []
          });
        } else {
          // Optionally upgrade venue/url if better
          const it = merged.get(key);
          if ((!it.venue || /arxiv/i.test(it.venue)) && pub.venue) it.venue = pub.venue;
          if (it.url?.startsWith('#') && pub.url) it.url = pub.url;
          // merge author list
          it.rawAuthors = Array.from(new Set([...(it.rawAuthors||[]), ...(pub.authors||[])]));
        }
      }
    }

    // compute group co-authors
    for(const [k, item] of merged.entries()){
      const lowers = (item.rawAuthors||[]).map(a=>a.toLowerCase());
      const matches = PROFILES.filter(pr => pr.aliases.some(alias => lowers.includes(alias)))
                              .map(pr => ({id: pr.id, name: pr.name}));
      item.groupAuthors = matches;
    }

    // to array + sort newest first
    allPubs = Array.from(merged.values())
      .sort((a,b)=> (b.year||0)-(a.year||0) || (a.title||'').localeCompare(b.title||''));

    // years filter options
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

  // ---------- filtering + journal enrichment ----------
  async function applyFilters(reset=false){
    const q = (qInput.value||'').toLowerCase();
    const m = memberSel.value;
    const y = yearSel.value;

    filtered = allPubs.filter(p=>{
      const okM = !m || (p.groupAuthors||[]).some(g=>g.id===m);
      const okY = !y || String(p.year||'') === y;
      const okQ = !q || (p.title||'').toLowerCase().includes(q) ||
                         (p.venue||'').toLowerCase().includes(q) ||
                         (p.groupAuthors||[]).some(g=>g.name.toLowerCase().includes(q));
      return okM && okY && okQ;
    });

    // Enrich first batch so arXiv becomes journal when possible
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
